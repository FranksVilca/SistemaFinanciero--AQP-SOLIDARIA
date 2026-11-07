import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  ListStackResourcesCommand,
  type StackResourceSummary,
} from "@aws-sdk/client-cloudformation";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { CognitoIdentityProviderClient, DescribeUserPoolCommand } from "@aws-sdk/client-cognito-identity-provider";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FLOCI_ENV } from "./flociEnv.js";

/**
 * Deploys infra/template.yaml, SAM transform included, into Floci for each stage and checks the result.
 * It proves the template is deployable and that the stage conditions produce what the contracts promise.
 * Floci does not enforce every property (for example it does not create the inline policies of the roles),
 * so security properties are asserted in test/infra and test/floci/iamEnforcement.test.ts.
 */

const TEMPLATE = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../infra/template.yaml"), "utf8");
const CAPABILITIES = ["CAPABILITY_IAM", "CAPABILITY_AUTO_EXPAND", "CAPABILITY_NAMED_IAM"] as const;
const POLL_ATTEMPTS = 60;
const POLL_WAIT_MS = 500;
const FUNCTIONS_IN_ACADEMIC = 9;
const LOG_RETENTION_DAYS = 14;

const config = {
  region: FLOCI_ENV.AWS_REGION,
  endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
  credentials: { accessKeyId: FLOCI_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: FLOCI_ENV.AWS_SECRET_ACCESS_KEY },
};
const cloudFormation = new CloudFormationClient(config);
const dynamo = new DynamoDBClient(config);
const logs = new CloudWatchLogsClient(config);
const cognito = new CognitoIdentityProviderClient(config);

const stackStatus = async (stackName: string): Promise<string | undefined> => {
  try {
    const { Stacks } = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
    return Stacks?.[0]?.StackStatus;
  } catch {
    return undefined; // the stack does not exist
  }
};

async function waitFor(stackName: string, done: (status: string | undefined) => boolean): Promise<string | undefined> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const status = await stackStatus(stackName);
    if (done(status)) return status;
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_WAIT_MS));
  }
  return stackStatus(stackName);
}

async function deploy(stackName: string, parameters: Record<string, string>): Promise<StackResourceSummary[]> {
  await cloudFormation.send(new DeleteStackCommand({ StackName: stackName }));
  await waitFor(stackName, (status) => status === undefined);

  await cloudFormation.send(
    new CreateStackCommand({
      StackName: stackName,
      TemplateBody: TEMPLATE,
      Capabilities: [...CAPABILITIES],
      Parameters: Object.entries(parameters).map(([ParameterKey, ParameterValue]) => ({
        ParameterKey,
        ParameterValue,
      })),
    })
  );
  const status = await waitFor(stackName, (current) => current !== undefined && !current.endsWith("IN_PROGRESS"));
  expect(status).toBe("CREATE_COMPLETE");

  const { StackResourceSummaries = [] } = await cloudFormation.send(
    new ListStackResourcesCommand({ StackName: stackName })
  );
  return StackResourceSummaries;
}

const countOf = (resources: StackResourceSummary[], type: string) =>
  resources.filter((resource) => resource.ResourceType === type).length;

describe("academic stage", () => {
  const stackName = "zta-academic";
  let resources: StackResourceSummary[];

  beforeAll(async () => {
    resources = await deploy(stackName, { StageName: "academic", CognitoDomainPrefix: "zta-academic-auth" });
  });
  afterAll(async () => {
    await cloudFormation.send(new DeleteStackCommand({ StackName: stackName }));
  });

  it("creates the nine functions, the four tables and the identity pieces", () => {
    expect(countOf(resources, "AWS::Lambda::Function")).toBe(FUNCTIONS_IN_ACADEMIC);
    expect(countOf(resources, "AWS::DynamoDB::Table")).toBe(4);
    expect(countOf(resources, "AWS::Cognito::UserPool")).toBe(1);
    expect(countOf(resources, "AWS::Cognito::UserPoolDomain")).toBe(1);
    expect(countOf(resources, "AWS::ApiGatewayV2::Authorizer")).toBe(1);
  });

  it("requires multi-factor authentication in the user pool", async () => {
    const pool = resources.find((resource) => resource.ResourceType === "AWS::Cognito::UserPool")!;

    const { UserPool } = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: pool.PhysicalResourceId }));

    expect(UserPool?.MfaConfiguration).toBe("ON");
  });

  it("keeps every log group for 14 days", async () => {
    const { logGroups = [] } = await logs.send(
      new DescribeLogGroupsCommand({ logGroupNamePrefix: "/aqp-solidaria/academic" })
    );

    expect(logGroups.length).toBeGreaterThanOrEqual(2);
    expect(logGroups.every((group) => group.retentionInDays === LOG_RETENTION_DAYS)).toBe(true);
  });

  it("keys the audit table by UTC day and leaves tables deletable so `sam delete` can clean up", async () => {
    const { Table } = await dynamo.send(new DescribeTableCommand({ TableName: "aqp-audit-academic" }));

    expect(Table?.KeySchema?.map((key) => key.AttributeName)).toEqual(["auditDay", "timestamp#eventId"]);
    expect(Table?.DeletionProtectionEnabled ?? false).toBe(false);
  });

  it("does not create the optional detection services by default", () => {
    expect(countOf(resources, "AWS::GuardDuty::Detector")).toBe(0);
    expect(countOf(resources, "AWS::SecurityHub::Hub")).toBe(0);
  });
});

// The production stage cannot be deployed into Floci: its static reference check rejects the Fn::If branches
// that the SAM translator generates around the conditional simulation function ('Unresolved resource
// dependencies [SimulateDonationFunction]'). Real CloudFormation accepts them. The production stage is verified
// by test/infra for every property that differs from the academic stage.
describe("academic stage with the optional detection services", () => {
  const stackName = "zta-detection";
  let resources: StackResourceSummary[];

  beforeAll(async () => {
    resources = await deploy(stackName, {
      StageName: "academic",
      CognitoDomainPrefix: "zta-detection-auth",
      EnableGuardDuty: "true",
      EnableSecurityHub: "true",
      EnableCloudTrail: "false",
    });
  });
  afterAll(async () => {
    await cloudFormation.send(new DeleteStackCommand({ StackName: stackName }));
  });

  it("creates the detection services when they are requested", () => {
    expect(countOf(resources, "AWS::GuardDuty::Detector")).toBe(1);
    expect(countOf(resources, "AWS::SecurityHub::Hub")).toBe(1);
  });

  it("skips the trail when the account already has one", () => {
    expect(countOf(resources, "AWS::CloudTrail::Trail")).toBe(0);
  });
});

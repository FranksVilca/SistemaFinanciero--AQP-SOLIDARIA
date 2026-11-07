import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DescribeUserPoolCommand } from "@aws-sdk/client-cognito-identity-provider";
import type { StackResourceSummary } from "@aws-sdk/client-cloudformation";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FLOCI_ENV } from "./flociEnv.js";
import { cognito } from "./helpers/cognitoUsers.js";
import { countOf, deleteStack, deployStack, physicalIdOf } from "./helpers/stack.js";

/**
 * Deploys infra/template.yaml, SAM transform included, into Floci and checks the result. It proves the
 * template is deployable and that the conditions produce what the contracts promise. Floci does not enforce
 * every property (for example it does not create the inline policies of the roles), so security properties are
 * asserted in test/infra and test/floci/iamEnforcement.test.ts.
 */

const FUNCTIONS_IN_ACADEMIC = 9;
const LOG_RETENTION_DAYS = 14;

const config = {
  region: FLOCI_ENV.AWS_REGION,
  endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
  credentials: { accessKeyId: FLOCI_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: FLOCI_ENV.AWS_SECRET_ACCESS_KEY },
};
const dynamo = new DynamoDBClient(config);
const logs = new CloudWatchLogsClient(config);

describe("academic stage", () => {
  const stackName = "zta-academic";
  let resources: StackResourceSummary[];

  beforeAll(async () => {
    resources = await deployStack(stackName, { StageName: "academic", CognitoDomainPrefix: "zta-academic-auth" });
  });
  afterAll(() => deleteStack(stackName));

  it("creates the nine functions, the four tables and the identity pieces", () => {
    expect(countOf(resources, "AWS::Lambda::Function")).toBe(FUNCTIONS_IN_ACADEMIC);
    expect(countOf(resources, "AWS::DynamoDB::Table")).toBe(4);
    expect(countOf(resources, "AWS::Cognito::UserPool")).toBe(1);
    expect(countOf(resources, "AWS::Cognito::UserPoolDomain")).toBe(1);
    expect(countOf(resources, "AWS::ApiGatewayV2::Authorizer")).toBe(1);
  });

  it("requires multi-factor authentication in the user pool", async () => {
    const { UserPool } = await cognito.send(
      new DescribeUserPoolCommand({ UserPoolId: physicalIdOf(resources, "AWS::Cognito::UserPool") })
    );

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
    resources = await deployStack(stackName, {
      StageName: "academic",
      CognitoDomainPrefix: "zta-detection-auth",
      EnableGuardDuty: "true",
      EnableSecurityHub: "true",
      EnableCloudTrail: "false",
    });
  });
  afterAll(() => deleteStack(stackName));

  it("creates the detection services when they are requested", () => {
    expect(countOf(resources, "AWS::GuardDuty::Detector")).toBe(1);
    expect(countOf(resources, "AWS::SecurityHub::Hub")).toBe(1);
  });

  it("skips the trail when the account already has one", () => {
    expect(countOf(resources, "AWS::CloudTrail::Trail")).toBe(0);
  });
});

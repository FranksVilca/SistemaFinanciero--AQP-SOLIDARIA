import type { StackResourceSummary } from "@aws-sdk/client-cloudformation";
import { DescribeUserPoolCommand } from "@aws-sdk/client-cognito-identity-provider";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { IAMClient, PutRolePolicyCommand } from "@aws-sdk/client-iam";
import {
  GetFunctionConfigurationCommand,
  LambdaClient,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import { handlerOf, lambdaFunctions, loadTemplate, policiesOf } from "../../infra/helpers/loadTemplate.js";
import { FLOCI_ENV } from "../flociEnv.js";
import { cognito } from "./cognitoUsers.js";
import { STAGE } from "./gateway.js";
import { buildPolicyDocument } from "./policyResolver.js";
import { physicalIdOf } from "./stack.js";

// How the Lambda containers reach the emulator: Docker Desktop and recent Docker releases resolve host.docker.internal.
export const EMULATOR_FROM_LAMBDA = process.env.FLOCI_LAMBDA_ENDPOINT ?? "http://host.docker.internal:4566";
const LAMBDA_TIMEOUT_SECONDS = 30;

const config = {
  region: FLOCI_ENV.AWS_REGION,
  endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
  credentials: { accessKeyId: FLOCI_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: FLOCI_ENV.AWS_SECRET_ACCESS_KEY },
};

async function tableArnsOfStage(userPoolId: string): Promise<Record<string, string>> {
  const dynamo = new DynamoDBClient(config);
  const arns: Record<string, string> = {};
  for (const [logicalId, name] of [
    ["ProjectsTable", `aqp-projects-${STAGE}`],
    ["DonationsTable", `aqp-donations-${STAGE}`],
    ["IdempotencyTable", `aqp-idempotency-${STAGE}`],
    ["AuditTable", `aqp-audit-${STAGE}`],
  ]) {
    arns[logicalId] = (await dynamo.send(new DescribeTableCommand({ TableName: name }))).Table!.TableArn!;
  }
  // The user pool the functions ask for the current groups of a person (a statement of their policies).
  arns.CognitoUserPool = (await cognito.send(new DescribeUserPoolCommand({ UserPoolId: userPoolId }))).UserPool!.Arn!;
  return arns;
}

/**
 * Puts the real code in each function of a deployed stack, points it at the emulator and gives its role the inline
 * policy that infra/template.yaml declares (Floci's CloudFormation creates the roles without it).
 */
export async function prepareFunctions(resources: StackResourceSummary[], code: Buffer): Promise<void> {
  const lambda = new LambdaClient(config);
  const iam = new IAMClient(config);
  const tableArns = await tableArnsOfStage(physicalIdOf(resources, "AWS::Cognito::UserPool"));
  const definitions = lambdaFunctions(loadTemplate("academic"));

  for (const functionResource of resources.filter((resource) => resource.ResourceType === "AWS::Lambda::Function")) {
    const functionName = functionResource.PhysicalResourceId!;
    const current = await lambda.send(new GetFunctionConfigurationCommand({ FunctionName: functionName }));
    const definition = definitions.find(([, candidate]) => handlerOf(candidate) === current.Handler)![1];

    await lambda.send(new UpdateFunctionCodeCommand({ FunctionName: functionName, ZipFile: code }));
    await lambda.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: functionName,
        Timeout: LAMBDA_TIMEOUT_SECONDS,
        Environment: {
          Variables: {
            ...current.Environment?.Variables,
            DYNAMODB_ENDPOINT: EMULATOR_FROM_LAMBDA,
            // The functions ask Cognito for the current groups of a person on sensitive actions.
            COGNITO_IDP_ENDPOINT: EMULATOR_FROM_LAMBDA,
            // Floci serves the OIDC userInfo endpoint of every pool under /cognito-idp (it has no hosted domain routing).
            COGNITO_USERINFO_URL: `${EMULATOR_FROM_LAMBDA}/cognito-idp/oauth2/userInfo`,
          },
        },
      })
    );
    await iam.send(
      new PutRolePolicyCommand({
        RoleName: current.Role!.split("/").pop()!,
        PolicyName: "template-inline-policy",
        PolicyDocument: buildPolicyDocument(policiesOf(definition), tableArns),
      })
    );
  }
}

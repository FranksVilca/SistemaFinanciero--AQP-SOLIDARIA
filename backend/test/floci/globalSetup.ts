import { createServer, type Server } from "node:http";
import {
  CreateAccessKeyCommand,
  CreateUserCommand,
  DeleteAccessKeyCommand,
  DeleteUserCommand,
  DeleteUserPolicyCommand,
  IAMClient,
  ListAccessKeysCommand,
  PutUserPolicyCommand,
} from "@aws-sdk/client-iam";
import {
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  CreateUserPoolCommand,
  DeleteUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import type { GlobalSetupContext } from "vitest/node";
import { buildTableDefinitions } from "../integration/helpers/tableDefinitions.js";
import {
  attachedPolicyDocuments,
  handlerOf,
  lambdaFunctions,
  loadTemplate,
  policiesOf,
} from "../infra/helpers/loadTemplate.js";
import { FLOCI_ENV } from "./flociEnv.js";
import { buildPolicyDocument } from "./helpers/policyResolver.js";

export interface FunctionCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    functionCredentials: Record<string, FunctionCredentials>;
    /** A user pool with the three role groups, whose ARN is the resource of the groups permission of the functions. */
    rolesPool: { userPoolId: string; arn: string };
  }
}

const TABLE_NAMES = {
  projects: FLOCI_ENV.PROJECTS_TABLE,
  donations: FLOCI_ENV.DONATIONS_TABLE,
  idempotency: FLOCI_ENV.IDEMPOTENCY_TABLE,
  audit: FLOCI_ENV.AUDIT_TABLE,
};
const LOGICAL_ID_BY_TABLE_NAME: Record<string, string> = {
  [TABLE_NAMES.projects]: "ProjectsTable",
  [TABLE_NAMES.donations]: "DonationsTable",
  [TABLE_NAMES.idempotency]: "IdempotencyTable",
  [TABLE_NAMES.audit]: "AuditTable",
};
const POLICY_NAME = "function-policy";
const HEALTH_ATTEMPTS = 40;
const HEALTH_WAIT_MS = 500;

const adminCredentials = { accessKeyId: FLOCI_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: FLOCI_ENV.AWS_SECRET_ACCESS_KEY };
const clientConfig = {
  region: FLOCI_ENV.AWS_REGION,
  endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
  credentials: adminCredentials,
};

let userInfoServer: Server | undefined;

function startUserInfoStub(): Promise<void> {
  const { port } = new URL(FLOCI_ENV.COGNITO_USERINFO_URL);
  userInfoServer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{}");
  });
  return new Promise((resolve) => userInfoServer!.listen(Number(port), "127.0.0.1", resolve));
}

async function waitForFloci(dynamo: DynamoDBClient): Promise<void> {
  for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt++) {
    try {
      await dynamo.send(new ListTablesCommand({}));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, HEALTH_WAIT_MS));
    }
  }
  throw new Error(
    `Floci is not reachable at ${FLOCI_ENV.FLOCI_ENDPOINT}. Start it with: ` +
      "docker compose -f backend/test/floci/docker-compose.yml up -d"
  );
}

async function recreateTables(dynamo: DynamoDBClient): Promise<Record<string, string>> {
  const { TableNames = [] } = await dynamo.send(new ListTablesCommand({}));
  for (const name of TableNames.filter((candidate) => candidate in LOGICAL_ID_BY_TABLE_NAME)) {
    await dynamo.send(new DeleteTableCommand({ TableName: name }));
  }

  const arns: Record<string, string> = {};
  for (const definition of buildTableDefinitions(TABLE_NAMES)) {
    const { TableDescription } = await dynamo.send(new CreateTableCommand(definition));
    arns[LOGICAL_ID_BY_TABLE_NAME[definition.TableName!]] = TableDescription!.TableArn!;
  }
  return arns;
}

async function recreateUser(iam: IAMClient, userName: string, policyDocument: string): Promise<FunctionCredentials> {
  try {
    const { AccessKeyMetadata = [] } = await iam.send(new ListAccessKeysCommand({ UserName: userName }));
    for (const key of AccessKeyMetadata) {
      await iam.send(new DeleteAccessKeyCommand({ UserName: userName, AccessKeyId: key.AccessKeyId }));
    }
    await iam.send(new DeleteUserPolicyCommand({ UserName: userName, PolicyName: POLICY_NAME }));
    await iam.send(new DeleteUserCommand({ UserName: userName }));
  } catch {
    // The user does not exist yet on a fresh emulator: nothing to clean up.
  }

  await iam.send(new CreateUserCommand({ UserName: userName }));
  await iam.send(
    new PutUserPolicyCommand({ UserName: userName, PolicyName: POLICY_NAME, PolicyDocument: policyDocument })
  );
  const { AccessKey } = await iam.send(new CreateAccessKeyCommand({ UserName: userName }));
  return { accessKeyId: AccessKey!.AccessKeyId!, secretAccessKey: AccessKey!.SecretAccessKey! };
}

const ROLE_GROUPS = ["DONANTE", "GESTOR", "AUDITOR"];

async function createRolesPool(): Promise<{ userPoolId: string; arn: string }> {
  const cognito = new CognitoIdentityProviderClient(clientConfig);
  const { UserPool } = await cognito.send(new CreateUserPoolCommand({ PoolName: "aqp-floci-roles" }));
  for (const GroupName of ROLE_GROUPS) {
    await cognito.send(new CreateGroupCommand({ UserPoolId: UserPool!.Id!, GroupName }));
  }
  return { userPoolId: UserPool!.Id!, arn: UserPool!.Arn! };
}

export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  await startUserInfoStub();
  const dynamo = new DynamoDBClient(clientConfig);
  await waitForFloci(dynamo);
  const arns = await recreateTables(dynamo);
  const rolesPool = await createRolesPool();
  arns.CognitoUserPool = rolesPool.arn;

  // One IAM user per function, holding exactly the inline policy that infra/template.yaml gives its role.
  const iam = new IAMClient(clientConfig);
  const functionCredentials: Record<string, FunctionCredentials> = {};
  const template = loadTemplate("academic");
  for (const [logicalId, definition] of lambdaFunctions(template)) {
    const policies = [...policiesOf(definition), ...attachedPolicyDocuments(template, logicalId)];
    const policyDocument = buildPolicyDocument(policies, arns);
    functionCredentials[handlerOf(definition)] = await recreateUser(iam, `fn-${logicalId}`, policyDocument);
  }
  provide("functionCredentials", functionCredentials);
  provide("rolesPool", rolesPool);

  return async () => {
    await new Promise<void>((resolve) => (userInfoServer ? userInfoServer.close(() => resolve()) : resolve()));
    await new CognitoIdentityProviderClient(clientConfig)
      .send(new DeleteUserPoolCommand({ UserPoolId: rolesPool.userPoolId }))
      .catch(() => undefined);
  };
}

import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";
import { createServer, type Server } from "node:http";
import { buildTableDefinitions } from "./helpers/tableDefinitions.js";
import { INTEGRATION_ENV } from "./testEnv.js";

const SETUP_WAIT_ATTEMPTS = 30;
const SETUP_WAIT_MS = 500;

const TABLE_DEFINITIONS = buildTableDefinitions({
  projects: INTEGRATION_ENV.PROJECTS_TABLE,
  donations: INTEGRATION_ENV.DONATIONS_TABLE,
  idempotency: INTEGRATION_ENV.IDEMPOTENCY_TABLE,
  audit: INTEGRATION_ENV.AUDIT_TABLE,
});

function createClient(): DynamoDBClient {
  return new DynamoDBClient({
    region: INTEGRATION_ENV.AWS_REGION,
    endpoint: INTEGRATION_ENV.DYNAMODB_ENDPOINT,
    credentials: {
      accessKeyId: INTEGRATION_ENV.AWS_ACCESS_KEY_ID,
      secretAccessKey: INTEGRATION_ENV.AWS_SECRET_ACCESS_KEY,
    },
  });
}

async function waitForDynamo(client: DynamoDBClient): Promise<void> {
  for (let attempt = 0; attempt < SETUP_WAIT_ATTEMPTS; attempt++) {
    try {
      await client.send(new ListTablesCommand({}));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, SETUP_WAIT_MS));
    }
  }
  throw new Error(
    `DynamoDB Local is not reachable at ${INTEGRATION_ENV.DYNAMODB_ENDPOINT}. ` +
      "Start it with: docker compose -f backend/test/integration/docker-compose.yml up -d"
  );
}

async function dropTables(client: DynamoDBClient): Promise<void> {
  const { TableNames = [] } = await client.send(new ListTablesCommand({}));
  const ours = new Set(TABLE_DEFINITIONS.map((definition) => definition.TableName));
  for (const tableName of TableNames.filter((name) => ours.has(name))) {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
  }
}

let userInfoServer: Server | undefined;

/** Answers 200 to every userInfo request: the session of every test caller is active unless a test says otherwise. */
function startUserInfoStub(): Promise<void> {
  const { port } = new URL(INTEGRATION_ENV.COGNITO_USERINFO_URL);
  userInfoServer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ sub: "stub" }));
  });
  return new Promise((resolve) => userInfoServer!.listen(Number(port), "127.0.0.1", resolve));
}

export async function setup(): Promise<void> {
  await startUserInfoStub();
  const client = createClient();
  await waitForDynamo(client);
  await dropTables(client);
  for (const definition of TABLE_DEFINITIONS) {
    await client.send(new CreateTableCommand(definition));
  }
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: INTEGRATION_ENV.IDEMPOTENCY_TABLE,
      TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
    })
  );
}

export async function teardown(): Promise<void> {
  await new Promise<void>((resolve) => (userInfoServer ? userInfoServer.close(() => resolve()) : resolve()));
  await dropTables(createClient());
}

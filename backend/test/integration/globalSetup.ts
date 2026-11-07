import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  UpdateTimeToLiveCommand,
  type CreateTableCommandInput,
} from "@aws-sdk/client-dynamodb";
import { createServer, type Server } from "node:http";
import { INTEGRATION_ENV } from "./testEnv.js";

const SETUP_WAIT_ATTEMPTS = 30;
const SETUP_WAIT_MS = 500;

const stringAttribute = (name: string) => ({ AttributeName: name, AttributeType: "S" as const });
const keyElement = (name: string, type: "HASH" | "RANGE") => ({ AttributeName: name, KeyType: type });

// Mirrors the key schemas of infra/template.yaml.
const TABLE_DEFINITIONS: CreateTableCommandInput[] = [
  {
    TableName: INTEGRATION_ENV.PROJECTS_TABLE,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [stringAttribute("projectId"), stringAttribute("status"), stringAttribute("createdAt")],
    KeySchema: [keyElement("projectId", "HASH")],
    GlobalSecondaryIndexes: [
      {
        IndexName: "status-createdAt-index",
        KeySchema: [keyElement("status", "HASH"), keyElement("createdAt", "RANGE")],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  },
  {
    TableName: INTEGRATION_ENV.DONATIONS_TABLE,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [stringAttribute("donationId"), stringAttribute("donorSub"), stringAttribute("createdAt")],
    KeySchema: [keyElement("donationId", "HASH")],
    GlobalSecondaryIndexes: [
      {
        IndexName: "donorSub-createdAt-index",
        KeySchema: [keyElement("donorSub", "HASH"), keyElement("createdAt", "RANGE")],
        Projection: { ProjectionType: "ALL" },
      },
    ],
  },
  {
    TableName: INTEGRATION_ENV.IDEMPOTENCY_TABLE,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [stringAttribute("pk")],
    KeySchema: [keyElement("pk", "HASH")],
  },
  {
    TableName: INTEGRATION_ENV.AUDIT_TABLE,
    BillingMode: "PAY_PER_REQUEST",
    AttributeDefinitions: [stringAttribute("auditDay"), stringAttribute("timestamp#eventId")],
    KeySchema: [keyElement("auditDay", "HASH"), keyElement("timestamp#eventId", "RANGE")],
  },
];

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

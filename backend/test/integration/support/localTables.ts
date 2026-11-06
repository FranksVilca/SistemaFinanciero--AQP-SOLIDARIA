import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  waitUntilTableExists,
  type CreateTableCommandInput,
} from "@aws-sdk/client-dynamodb";
import { template, ofType, refOf } from "../../support/cfnTemplate.js";

// DynamoDB Local tables built from the key schemas declared in infra/template.yaml, so the
// integration run exercises the same keys and GSIs as the deployed stack.

export const TABLE_PREFIX = "aqp-it-";

export const SKIP_MESSAGE =
  "[integration] DYNAMODB_ENDPOINT is not set: skipping DynamoDB Local integration tests. " +
  "Start DynamoDB Local (`npm run dynamodb:local`) and run " +
  "`DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:integration`.";

export const hasLocalEndpoint = (): boolean => Boolean(process.env.DYNAMODB_ENDPOINT);

// DynamoDB Local scopes tables by access key and region, so every process must use the same
// fake credentials. They also guarantee these tests cannot authenticate against real AWS.
export function applyLocalCredentials(): void {
  process.env.AWS_ACCESS_KEY_ID = "local";
  process.env.AWS_SECRET_ACCESS_KEY = "local";
  process.env.AWS_REGION = "us-east-1";
  delete process.env.AWS_SESSION_TOKEN;
  delete process.env.AWS_PROFILE;
}

type TableProperties = Pick<
  CreateTableCommandInput,
  "AttributeDefinitions" | "KeySchema" | "GlobalSecondaryIndexes"
>;

// Template Globals map env vars (PROJECTS_TABLE, ...) to table logical ids.
export function localTables(): { envVar: string; tableName: string; properties: TableProperties }[] {
  const envVars = template.Globals?.Function?.Environment?.Variables ?? {};
  const tables = new Map(ofType("AWS::DynamoDB::Table"));
  return Object.entries(envVars).flatMap(([envVar, value]) => {
    const table = tables.get(refOf(value) ?? "");
    if (!table) return [];
    const { AttributeDefinitions, KeySchema, GlobalSecondaryIndexes } =
      table.Properties as TableProperties;
    return [{
      envVar,
      tableName: `${TABLE_PREFIX}${envVar.toLowerCase().replace(/_table$/, "")}`,
      properties: { AttributeDefinitions, KeySchema, GlobalSecondaryIndexes },
    }];
  });
}

// The CI service container may still be starting: retry ListTables for up to ~30 s.
async function listTablesWhenReady(client: DynamoDBClient): Promise<string[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { TableNames = [] } = await client.send(new ListTablesCommand({}));
      return TableNames;
    } catch (err) {
      if (attempt >= 30) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function recreateLocalTables(endpoint: string): Promise<string[]> {
  const client = new DynamoDBClient({ endpoint, region: process.env.AWS_REGION });
  try {
    const TableNames = await listTablesWhenReady(client);
    const tables = localTables();
    for (const { tableName, properties } of tables) {
      if (TableNames.includes(tableName)) {
        await client.send(new DeleteTableCommand({ TableName: tableName }));
      }
      await client.send(
        new CreateTableCommand({ TableName: tableName, BillingMode: "PAY_PER_REQUEST", ...properties })
      );
      await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: tableName });
    }
    return tables.map((t) => t.tableName);
  } finally {
    client.destroy();
  }
}

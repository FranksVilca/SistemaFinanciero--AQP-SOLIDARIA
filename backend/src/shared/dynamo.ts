import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  TransactWriteCommand,
  TransactGetCommand,
} from "@aws-sdk/lib-dynamodb";

// DYNAMODB_ENDPOINT is declared empty in the template; only local runs (sam local, tests)
// set it, so an empty value must fall back to the real regional endpoint.
export function dynamoClientConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    region: env.AWS_REGION || "us-east-1",
    endpoint: env.DYNAMODB_ENDPOINT || undefined,
  };
}

const rawClient = new DynamoDBClient(dynamoClientConfig());

export const docClient = DynamoDBDocumentClient.from(rawClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

export const TABLE_NAMES = {
  projects: process.env.PROJECTS_TABLE || "aqp-projects",
  donations: process.env.DONATIONS_TABLE || "aqp-donations",
  idempotency: process.env.IDEMPOTENCY_TABLE || "aqp-idempotency",
  audit: process.env.AUDIT_TABLE || "aqp-audit",
};

export {
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  TransactWriteCommand,
  TransactGetCommand,
};

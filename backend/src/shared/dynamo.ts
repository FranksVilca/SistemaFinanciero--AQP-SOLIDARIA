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

const region = process.env.AWS_REGION || "us-east-1";

const rawClient = new DynamoDBClient({
  region,
  endpoint: process.env.DYNAMODB_ENDPOINT,
});

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

export { GetCommand, PutCommand, UpdateCommand, QueryCommand, TransactWriteCommand, TransactGetCommand };

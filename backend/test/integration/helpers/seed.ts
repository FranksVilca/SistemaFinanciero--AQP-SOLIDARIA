import { randomUUID } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, TABLE_NAMES } from "../../../src/shared/dynamo.js";
import { CURRENCY, DONATION_STATUS, PROJECT_STATUS } from "../../../src/shared/constants.js";

const DEFAULT_GOAL_CENTS = 500_000;
const DEFAULT_DONATION_CENTS = 5_000;

type Item = Record<string, unknown>;

export async function seedProject(overrides: Item = {}): Promise<Item> {
  const now = new Date().toISOString();
  const project = {
    projectId: randomUUID(),
    title: "Proyecto de prueba",
    description: "Descripción de un proyecto de prueba",
    goalAmountCents: DEFAULT_GOAL_CENTS,
    confirmedAmountCents: 0,
    currency: CURRENCY,
    status: PROJECT_STATUS.published,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAMES.projects, Item: project }));
  return project;
}

export async function seedDonation(donorSub: string, projectId: string, overrides: Item = {}): Promise<Item> {
  const now = new Date().toISOString();
  const donation = {
    donationId: randomUUID(),
    projectId,
    donorSub,
    amountCents: DEFAULT_DONATION_CENTS,
    currency: CURRENCY,
    status: DONATION_STATUS.pending,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAMES.donations, Item: donation }));
  return donation;
}

export async function readProject(projectId: string): Promise<Item | undefined> {
  const result = await docClient.send(new GetCommand({ TableName: TABLE_NAMES.projects, Key: { projectId } }));
  return result.Item;
}

export async function readDonation(donationId: string): Promise<Item | undefined> {
  const result = await docClient.send(new GetCommand({ TableName: TABLE_NAMES.donations, Key: { donationId } }));
  return result.Item;
}

export async function countDonationsOf(donorSub: string): Promise<number> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAMES.donations,
      IndexName: "donorSub-createdAt-index",
      KeyConditionExpression: "donorSub = :sub",
      ExpressionAttributeValues: { ":sub": donorSub },
    })
  );
  return result.Count ?? 0;
}

export async function readAllAuditEvents(): Promise<Item[]> {
  const result = await docClient.send(new ScanCommand({ TableName: TABLE_NAMES.audit }));
  return result.Items ?? [];
}

export async function clearTable(tableName: string, keyNames: string[]): Promise<void> {
  const { Items = [] } = await docClient.send(new ScanCommand({ TableName: tableName }));
  for (const item of Items) {
    const Key = Object.fromEntries(keyNames.map((name) => [name, item[name]]));
    await docClient.send(new DeleteCommand({ TableName: tableName, Key }));
  }
}

export async function clearAllTables(): Promise<void> {
  await clearTable(TABLE_NAMES.projects, ["projectId"]);
  await clearTable(TABLE_NAMES.donations, ["donationId"]);
  await clearTable(TABLE_NAMES.idempotency, ["pk"]);
  await clearTable(TABLE_NAMES.audit, ["auditDay", "timestamp#eventId"]);
}

export async function countItems(tableName: string): Promise<number> {
  const result = await docClient.send(new ScanCommand({ TableName: tableName, Select: "COUNT" }));
  return result.Count ?? 0;
}

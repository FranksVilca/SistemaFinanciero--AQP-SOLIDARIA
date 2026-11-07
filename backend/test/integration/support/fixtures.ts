import { randomUUID } from "node:crypto";
import { docClient, TABLE_NAMES, GetCommand, PutCommand, QueryCommand } from "../../../src/shared/dynamo.js";

export const donorEvent = (sub: string, extra: Record<string, unknown> = {}) => ({
  ...extra,
  requestContext: {
    requestId: `req-it-${randomUUID()}`,
    authorizer: { jwt: { claims: { sub, "cognito:groups": '["DONANTE"]' } } },
  },
});

export async function seedPublishedProject(): Promise<string> {
  const projectId = randomUUID();
  const now = new Date().toISOString();
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAMES.projects,
      Item: {
        projectId,
        title: "Proyecto de integración",
        description: "Proyecto sembrado para pruebas contra DynamoDB Local",
        goalAmountCents: 500000,
        confirmedAmountCents: 0,
        currency: "PEN",
        status: "PUBLICADO",
        createdAt: now,
        updatedAt: now,
      },
    })
  );
  return projectId;
}

export async function seedPendingDonation(projectId: string, donorSub: string, amountCents: number) {
  const donationId = randomUUID();
  const now = new Date().toISOString();
  const donation = {
    donationId,
    projectId,
    donorSub,
    amountCents,
    currency: "PEN",
    status: "PENDIENTE_SIMULACION",
    createdAt: now,
    updatedAt: now,
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAMES.donations, Item: donation }));
  return donation;
}

export async function getItem(table: keyof typeof TABLE_NAMES, key: Record<string, string>) {
  const result = await docClient.send(
    new GetCommand({ TableName: TABLE_NAMES[table], Key: key, ConsistentRead: true })
  );
  return result.Item;
}

export async function donationsOf(donorSub: string) {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAMES.donations,
      IndexName: "donorSub-createdAt-index",
      KeyConditionExpression: "donorSub = :sub",
      ExpressionAttributeValues: { ":sub": donorSub },
    })
  );
  return result.Items ?? [];
}

export const statusCounts = (responses: { statusCode: number }[]) =>
  responses.reduce<Record<number, number>>((acc, { statusCode }) => {
    acc[statusCode] = (acc[statusCode] ?? 0) + 1;
    return acc;
  }, {});

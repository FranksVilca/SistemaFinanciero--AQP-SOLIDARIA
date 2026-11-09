import { z } from "zod";
import { pseudonymizeActor } from "../audit/recordAuditEvent.js";
import { withAuth } from "../authz/withAuth.js";
import {
  AUTHZ_ACTIONS,
  DONATION_STATUS,
  DONATIONS_STATUS_INDEX,
  REVIEW_QUEUE_DEFAULT_LIMIT,
  REVIEW_QUEUE_MAX_LIMIT,
} from "../shared/constants.js";
import { docClient, QueryCommand, TABLE_NAMES } from "../shared/dynamo.js";
import { ValidationError } from "../shared/errors.js";
import { logInfo } from "../shared/logger.js";
import { buildSuccessResponse } from "../shared/response.js";

type Item = Record<string, unknown>;

// The token is the last key of the index that the previous page read. It only ever points into the queue: a token that
// names another status (or anything else) is refused instead of being handed to DynamoDB.
const PageKeySchema = z.strictObject({
  donationId: z.string().min(1),
  status: z.literal(DONATION_STATUS.underReview),
  createdAt: z.string().min(1),
});

function readLimit(raw: string | undefined): number {
  if (raw === undefined) return REVIEW_QUEUE_DEFAULT_LIMIT;
  const limit = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(limit >= 1 && limit <= REVIEW_QUEUE_MAX_LIMIT)) {
    throw new ValidationError(`El parámetro limit debe ser un entero entre 1 y ${REVIEW_QUEUE_MAX_LIMIT}`);
  }
  return limit;
}

function decodeNextToken(token: string | undefined): Item | undefined {
  if (token === undefined) return undefined;
  try {
    return PageKeySchema.parse(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
  } catch {
    throw new ValidationError("El parámetro nextToken es inválido");
  }
}

const encodeNextToken = (key: Item | undefined): string | undefined =>
  key ? Buffer.from(JSON.stringify(key), "utf8").toString("base64url") : undefined;

/** What a reviewer sees of a held donation: never who the donor is, only a stable pseudonym to spot repetitions. */
function toQueueItem(donation: Item): Item {
  return {
    donationId: donation.donationId,
    projectId: donation.projectId,
    amountCents: donation.amountCents,
    createdAt: donation.createdAt,
    ...(Array.isArray(donation.reviewReasons) && { reviewReasons: donation.reviewReasons }),
    donorRef: pseudonymizeActor(String(donation.donorSub)),
  };
}

export const handler = withAuth(
  async ({ event, requestId }) => {
    const limit = readLimit(event.queryStringParameters?.limit);
    const startKey = decodeNextToken(event.queryStringParameters?.nextToken);

    const page = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.donations,
        IndexName: DONATIONS_STATUS_INDEX,
        KeyConditionExpression: "#status = :status",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": DONATION_STATUS.underReview },
        ScanIndexForward: true,
        Limit: limit,
        ...(startKey && { ExclusiveStartKey: startKey }),
      })
    );

    const items = (page.Items ?? []).map(toQueueItem);
    const nextToken = encodeNextToken(page.LastEvaluatedKey);
    logInfo("Review queue returned", { requestId, count: items.length });
    return buildSuccessResponse({ items, ...(nextToken && { nextToken }) });
  },
  { action: AUTHZ_ACTIONS.listReviews, resourceType: "Donation" }
);

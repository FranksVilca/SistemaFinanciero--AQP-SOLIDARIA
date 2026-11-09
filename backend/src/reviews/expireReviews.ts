import { randomUUID } from "node:crypto";
import {
  AUDIT_EVENT_TYPES,
  AUDIT_OUTCOME,
  DONATION_STATUS,
  DONATIONS_STATUS_INDEX,
  REVIEW_EXPIRED_MOTIVO,
  REVIEW_EXPIRY_DEFAULT_DAYS,
  REVIEW_EXPIRY_MAX_PER_RUN,
  REVIEW_EXPIRY_PAGE_SIZE,
  SYSTEM_ACTIONS,
  SYSTEM_ACTOR,
} from "../shared/constants.js";
import { docClient, QueryCommand, TABLE_NAMES } from "../shared/dynamo.js";
import { logInfo, logWarn } from "../shared/logger.js";
import { auditReview } from "./auditReview.js";
import { resolveReview } from "./resolveReview.js";

const MS_PER_DAY = 86_400_000;

export interface ExpirySummary {
  expired: number;
  /** Read from the index but already resolved by a reviewer when the job tried: left as the reviewer decided. */
  skipped: number;
  /** The run stopped at its bound: the remaining overdue donations wait for the next run. */
  hasMore: boolean;
}

/** A missing or malformed value keeps the safe default instead of expiring everything or nothing. */
export function readExpiryDays(env: Record<string, string | undefined> = process.env): number {
  const raw = env.REVIEW_EXPIRY_DAYS?.trim();
  const days = raw && /^\d+$/.test(raw) ? Number(raw) : 0;
  return days > 0 ? days : REVIEW_EXPIRY_DEFAULT_DAYS;
}

async function expireOne(donationId: string, now: string, expiryDays: number, requestId: string): Promise<boolean> {
  const resolved = await resolveReview({
    donationId,
    decision: "RECHAZAR",
    motivo: REVIEW_EXPIRED_MOTIVO,
    reviewedBy: SYSTEM_ACTOR,
    reviewedAt: now,
  });
  if (resolved) {
    await auditReview({
      eventType: AUDIT_EVENT_TYPES.reviewExpired,
      requestId,
      system: true,
      resourceRef: `donation:${donationId}`,
      action: SYSTEM_ACTIONS.expireReview,
      outcome: AUDIT_OUTCOME.success,
      details: { expiryDays },
    });
  }
  return resolved;
}

/**
 * Scheduled once a day (EventBridge, see infra/template.yaml), not an API route: nobody calls it with a token, so it is
 * not wrapped by withAuth. A donation nobody reviewed within REVIEW_EXPIRY_DAYS is rejected, through the same
 * conditional write a reviewer uses, so a decision that arrives at the same moment always wins over the expiry or
 * loses cleanly. Each run is bounded (REVIEW_EXPIRY_MAX_PER_RUN), well inside the timeout of the function.
 */
export async function handler(_event?: unknown, context?: { awsRequestId?: string }): Promise<ExpirySummary> {
  const requestId = context?.awsRequestId ?? `job-${randomUUID()}`;
  const expiryDays = readExpiryDays();
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const cutoff = new Date(nowDate.getTime() - expiryDays * MS_PER_DAY).toISOString();
  const summary: ExpirySummary = { expired: 0, skipped: 0, hasMore: false };

  let startKey: Record<string, unknown> | undefined;
  do {
    const remaining = REVIEW_EXPIRY_MAX_PER_RUN - summary.expired - summary.skipped;
    const page = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.donations,
        IndexName: DONATIONS_STATUS_INDEX,
        KeyConditionExpression: "#status = :status AND createdAt < :cutoff",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": DONATION_STATUS.underReview, ":cutoff": cutoff },
        ScanIndexForward: true,
        Limit: Math.min(REVIEW_EXPIRY_PAGE_SIZE, remaining),
        ...(startKey && { ExclusiveStartKey: startKey }),
      })
    );
    for (const item of page.Items ?? []) {
      if (await expireOne(String(item.donationId), now, expiryDays, requestId)) summary.expired++;
      else summary.skipped++;
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey && summary.expired + summary.skipped < REVIEW_EXPIRY_MAX_PER_RUN);

  summary.hasMore = startKey !== undefined;
  logInfo("Overdue reviews expired", { requestId, ...summary, expiryDays });
  // A backlog the run could not clear in one pass (a flood of held donations) must be visible, not silent.
  if (summary.hasMore) logWarn("Overdue reviews remain for the next run", { requestId, ...summary, expiryDays });
  return summary;
}

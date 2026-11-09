import { randomUUID } from "node:crypto";
import type { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/audit/recordAuditEvent.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/audit/recordAuditEvent.js")>()),
  recordAuditEvent: vi.fn(async () => undefined),
}));

import { recordAuditEvent } from "../../src/audit/recordAuditEvent.js";
import { handler as expireReviews } from "../../src/reviews/expireReviews.js";
import { TABLE_NAMES } from "../../src/shared/dynamo.js";
import { FakeDynamo } from "../donations/helpers/fakeDynamo.js";

type Item = Record<string, unknown>;

const NOW = new Date("2026-11-09T06:00:00.000Z");
const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

let dynamo: FakeDynamo;
let queries: Array<QueryCommand["input"]>;

function heldSince(createdAt: string, overrides: Item = {}): string {
  const donationId = randomUUID();
  dynamo.put(
    TABLE_NAMES.donations,
    { donationId, projectId: randomUUID(), donorSub: "donor-1", status: "EN_REVISION", createdAt, ...overrides },
    ["donationId"]
  );
  return donationId;
}

/** Plays the status index: the held donations created before the cutoff, oldest first, a page at a time. */
function indexServes(snapshot: Item[] = dynamo.items(TABLE_NAMES.donations)): void {
  dynamo.onQuery = (input) => {
    queries.push(input);
    const cutoff = String(input.ExpressionAttributeValues?.[":cutoff"]);
    const matching = snapshot
      .filter((item) => item.status === "EN_REVISION" && String(item.createdAt) < cutoff)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const start = input.ExclusiveStartKey
      ? matching.findIndex((item) => item.donationId === input.ExclusiveStartKey!.donationId) + 1
      : 0;
    const page = matching.slice(start, start + (input.Limit ?? matching.length));
    const last = page.at(-1);
    return {
      Items: page,
      ...(start + page.length < matching.length && last && { LastEvaluatedKey: { donationId: last.donationId } }),
    };
  };
}

const statusOf = (donationId: string) => dynamo.get(TABLE_NAMES.donations, { donationId })?.status;
const expiredEvents = () =>
  vi
    .mocked(recordAuditEvent)
    .mock.calls.map(([input]) => input)
    .filter((input) => input.eventType === "REVIEW_EXPIRED");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(recordAuditEvent).mockClear();
  delete process.env.REVIEW_EXPIRY_DAYS;
  queries = [];
  dynamo = new FakeDynamo();
  dynamo.install();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.REVIEW_EXPIRY_DAYS;
});

describe("the daily expiry of reviews", () => {
  it("rejects only the donations held for longer than 7 days, as RECHAZADA_REVISION by the system", async () => {
    const old = heldSince(daysAgo(8));
    const recent = heldSince(daysAgo(6));
    indexServes();

    const summary = await expireReviews();

    expect(statusOf(old)).toBe("RECHAZADA_REVISION");
    expect(statusOf(recent)).toBe("EN_REVISION");
    expect(dynamo.get(TABLE_NAMES.donations, { donationId: old })).toMatchObject({
      reviewDecision: "RECHAZAR",
      reviewMotivo: "Vencida sin revisión",
      reviewedBy: "system",
      reviewedAt: NOW.toISOString(),
    });
    expect(queries[0]).toMatchObject({
      IndexName: "status-createdAt-index",
      ScanIndexForward: true,
      ExpressionAttributeValues: { ":status": "EN_REVISION", ":cutoff": daysAgo(7) },
    });
    expect(summary).toEqual({ expired: 1, skipped: 0, hasMore: false });
  });

  it("takes the threshold from REVIEW_EXPIRY_DAYS", async () => {
    process.env.REVIEW_EXPIRY_DAYS = "3";
    const fourDays = heldSince(daysAgo(4));
    indexServes();

    await expireReviews();

    expect(statusOf(fourDays)).toBe("RECHAZADA_REVISION");
    expect(queries[0].ExpressionAttributeValues?.[":cutoff"]).toBe(daysAgo(3));
  });

  it.each(["0", "-2", "siete", ""])("keeps the 7 days when REVIEW_EXPIRY_DAYS is %j", async (value) => {
    process.env.REVIEW_EXPIRY_DAYS = value;
    indexServes();

    await expireReviews();

    expect(queries[0].ExpressionAttributeValues?.[":cutoff"]).toBe(daysAgo(7));
  });

  it("writes one REVIEW_EXPIRED audit event per expired donation, with the system as actor", async () => {
    const first = heldSince(daysAgo(10));
    const second = heldSince(daysAgo(9));
    indexServes();

    await expireReviews();

    expect(expiredEvents()).toEqual([
      expect.objectContaining({
        resourceRef: `donation:${first}`,
        action: "ExpireReview",
        outcome: "SUCCESS",
        system: true,
        details: { expiryDays: 7 },
      }),
      expect.objectContaining({ resourceRef: `donation:${second}`, system: true }),
    ]);
    expect(expiredEvents().every((event) => event.actorSub === undefined)).toBe(true);
  });

  it("skips a donation that a reviewer resolved after the index was read (conditional write)", async () => {
    const decided = heldSince(daysAgo(9));
    const stillHeld = heldSince(daysAgo(8));
    indexServes(dynamo.items(TABLE_NAMES.donations).map((item) => ({ ...item })));
    dynamo.put(
      TABLE_NAMES.donations,
      { ...dynamo.get(TABLE_NAMES.donations, { donationId: decided }), status: "PENDIENTE_SIMULACION" },
      ["donationId"]
    );

    const summary = await expireReviews();

    expect(statusOf(decided)).toBe("PENDIENTE_SIMULACION");
    expect(statusOf(stillHeld)).toBe("RECHAZADA_REVISION");
    expect(expiredEvents().map((event) => event.resourceRef)).toEqual([`donation:${stillHeld}`]);
    expect(summary).toEqual({ expired: 1, skipped: 1, hasMore: false });
  });

  it("resolves at most 100 donations per run, reading the index in pages of 25", async () => {
    for (let index = 0; index < 130; index++) heldSince(daysAgo(30 - index / 10));
    indexServes();

    const summary = await expireReviews();

    expect(summary).toEqual({ expired: 100, skipped: 0, hasMore: true });
    expect(queries).toHaveLength(4);
    expect(queries.every((query) => query.Limit === 25)).toBe(true);
    expect(dynamo.items(TABLE_NAMES.donations).filter((item) => item.status === "EN_REVISION")).toHaveLength(30);
  });

  it("does nothing when no donation is overdue", async () => {
    heldSince(daysAgo(1));
    indexServes();

    expect(await expireReviews()).toEqual({ expired: 0, skipped: 0, hasMore: false });
    expect(dynamo.updates).toHaveLength(0);
  });
});

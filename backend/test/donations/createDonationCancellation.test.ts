import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/audit/recordAuditEvent.js", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));

import { recordAuditEvent } from "../../src/audit/recordAuditEvent.js";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { TABLE_NAMES } from "../../src/shared/dynamo.js";
import { buildEvent, identityFor, type TestIdentity } from "../integration/helpers/events.js";
import { FakeDynamo } from "./helpers/fakeDynamo.js";

// Order of the items in the transaction: idempotency record, donation, minute counter, hourly window.
const NONE = "None";
const FAILED = "ConditionalCheckFailed";
const CONFLICT = "TransactionConflict";
const MAX_ATTEMPTS = 8;
const PROJECT_ID = randomUUID();

let dynamo: FakeDynamo;
let donor: TestIdentity;

function donate(key: string = randomUUID()) {
  return createDonation(
    buildEvent({
      identity: donor,
      headers: { "Idempotency-Key": key },
      body: { projectId: PROJECT_ID, amountCents: 1_000 },
    })
  );
}

const bodyOf = (response: { body: string }) => JSON.parse(response.body);
const createdDonations = () => dynamo.items(TABLE_NAMES.donations).length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-01-15T10:10:20.000Z"));
  // Full jitter draws the delay in [0, cap): zero keeps the retries instant.
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.mocked(recordAuditEvent).mockClear();
  donor = identityFor("DONANTE");
  dynamo = new FakeDynamo();
  dynamo.put(TABLE_NAMES.projects, { projectId: PROJECT_ID, status: "PUBLICADO", createdBy: "manager-1" }, [
    "projectId",
  ]);
  dynamo.install();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cancelled donation transactions are classified by their reasons", () => {
  it("answers a failed idempotency condition with the original donation", async () => {
    const key = randomUUID();
    const first = await donate(key);

    const replay = await donate(key);

    expect(replay.statusCode).toBe(201);
    expect(bodyOf(replay).donationId).toBe(bodyOf(first).donationId);
    expect(dynamo.transactions).toHaveLength(2);
  });

  it("answers a failed minute counter condition with 429 without retrying", async () => {
    dynamo.failNextTransactions([NONE, NONE, FAILED, NONE]);

    const response = await donate();

    expect(response.statusCode).toBe(429);
    expect(dynamo.transactions).toHaveLength(1);
    expect(vi.mocked(recordAuditEvent).mock.calls.map(([input]) => input.eventType)).toContain("DONATION_RATE_LIMITED");
  });

  it("retries a stale hourly window and then creates the donation", async () => {
    dynamo.failNextTransactions([NONE, NONE, NONE, FAILED]);

    const response = await donate();

    expect(response.statusCode).toBe(201);
    expect(dynamo.transactions).toHaveLength(2);
    expect(createdDonations()).toBe(1);
  });

  it("retries a transaction conflict on any item", async () => {
    dynamo.failNextTransactions([CONFLICT, NONE, NONE, NONE], [NONE, NONE, CONFLICT, NONE]);

    const response = await donate();

    expect(response.statusCode).toBe(201);
    expect(dynamo.transactions).toHaveLength(3);
  });

  it.each([
    ["a validation error", [NONE, NONE, "ValidationError", NONE]],
    ["throttling", [NONE, "ThrottlingError", NONE, NONE]],
    ["exceeded throughput", [NONE, NONE, NONE, "ProvisionedThroughputExceeded"]],
    ["only None reasons", [NONE, NONE, NONE, NONE]],
    ["no reasons at all", undefined],
  ])("rethrows %s as an internal error without retrying, logging the codes", async (_label, codes) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    dynamo.failNextTransactions(codes);

    const response = await donate();

    expect(response.statusCode).toBe(500);
    expect(bodyOf(response).code).toBe("INTERNAL_SERVER_ERROR");
    expect(dynamo.transactions).toHaveLength(1);
    expect(errors.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      `"cancellationReasons":${JSON.stringify(codes ?? [])}`
    );
  });

  it("gives up after a bounded number of contended attempts with 503 and a retry hint", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    dynamo.failNextTransactions(...Array.from({ length: 20 }, () => [NONE, NONE, NONE, CONFLICT]));

    const response = await donate();

    expect(response.statusCode).toBe(503);
    expect(response.headers["Retry-After"]).toBe("1");
    expect(bodyOf(response).code).toBe("SERVICE_UNAVAILABLE");
    expect(dynamo.transactions).toHaveLength(MAX_ATTEMPTS);
    expect(createdDonations()).toBe(0);
    const warning = warnings.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(warning).toEqual([
      expect.objectContaining({ level: "WARN", context: expect.objectContaining({ attempts: 8 }) }),
    ]);
  });

  it("stops retrying when the time budget is spent, well before the Lambda timeout", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    dynamo.failNextTransactions(...Array.from({ length: 20 }, () => [NONE, NONE, NONE, CONFLICT]));
    dynamo.onTransact = () => vi.setSystemTime(Date.now() + 1_000);

    const response = await donate();

    expect(response.statusCode).toBe(503);
    expect(dynamo.transactions).toHaveLength(3);
  });
});

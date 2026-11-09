import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/audit/recordAuditEvent.js", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));

import { recordAuditEvent, type AuditEventInput } from "../../src/audit/recordAuditEvent.js";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { TABLE_NAMES } from "../../src/shared/dynamo.js";
import { buildEvent, identityFor, type TestIdentity } from "../integration/helpers/events.js";
import { FakeDynamo } from "./helpers/fakeDynamo.js";

const PROJECT_ID = randomUUID();
const START = new Date("2026-11-09T13:07:10.000Z");
const NEXT_MINUTE = new Date("2026-11-09T13:08:10.000Z");
const BELOW_NEAR_MAX_CENTS = 89_999;
const NEAR_MAX_CENTS = 95_000;

let dynamo: FakeDynamo;

function donate(donor: TestIdentity, amountCents: number, key: string = randomUUID()) {
  return createDonation(
    buildEvent({ identity: donor, headers: { "Idempotency-Key": key }, body: { projectId: PROJECT_ID, amountCents } })
  );
}

function auditedEvents(eventType: string): AuditEventInput[] {
  return vi
    .mocked(recordAuditEvent)
    .mock.calls.map(([input]) => input)
    .filter((input) => input.eventType === eventType);
}

const statusOf = (response: { body: string }) => JSON.parse(response.body).status as string;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  vi.mocked(recordAuditEvent).mockClear();
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

describe("per-donor rate limit", () => {
  it("answers 429 to the donation after the fifth one in the same minute and records the denial", async () => {
    const donor = identityFor("DONANTE");
    const accepted = [];
    for (let index = 0; index < 5; index++) accepted.push(await donate(donor, 1_000));

    const limited = await donate(donor, 1_000);

    expect(accepted.map((response) => response.statusCode)).toEqual([201, 201, 201, 201, 201]);
    expect(limited.statusCode).toBe(429);
    expect(JSON.parse(limited.body)).toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "Demasiadas donaciones en poco tiempo; intente nuevamente en un minuto",
    });
    expect(dynamo.items(TABLE_NAMES.donations)).toHaveLength(5);
    expect(
      dynamo.items(TABLE_NAMES.idempotency).filter((item) => !String(item.pk).startsWith("velocity#"))
    ).toHaveLength(5);
    expect(auditedEvents("DONATION_RATE_LIMITED")).toEqual([
      expect.objectContaining({
        actorSub: donor.sub,
        action: "CreateDonation",
        outcome: "DENIED",
        reason: "VELOCITY_PER_MINUTE",
      }),
    ]);
  });

  it("gives the donor a new quota in the next minute", async () => {
    const donor = identityFor("DONANTE");
    for (let index = 0; index < 5; index++) await donate(donor, 1_000);

    vi.setSystemTime(NEXT_MINUTE);

    expect((await donate(donor, 1_000)).statusCode).toBe(201);
  });

  it("does not consume quota or add to the hourly total for an idempotent replay", async () => {
    const donor = identityFor("DONANTE");
    const key = randomUUID();
    const first = await donate(donor, 1_000, key);
    const replays = [];
    for (let index = 0; index < 5; index++) replays.push(await donate(donor, 1_000, key));
    const others = [];
    for (let index = 0; index < 4; index++) others.push(await donate(donor, 1_000));

    expect(new Set(replays.map((response) => JSON.parse(response.body).donationId))).toEqual(
      new Set([JSON.parse(first.body).donationId])
    );
    expect(others.map((response) => response.statusCode)).toEqual([201, 201, 201, 201]);
    expect((await donate(donor, 1_000)).statusCode).toBe(429);
    const hourly = dynamo.items(TABLE_NAMES.idempotency).find((item) => String(item.pk).includes("#hour#"));
    expect(hourly?.totalCents).toBe(5_000);
  });
});

describe("hourly review", () => {
  it("records the donation that takes the hourly total above S/ 5,000 as EN_REVISION and audits it", async () => {
    const donor = identityFor("DONANTE");
    const first = [];
    for (let index = 0; index < 5; index++) first.push(await donate(donor, BELOW_NEAR_MAX_CENTS));
    vi.setSystemTime(NEXT_MINUTE);

    const sixth = await donate(donor, BELOW_NEAR_MAX_CENTS);

    expect(first.map(statusOf)).toEqual(Array(5).fill("PENDIENTE_SIMULACION"));
    expect(sixth.statusCode).toBe(201);
    expect(statusOf(sixth)).toBe("EN_REVISION");
    const [flag] = auditedEvents("SUSPICIOUS_VELOCITY");
    expect(flag).toMatchObject({
      actorSub: donor.sub,
      action: "CreateDonation",
      outcome: "SUCCESS",
      reason: "HOURLY_AMOUNT",
      resourceRef: `donation:${JSON.parse(sixth.body).donationId}`,
      details: { hourlyTotalCents: 6 * BELOW_NEAR_MAX_CENTS, thresholdCents: 500_000 },
    });
    expect(auditedEvents("SUSPICIOUS_VELOCITY")).toHaveLength(1);
  });

  it("flags structuring when the third donation close to the maximum arrives within the hour", async () => {
    const donor = identityFor("DONANTE");

    const responses = [];
    for (let index = 0; index < 3; index++) responses.push(await donate(donor, NEAR_MAX_CENTS));

    expect(responses.map(statusOf)).toEqual(["PENDIENTE_SIMULACION", "PENDIENTE_SIMULACION", "EN_REVISION"]);
    expect(auditedEvents("SUSPICIOUS_VELOCITY")).toEqual([
      expect.objectContaining({ reason: "STRUCTURING", details: expect.objectContaining({ nearMaxCount: 3 }) }),
    ]);
  });

  it("stores why the donation is held, so the review queue can show it, and never tells the donor", async () => {
    const donor = identityFor("DONANTE");
    for (let index = 0; index < 2; index++) await donate(donor, NEAR_MAX_CENTS);

    const flagged = await donate(donor, NEAR_MAX_CENTS);
    const donationId = JSON.parse(flagged.body).donationId as string;

    expect(dynamo.get(TABLE_NAMES.donations, { donationId })).toMatchObject({
      status: "EN_REVISION",
      reviewReasons: ["STRUCTURING"],
    });
    expect(JSON.parse(flagged.body)).not.toHaveProperty("reviewReasons");
    const pending = dynamo.items(TABLE_NAMES.donations).filter((item) => item.status === "PENDIENTE_SIMULACION");
    for (const item of pending) expect(item).not.toHaveProperty("reviewReasons");
  });
});

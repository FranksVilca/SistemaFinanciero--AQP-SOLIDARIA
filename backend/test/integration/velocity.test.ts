import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { handler as getMyDonations } from "../../src/donations/getMyDonations.js";
import { handler as simulateDonation } from "../../src/donations/simulateDonation.js";
import { TABLE_NAMES } from "../../src/shared/dynamo.js";
import { buildEvent, identityFor, parseBody, type TestIdentity } from "./helpers/events.js";
import { clearAllTables, countDonationsOf, readAllAuditEvents, readProject, seedProject } from "./helpers/seed.js";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient } from "../../src/shared/dynamo.js";

const PARALLEL_REQUESTS = 10;
const LIMIT_PER_MINUTE = 5;
const BELOW_NEAR_MAX_CENTS = 89_999;
const MS_PER_MINUTE = 60_000;

// The windows are fixed UTC minutes and hours. The clock is frozen at a fixed instant 20 seconds into minute 10 of an
// hour, so a burst never straddles two minutes and "one minute later" stays in the same hour, whenever the suite runs.
const FROZEN_INSTANT = Date.parse("2030-01-15T10:10:20.000Z");

function donate(donor: TestIdentity, projectId: string, amountCents: number, key: string = randomUUID()) {
  return createDonation(
    buildEvent({ identity: donor, headers: { "Idempotency-Key": key }, body: { projectId, amountCents } })
  );
}

async function donationRecords(): Promise<number> {
  const { Items = [] } = await docClient.send(new ScanCommand({ TableName: TABLE_NAMES.idempotency }));
  return Items.filter((item) => !String(item.pk).startsWith("velocity#")).length;
}

const eventsOfType = async (eventType: string) =>
  (await readAllAuditEvents()).filter((event) => event.eventType === eventType);

describe("velocity controls on real transactions", () => {
  let start: number;

  beforeEach(async () => {
    await clearAllTables();
    start = FROZEN_INSTANT;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
  });

  afterEach(() => vi.useRealTimers());

  it("lets exactly five of ten concurrent donations of one donor through and answers 429 to the rest", async () => {
    const donor = identityFor("DONANTE");
    const projectId = String((await seedProject()).projectId);

    const responses = await Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, () => donate(donor, projectId, 1_000))
    );

    const statuses = responses.map((response) => response.statusCode);
    expect(statuses.filter((status) => status === 201)).toHaveLength(LIMIT_PER_MINUTE);
    expect(statuses.filter((status) => status === 429)).toHaveLength(PARALLEL_REQUESTS - LIMIT_PER_MINUTE);
    expect(await countDonationsOf(donor.sub)).toBe(LIMIT_PER_MINUTE);
    expect(await donationRecords()).toBe(LIMIT_PER_MINUTE);
    expect(await eventsOfType("DONATION_RATE_LIMITED")).toHaveLength(PARALLEL_REQUESTS - LIMIT_PER_MINUTE);
  });

  it("does not spend the quota on concurrent replays of the same request", async () => {
    const donor = identityFor("DONANTE");
    const projectId = String((await seedProject()).projectId);
    const key = randomUUID();

    const replays = await Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, () => donate(donor, projectId, 1_000, key))
    );
    const others = [];
    for (let index = 1; index < LIMIT_PER_MINUTE; index++) others.push(await donate(donor, projectId, 1_000));
    const overLimit = await donate(donor, projectId, 1_000);

    expect(replays.every((response) => response.statusCode === 201)).toBe(true);
    expect(new Set(replays.map((response) => parseBody(response).donationId)).size).toBe(1);
    expect(others.every((response) => response.statusCode === 201)).toBe(true);
    expect(overLimit.statusCode).toBe(429);
  });

  it("records as EN_REVISION the donation that takes the hour above S/ 5,000, and it cannot be confirmed", async () => {
    const donor = identityFor("DONANTE");
    const projectId = String((await seedProject()).projectId);
    for (let index = 0; index < LIMIT_PER_MINUTE; index++) {
      expect((await donate(donor, projectId, BELOW_NEAR_MAX_CENTS)).statusCode).toBe(201);
    }
    vi.setSystemTime(start + MS_PER_MINUTE);

    const flagged = await donate(donor, projectId, BELOW_NEAR_MAX_CENTS);
    const donationId = String(parseBody(flagged).donationId);
    const history = parseBody<Array<{ donationId: string; status: string }>>(
      await getMyDonations(buildEvent({ identity: donor }))
    );
    const confirm = await simulateDonation(
      buildEvent({ identity: donor, pathParameters: { donationId }, body: { action: "CONFIRMAR" } })
    );

    expect(flagged.statusCode).toBe(201);
    expect(parseBody(flagged).status).toBe("EN_REVISION");
    expect(history.find((donation) => donation.donationId === donationId)?.status).toBe("EN_REVISION");
    expect(history.filter((donation) => donation.status === "PENDIENTE_SIMULACION")).toHaveLength(LIMIT_PER_MINUTE);
    expect(confirm.statusCode).toBe(409);
    expect((await readProject(projectId))?.confirmedAmountCents).toBe(0);

    const [suspicious, ...others] = await eventsOfType("SUSPICIOUS_VELOCITY");
    expect(others).toHaveLength(0);
    expect(suspicious).toMatchObject({
      outcome: "SUCCESS",
      reason: "HOURLY_AMOUNT",
      resourceRef: `donation:${donationId}`,
      details: { hourlyTotalCents: 6 * BELOW_NEAR_MAX_CENTS, thresholdCents: 500_000 },
    });
    expect(JSON.stringify(suspicious)).not.toContain(donor.sub);
  });
});

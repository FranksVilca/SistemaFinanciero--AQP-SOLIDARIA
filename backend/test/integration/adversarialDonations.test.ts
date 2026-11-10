import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { buildEvent, identityFor, parseBody, type TestIdentity } from "./helpers/events.js";
import { clearAllTables, countDonationsOf, readDonation, readProject, seedProject } from "./helpers/seed.js";

const START = Date.parse("2030-01-15T10:10:20.000Z");
const MINUTE_MS = 60_000;
const MINUTE_LIMIT = 5;

function donate(
  donor: TestIdentity,
  projectId: string,
  amountCents = 1_000,
  key = randomUUID(),
  extraBody: Record<string, unknown> = {}
) {
  return createDonation(
    buildEvent({
      identity: donor,
      headers: { "Idempotency-Key": key },
      body: { projectId, amountCents, ...extraBody },
    })
  );
}

describe("adversarial donation requests against DynamoDB Local", () => {
  beforeEach(async () => {
    await clearAllTables();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START);
  });

  afterEach(() => vi.useRealTimers());

  it("cannot reset a donor's minute quota by switching projects", async () => {
    const donor = identityFor("DONANTE");
    const first = String((await seedProject()).projectId);
    const second = String((await seedProject()).projectId);
    for (let index = 0; index < MINUTE_LIMIT; index++) {
      expect((await donate(donor, index % 2 ? first : second)).statusCode).toBe(201);
    }

    expect((await donate(donor, second)).statusCode).toBe(429);
    expect(await countDonationsOf(donor.sub)).toBe(MINUTE_LIMIT);
    expect((await readProject(first))?.confirmedAmountCents).toBe(0);
    expect((await readProject(second))?.confirmedAmountCents).toBe(0);
  });

  it("aggregates hourly amounts across projects and keeps small later donations held", async () => {
    const donor = identityFor("DONANTE");
    const first = String((await seedProject()).projectId);
    const second = String((await seedProject()).projectId);
    // Below the near-maximum rule: only the aggregate hourly amount should trigger review.
    for (let index = 0; index < MINUTE_LIMIT; index++) {
      expect((await donate(donor, first, 89_999)).statusCode).toBe(201);
    }
    vi.setSystemTime(START + MINUTE_MS);
    const crossing = await donate(donor, second, 89_999);
    const small = await donate(donor, first, 100);

    expect(crossing.statusCode).toBe(201);
    expect(small.statusCode).toBe(201);
    for (const response of [crossing, small]) {
      expect(parseBody(response).status).toBe("EN_REVISION");
      const stored = await readDonation(String(parseBody(response).donationId));
      expect(stored?.reviewReasons).toEqual(["HOURLY_AMOUNT"]);
    }
    expect((await readProject(first))?.confirmedAmountCents).toBe(0);
    expect((await readProject(second))?.confirmedAmountCents).toBe(0);
  });

  it("cannot inject ownership, confirmation or review decisions through the request body", async () => {
    const donor = identityFor("DONANTE");
    const victim = identityFor("DONANTE");
    const projectId = String((await seedProject()).projectId);
    const injectedId = randomUUID();
    const response = await donate(donor, projectId, 1_000, randomUUID(), {
      donationId: injectedId,
      donorSub: victim.sub,
      status: "CONFIRMADA_SIMULADA",
      currency: "USD",
      reviewReasons: [],
      reviewDecision: "APROBAR",
      reviewedBy: "attacker",
      reviewedAt: "2030-01-01T00:00:00.000Z",
    });

    expect(response.statusCode).toBe(201);
    const donationId = String(parseBody(response).donationId);
    expect(donationId).not.toBe(injectedId);
    const stored = await readDonation(donationId);
    expect(stored).toMatchObject({ donorSub: donor.sub, status: "PENDIENTE_SIMULACION", currency: "PEN" });
    for (const field of ["reviewReasons", "reviewDecision", "reviewedBy", "reviewedAt"]) {
      expect(stored).not.toHaveProperty(field);
    }
    expect(await countDonationsOf(victim.sub)).toBe(0);
    expect((await readProject(projectId))?.confirmedAmountCents).toBe(0);
  });

  it("allows another donor after the first exhausts their quota", async () => {
    const first = identityFor("DONANTE");
    const second = identityFor("DONANTE");
    const projectId = String((await seedProject()).projectId);
    for (let index = 0; index < MINUTE_LIMIT; index++) {
      expect((await donate(first, projectId)).statusCode).toBe(201);
    }

    expect((await donate(first, projectId)).statusCode).toBe(429);
    expect((await donate(second, projectId)).statusCode).toBe(201);
    expect(await countDonationsOf(first.sub)).toBe(MINUTE_LIMIT);
    expect(await countDonationsOf(second.sub)).toBe(1);
  });

  it("ignores forged proxy and identity headers when enforcing the donor quota", async () => {
    const donor = identityFor("DONANTE");
    const projectId = String((await seedProject()).projectId);
    for (let index = 0; index <= MINUTE_LIMIT; index++) {
      const response = await createDonation(
        buildEvent({
          identity: donor,
          headers: {
            "Idempotency-Key": randomUUID(),
            "X-Forwarded-For": `192.0.2.${index + 1}`,
            "X-Real-IP": `198.51.100.${index + 1}`,
            "X-User-Id": randomUUID(),
          },
          body: { projectId, amountCents: 1_000 },
        })
      );
      expect(response.statusCode).toBe(index < MINUTE_LIMIT ? 201 : 429);
    }
    expect(await countDonationsOf(donor.sub)).toBe(MINUTE_LIMIT);
  });

  it("can retry a rate-limited key next minute and replay it without consuming another slot", async () => {
    const donor = identityFor("DONANTE");
    const projectId = String((await seedProject()).projectId);
    for (let index = 0; index < MINUTE_LIMIT; index++) {
      expect((await donate(donor, projectId)).statusCode).toBe(201);
    }
    const key = randomUUID();
    expect((await donate(donor, projectId, 1_000, key)).statusCode).toBe(429);
    expect(await countDonationsOf(donor.sub)).toBe(MINUTE_LIMIT);

    vi.setSystemTime(START + MINUTE_MS);
    const retried = await donate(donor, projectId, 1_000, key);
    const replay = await donate(donor, projectId, 1_000, key);
    expect(retried.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(parseBody(replay).donationId).toBe(parseBody(retried).donationId);
    for (let index = 1; index < MINUTE_LIMIT; index++) {
      expect((await donate(donor, projectId)).statusCode).toBe(201);
    }
    expect((await donate(donor, projectId)).statusCode).toBe(429);
    expect(await countDonationsOf(donor.sub)).toBe(2 * MINUTE_LIMIT);
  });

  it("documents that fixed-minute windows allow two quotas around the minute boundary", async () => {
    const donor = identityFor("DONANTE");
    const projectId = String((await seedProject()).projectId);
    vi.setSystemTime(Date.parse("2030-01-15T10:10:59.000Z"));
    for (let index = 0; index < MINUTE_LIMIT; index++) {
      expect((await donate(donor, projectId)).statusCode).toBe(201);
    }
    vi.setSystemTime(Date.parse("2030-01-15T10:11:00.000Z"));
    for (let index = 0; index < MINUTE_LIMIT; index++) {
      expect((await donate(donor, projectId)).statusCode).toBe(201);
    }

    expect((await donate(donor, projectId)).statusCode).toBe(429);
    expect(await countDonationsOf(donor.sub)).toBe(2 * MINUTE_LIMIT);
  });
});

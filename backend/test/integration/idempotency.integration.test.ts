import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handler as createDonationHandler } from "../../src/donations/createDonation.js";
import { hasLocalEndpoint } from "./support/localTables.js";
import { donationsOf, donorEvent, seedPublishedProject, statusCounts } from "./support/fixtures.js";

// T06 / T07 / CA-05.4 against DynamoDB Local: the Idempotency table condition, not a mock,
// guarantees one donation per (donor, Idempotency-Key).

const CONCURRENT_REQUESTS = 5;

const createDonation = (donorSub: string, idempotencyKey: string, payload: Record<string, unknown>) =>
  createDonationHandler(
    donorEvent(donorSub, {
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
    })
  );

describe.skipIf(!hasLocalEndpoint())("T06/T07 - idempotent donation creation on DynamoDB Local", () => {
  it("the same Idempotency-Key sent concurrently creates exactly one donation", async () => {
    const donorSub = `it-donor-idem-${randomUUID()}`;
    const projectId = await seedPublishedProject();
    const key = randomUUID();
    const payload = { projectId, amountCents: 1500 };

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () => createDonation(donorSub, key, payload))
    );

    console.info(`[T06] status codes: ${JSON.stringify(statusCounts(responses))}`);
    const stored = await donationsOf(donorSub);
    expect(stored).toHaveLength(1);
    expect(statusCounts(responses)).toEqual({ 201: CONCURRENT_REQUESTS });
    const ids = new Set(responses.map((r) => JSON.parse(r.body).donationId));
    expect([...ids]).toEqual([stored[0].donationId]);
  });

  it("reusing the key with a different payload returns 409 and creates nothing new", async () => {
    const donorSub = `it-donor-idem-${randomUUID()}`;
    const projectId = await seedPublishedProject();
    const key = randomUUID();

    const first = await createDonation(donorSub, key, { projectId, amountCents: 1500 });
    const second = await createDonation(donorSub, key, { projectId, amountCents: 9900 });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(await donationsOf(donorSub)).toHaveLength(1);
  });
});

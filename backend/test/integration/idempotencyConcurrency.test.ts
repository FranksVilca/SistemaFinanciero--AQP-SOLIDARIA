import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { handler as simulateDonation } from "../../src/donations/simulateDonation.js";
import { buildEvent, identityFor } from "./helpers/events.js";
import { clearAllTables, countDonationsOf, readProject, seedDonation, seedProject } from "./helpers/seed.js";

const PARALLEL_REQUESTS = 10;
const AMOUNT_CENTS = 4_000;

describe("concurrency on real transactions", () => {
  beforeEach(clearAllTables);

  it("creates exactly one donation when the same request is fired in parallel", async () => {
    const donor = identityFor("DONANTE");
    const project = await seedProject();
    const key = randomUUID();
    const send = () =>
      createDonation(
        buildEvent({
          identity: donor,
          headers: { "Idempotency-Key": key },
          body: { projectId: String(project.projectId), amountCents: AMOUNT_CENTS },
        })
      );

    const responses = await Promise.all(Array.from({ length: PARALLEL_REQUESTS }, send));

    expect(responses.every((response) => response.statusCode === 201)).toBe(true);
    expect(new Set(responses.map((response) => JSON.parse(response.body).donationId)).size).toBe(1);
    expect(await countDonationsOf(donor.sub)).toBe(1);
  });

  it("adds the amount once when the same donation is confirmed in parallel", async () => {
    const donor = identityFor("DONANTE");
    const project = await seedProject();
    const donation = await seedDonation(donor.sub, String(project.projectId), { amountCents: AMOUNT_CENTS });
    const confirm = () =>
      simulateDonation(
        buildEvent({
          identity: donor,
          pathParameters: { donationId: String(donation.donationId) },
          body: { action: "CONFIRMAR" },
        })
      );

    const responses = await Promise.all(Array.from({ length: PARALLEL_REQUESTS }, confirm));

    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(PARALLEL_REQUESTS - 1);
    expect((await readProject(String(project.projectId)))?.confirmedAmountCents).toBe(AMOUNT_CENTS);
  });
});

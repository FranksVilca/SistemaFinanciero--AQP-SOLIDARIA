import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { handler as simulateDonation } from "../../src/donations/simulateDonation.js";
import { DONATION_STATUS, PROJECT_STATUS } from "../../src/shared/constants.js";
import { buildEvent, identityFor, parseBody } from "./helpers/events.js";
import {
  clearAllTables,
  countDonationsOf,
  readDonation,
  readProject,
  seedDonation,
  seedProject,
} from "./helpers/seed.js";

const VALID_AMOUNT_CENTS = 5_000;

function donationEvent(donorSub: string, projectId: string, amountCents: number, key: string = randomUUID()) {
  return buildEvent({
    identity: { sub: donorSub, groups: ["DONANTE"] },
    headers: { "Idempotency-Key": key },
    body: { projectId, amountCents },
  });
}

describe("donation flow: states, validation and idempotency", () => {
  beforeEach(clearAllTables);

  it("returns 409 on a second state change and leaves the project total untouched", async () => {
    const donor = identityFor("DONANTE");
    const project = await seedProject();
    const donation = await seedDonation(donor.sub, String(project.projectId));
    const event = () =>
      buildEvent({
        identity: donor,
        pathParameters: { donationId: String(donation.donationId) },
        body: { action: "CONFIRMAR" },
      });

    expect((await simulateDonation(event())).statusCode).toBe(200);
    const second = await simulateDonation(event());

    expect(second.statusCode).toBe(409);
    expect((await readProject(String(project.projectId)))?.confirmedAmountCents).toBe(Number(donation.amountCents));
    expect((await readDonation(String(donation.donationId)))?.status).toBe(DONATION_STATUS.confirmed);
  });

  it("replays the same donation for the same Idempotency-Key and body", async () => {
    const donor = identityFor("DONANTE");
    const project = await seedProject();
    const key = randomUUID();

    const first = await createDonation(donationEvent(donor.sub, String(project.projectId), VALID_AMOUNT_CENTS, key));
    const replay = await createDonation(donationEvent(donor.sub, String(project.projectId), VALID_AMOUNT_CENTS, key));

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(parseBody(replay).donationId).toBe(parseBody(first).donationId);
    expect(await countDonationsOf(donor.sub)).toBe(1);
  });

  it("returns 409 when the same key is reused with a different amount", async () => {
    const donor = identityFor("DONANTE");
    const project = await seedProject();
    const key = randomUUID();

    await createDonation(donationEvent(donor.sub, String(project.projectId), VALID_AMOUNT_CENTS, key));
    const altered = await createDonation(
      donationEvent(donor.sub, String(project.projectId), VALID_AMOUNT_CENTS + 100, key)
    );

    expect(altered.statusCode).toBe(409);
    expect(await countDonationsOf(donor.sub)).toBe(1);
  });

  it("isolates the idempotency key per donor", async () => {
    const project = await seedProject();
    const key = randomUUID();
    const donorA = identityFor("DONANTE");
    const donorB = identityFor("DONANTE");

    const responseA = await createDonation(
      donationEvent(donorA.sub, String(project.projectId), VALID_AMOUNT_CENTS, key)
    );
    const responseB = await createDonation(
      donationEvent(donorB.sub, String(project.projectId), VALID_AMOUNT_CENTS, key)
    );

    expect(parseBody(responseA).donationId).not.toBe(parseBody(responseB).donationId);
  });

  it("returns 400 without a stack trace for invalid input", async () => {
    const donor = identityFor("DONANTE");
    const project = await seedProject();
    const projectId = String(project.projectId);

    const negativeAmount = await createDonation(donationEvent(donor.sub, projectId, -1));
    const missingKey = await createDonation(
      buildEvent({ identity: donor, body: { projectId, amountCents: VALID_AMOUNT_CENTS } })
    );
    const invalidKey = await createDonation(donationEvent(donor.sub, projectId, VALID_AMOUNT_CENTS, "not-a-uuid"));
    const invalidJson = await createDonation(
      buildEvent({ identity: donor, headers: { "Idempotency-Key": randomUUID() }, rawBody: "{bad json" })
    );

    for (const response of [negativeAmount, missingKey, invalidKey, invalidJson]) {
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain("at ");
      expect(parseBody(response)).not.toHaveProperty("stack");
    }
  });

  it("returns 409 when donating to a draft project", async () => {
    const donor = identityFor("DONANTE");
    const draft = await seedProject({ status: PROJECT_STATUS.draft });

    const response = await createDonation(donationEvent(donor.sub, String(draft.projectId), VALID_AMOUNT_CENTS));

    expect(response.statusCode).toBe(409);
    expect(await countDonationsOf(donor.sub)).toBe(0);
  });
});

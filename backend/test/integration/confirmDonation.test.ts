import { beforeEach, describe, expect, it } from "vitest";
import { handler as simulateDonation } from "../../src/donations/simulateDonation.js";
import { CURRENCY, DONATION_STATUS } from "../../src/shared/constants.js";
import { buildEvent, identityFor, parseBody } from "./helpers/events.js";
import { clearAllTables, readDonation, readProject, seedDonation, seedProject } from "./helpers/seed.js";

const DONATION_CENTS = 7_500;

describe("confirming a simulated donation (H1)", () => {
  beforeEach(clearAllTables);

  it("confirms a pending donation and adds its amount to the project total exactly once", async () => {
    const donor = identityFor("DONANTE");
    const project = await seedProject({ confirmedAmountCents: 1_000 });
    const donation = await seedDonation(donor.sub, String(project.projectId), { amountCents: DONATION_CENTS });

    const response = await simulateDonation(
      buildEvent({
        identity: donor,
        pathParameters: { donationId: String(donation.donationId) },
        body: { action: "CONFIRMAR" },
      })
    );

    expect(response.statusCode).toBe(200);
    expect(parseBody(response).status).toBe(DONATION_STATUS.confirmed);
    expect((await readDonation(String(donation.donationId)))?.status).toBe(DONATION_STATUS.confirmed);
    expect((await readProject(String(project.projectId)))?.confirmedAmountCents).toBe(1_000 + DONATION_CENTS);
    expect(CURRENCY).toBe("PEN");
  });

  it("rejects a pending donation without changing the project total", async () => {
    const donor = identityFor("DONANTE");
    const project = await seedProject({ confirmedAmountCents: 2_000 });
    const donation = await seedDonation(donor.sub, String(project.projectId));

    const response = await simulateDonation(
      buildEvent({
        identity: donor,
        pathParameters: { donationId: String(donation.donationId) },
        body: { action: "RECHAZAR" },
      })
    );

    expect(response.statusCode).toBe(200);
    expect((await readDonation(String(donation.donationId)))?.status).toBe(DONATION_STATUS.rejected);
    expect((await readProject(String(project.projectId)))?.confirmedAmountCents).toBe(2_000);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { handler as getMyDonations } from "../../src/donations/getMyDonations.js";
import { handler as simulateDonation } from "../../src/donations/simulateDonation.js";
import { DONATION_STATUS } from "../../src/shared/constants.js";
import { buildEvent, identityFor, parseBody, type TestIdentity } from "./helpers/events.js";
import { clearAllTables, readDonation, readProject, seedDonation, seedProject } from "./helpers/seed.js";

describe("object-level authorization on donations (BOLA)", () => {
  beforeEach(clearAllTables);

  async function attack(attacker: TestIdentity, action: "CONFIRMAR" | "RECHAZAR") {
    const owner = identityFor("DONANTE");
    const project = await seedProject();
    const donation = await seedDonation(owner.sub, String(project.projectId));
    const donationId = String(donation.donationId);

    const response = await simulateDonation(
      buildEvent({ identity: attacker, pathParameters: { donationId }, body: { action } })
    );
    return { response, donationId, projectId: String(project.projectId) };
  }

  it("denies another donor and leaves donation and project untouched", async () => {
    const { response, donationId, projectId } = await attack(identityFor("DONANTE"), "CONFIRMAR");

    expect(response.statusCode).toBe(403);
    expect((await readDonation(donationId))?.status).toBe(DONATION_STATUS.pending);
    expect((await readProject(projectId))?.confirmedAmountCents).toBe(0);
  });

  it("denies a manager and leaves donation and project untouched", async () => {
    const { response, donationId, projectId } = await attack(identityFor("GESTOR"), "CONFIRMAR");

    expect(response.statusCode).toBe(403);
    expect((await readDonation(donationId))?.status).toBe(DONATION_STATUS.pending);
    expect((await readProject(projectId))?.confirmedAmountCents).toBe(0);
  });

  it("answers 404 for a donation that does not exist", async () => {
    const response = await simulateDonation(
      buildEvent({
        identity: identityFor("DONANTE"),
        pathParameters: { donationId: "missing" },
        body: { action: "CONFIRMAR" },
      })
    );

    expect(response.statusCode).toBe(404);
  });

  it("returns each donor only their own history", async () => {
    const donorA = identityFor("DONANTE");
    const donorB = identityFor("DONANTE");
    const project = await seedProject();
    const donationOfA = await seedDonation(donorA.sub, String(project.projectId));
    const donationOfB = await seedDonation(donorB.sub, String(project.projectId));

    const historyOfA = parseBody<Array<{ donationId: string }>>(await getMyDonations(buildEvent({ identity: donorA })));
    const historyOfB = parseBody<Array<{ donationId: string }>>(await getMyDonations(buildEvent({ identity: donorB })));

    expect(historyOfA.map((item) => item.donationId)).toEqual([donationOfA.donationId]);
    expect(historyOfB.map((item) => item.donationId)).toEqual([donationOfB.donationId]);
  });
});

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { handler as simulateDonationHandler } from "../../src/donations/simulateDonation.js";
import { handler as getMyDonationsHandler } from "../../src/donations/getMyDonations.js";
import { hasLocalEndpoint } from "./support/localTables.js";
import { donorEvent, getItem, seedPendingDonation, seedPublishedProject } from "./support/fixtures.js";

// T09 / CA-07.2 against DynamoDB Local: a donor cannot act on or list another donor's donation.

describe.skipIf(!hasLocalEndpoint())("T09 - foreign donation access on DynamoDB Local", () => {
  it("a non-owner gets 403 with no donation data and the stored donation stays untouched", async () => {
    const ownerSub = `it-owner-${randomUUID()}`;
    const attackerSub = `it-attacker-${randomUUID()}`;
    const projectId = await seedPublishedProject();
    const victim = await seedPendingDonation(projectId, ownerSub, 7777);

    const response = await simulateDonationHandler(
      donorEvent(attackerSub, {
        pathParameters: { donationId: victim.donationId },
        body: JSON.stringify({ action: "CONFIRMAR" }),
      })
    );

    expect(response.statusCode).toBe(403);
    expect(Object.keys(JSON.parse(response.body)).sort()).toEqual(["code", "message", "requestId"]);
    for (const value of [ownerSub, projectId, "7777", "PENDIENTE_SIMULACION"]) {
      expect(response.body).not.toContain(value);
    }
    expect((await getItem("donations", { donationId: victim.donationId }))?.status).toBe(
      "PENDIENTE_SIMULACION"
    );
    expect((await getItem("projects", { projectId }))?.confirmedAmountCents).toBe(0);
  });

  it("getMyDonations returns only the caller's donations even if another sub is supplied", async () => {
    const ownerSub = `it-owner-${randomUUID()}`;
    const attackerSub = `it-attacker-${randomUUID()}`;
    const projectId = await seedPublishedProject();
    await seedPendingDonation(projectId, ownerSub, 1200);
    const own = await seedPendingDonation(projectId, attackerSub, 3400);

    const response = await getMyDonationsHandler(
      donorEvent(attackerSub, {
        queryStringParameters: { donorSub: ownerSub, sub: ownerSub },
      }) as never
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { donationId: string; donorSub: string }[];
    expect(body.map((d) => d.donationId)).toEqual([own.donationId]);
    expect(response.body).not.toContain(ownerSub);
  });
});

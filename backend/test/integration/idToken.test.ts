import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { handler as getAuditEvents } from "../../src/audit/getAuditEvents.js";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { handler as getMyDonations } from "../../src/donations/getMyDonations.js";
import { handler as simulateDonation } from "../../src/donations/simulateDonation.js";
import { handler as createProject } from "../../src/projects/createProject.js";
import { handler as publishProject } from "../../src/projects/publishProject.js";
import { TABLE_NAMES } from "../../src/shared/dynamo.js";
import { buildEvent, identityFor } from "./helpers/events.js";
import { clearAllTables, countItems, readAllAuditEvents, seedDonation, seedProject } from "./helpers/seed.js";

describe("an ID token is never accepted as an access token (T11)", () => {
  beforeEach(clearAllTables);

  it("answers 401 on every protected route, changes nothing and audits the rejection", async () => {
    const project = await seedProject();
    const draft = await seedProject({ status: "BORRADOR" });
    const donor = identityFor("DONANTE");
    const donation = await seedDonation(donor.sub, String(project.projectId));
    const donationsBefore = await countItems(TABLE_NAMES.donations);
    const projectsBefore = await countItems(TABLE_NAMES.projects);

    const calls = [
      createProject({
        ...buildEvent({
          identity: identityFor("GESTOR"),
          tokenUse: "id",
          body: { title: "Proyecto", description: "Descripción larga", goalAmountCents: 10_000 },
        }),
      }),
      publishProject(
        buildEvent({
          identity: identityFor("GESTOR"),
          tokenUse: "id",
          pathParameters: { projectId: String(draft.projectId) },
        })
      ),
      createDonation(
        buildEvent({
          identity: donor,
          tokenUse: "id",
          headers: { "Idempotency-Key": randomUUID() },
          body: { projectId: String(project.projectId), amountCents: 5_000 },
        })
      ),
      simulateDonation(
        buildEvent({
          identity: donor,
          tokenUse: "id",
          pathParameters: { donationId: String(donation.donationId) },
          body: { action: "CONFIRMAR" },
        })
      ),
      getMyDonations(buildEvent({ identity: donor, tokenUse: "id" })),
      getAuditEvents(buildEvent({ identity: identityFor("AUDITOR"), tokenUse: "id" })),
    ];
    const responses = await Promise.all(calls);

    expect(responses.map((response) => response.statusCode)).toEqual(Array(calls.length).fill(401));
    expect(await countItems(TABLE_NAMES.donations)).toBe(donationsBefore);
    expect(await countItems(TABLE_NAMES.projects)).toBe(projectsBefore);

    const events = await readAllAuditEvents();
    expect(events).toHaveLength(calls.length);
    expect(events.every((event) => event.outcome === "DENIED" && event.reason === "UNAUTHENTICATED")).toBe(true);
  });
});

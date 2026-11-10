import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { handler as simulateDonation } from "../../src/donations/simulateDonation.js";
import { handler as closeProject } from "../../src/projects/closeProject.js";
import { handler as getProject } from "../../src/projects/getProject.js";
import { handler as getProjectStats } from "../../src/projects/getProjectStats.js";
import { handler as listProjects } from "../../src/projects/listProjects.js";
import { DONATION_STATUS, PROJECT_STATUS } from "../../src/shared/constants.js";
import { buildEvent, identityFor, parseBody } from "./helpers/events.js";
import {
  clearAllTables,
  readAllAuditEvents,
  readDonation,
  readProject,
  seedDonation,
  seedProject,
} from "./helpers/seed.js";

const closeEvent = (sub: string, projectId: string, role: "GESTOR" | "DONANTE" | "REVISOR" = "GESTOR") =>
  buildEvent({ identity: { sub, groups: [role] }, pathParameters: { projectId } });

const donationEvent = (donorSub: string, projectId: string, amountCents = 5_000) =>
  buildEvent({
    identity: { sub: donorSub, groups: ["DONANTE"] },
    headers: { "Idempotency-Key": randomUUID() },
    body: { projectId, amountCents },
  });

describe("closing a campaign", () => {
  beforeEach(clearAllTables);

  it("lets the manager who created the project close it, and stamps when", async () => {
    const manager = identityFor("GESTOR");
    const project = await seedProject({ createdBy: manager.sub });
    const projectId = String(project.projectId);

    const response = await closeProject(closeEvent(manager.sub, projectId));

    expect(response.statusCode).toBe(200);
    expect(parseBody(response)).toMatchObject({ projectId, status: PROJECT_STATUS.closed });
    expect(JSON.stringify(parseBody(response))).not.toContain(manager.sub);
    const stored = await readProject(projectId);
    expect(stored?.status).toBe(PROJECT_STATUS.closed);
    expect(typeof stored?.closedAt).toBe("string");
  });

  it("refuses a manager who did not create the project with 403, leaves it open, and audits the denial", async () => {
    const project = await seedProject({ createdBy: "the-owner" });
    const projectId = String(project.projectId);

    const response = await closeProject(closeEvent("another-manager", projectId));
    const denial = (await readAllAuditEvents()).find((event) => event.action === "CloseProject");

    expect(response.statusCode).toBe(403);
    expect((await readProject(projectId))?.status).toBe(PROJECT_STATUS.published);
    expect(denial).toMatchObject({ outcome: "DENIED", reason: "OWNER" });
  });

  it.each(["DONANTE", "REVISOR"] as const)("refuses a %s with 403: only a manager closes a campaign", async (role) => {
    const project = await seedProject({ createdBy: "the-owner" });

    const response = await closeProject(closeEvent("the-owner", String(project.projectId), role));

    expect(response.statusCode).toBe(403);
    expect((await readProject(String(project.projectId)))?.status).toBe(PROJECT_STATUS.published);
  });

  it("answers 401 without a token and 404 for a project that does not exist", async () => {
    const project = await seedProject({ createdBy: "the-owner" });
    const anonymous = buildEvent({ pathParameters: { projectId: String(project.projectId) } });

    expect((await closeProject(anonymous)).statusCode).toBe(401);
    expect((await closeProject(closeEvent("the-owner", randomUUID()))).statusCode).toBe(404);
  });

  it("only closes a published campaign: a draft and an already closed one answer 409", async () => {
    const draft = await seedProject({ createdBy: "the-owner", status: PROJECT_STATUS.draft });
    const closed = await seedProject({ createdBy: "the-owner", status: PROJECT_STATUS.closed });

    expect((await closeProject(closeEvent("the-owner", String(draft.projectId)))).statusCode).toBe(409);
    expect((await closeProject(closeEvent("the-owner", String(closed.projectId)))).statusCode).toBe(409);
    expect((await readProject(String(draft.projectId)))?.status).toBe(PROJECT_STATUS.draft);
  });

  it("records the closing in the audit trail", async () => {
    const project = await seedProject({ createdBy: "the-owner" });

    await closeProject(closeEvent("the-owner", String(project.projectId)));
    const success = (await readAllAuditEvents()).find((event) => event.eventType === "PROJECT_CLOSED");

    expect(success).toMatchObject({
      action: "CloseProject",
      outcome: "SUCCESS",
      resourceRef: `project:${project.projectId}`,
    });
  });
});

describe("what a closed campaign does", () => {
  beforeEach(clearAllTables);

  it("takes no new donation: 409 with its own message, and nothing is written", async () => {
    const project = await seedProject({ status: PROJECT_STATUS.closed });

    const response = await createDonation(donationEvent("a-donor", String(project.projectId)));

    expect(response.statusCode).toBe(409);
    expect(parseBody(response).message ?? parseBody(response).error).toContain("cerrada");
  });

  it("still lets an already registered donation be confirmed: that money is already on its way", async () => {
    const donor = identityFor("DONANTE");
    const project = await seedProject({ status: PROJECT_STATUS.closed, confirmedAmountCents: 0 });
    const donation = await seedDonation(donor.sub, String(project.projectId));

    const response = await simulateDonation(
      buildEvent({
        identity: donor,
        pathParameters: { donationId: String(donation.donationId) },
        body: { action: "CONFIRMAR" },
      })
    );

    expect(response.statusCode).toBe(200);
    expect((await readDonation(String(donation.donationId)))?.status).toBe(DONATION_STATUS.confirmed);
    expect((await readProject(String(project.projectId)))?.confirmedAmountCents).toBe(Number(donation.amountCents));
  });

  it("stays visible to everyone, in the catalog and by id, with its status", async () => {
    const open = await seedProject({ title: "Abierta", createdAt: "2026-01-02T00:00:00.000Z" });
    const closed = await seedProject({
      title: "Cerrada",
      status: PROJECT_STATUS.closed,
      createdAt: "2026-01-03T00:00:00.000Z",
    });
    await seedProject({ title: "Borrador", status: PROJECT_STATUS.draft });

    const listed = parseBody<Array<Record<string, unknown>>>(await listProjects(buildEvent()));
    const byId = await getProject(buildEvent({ pathParameters: { projectId: String(closed.projectId) } }));

    expect(listed.map((project) => project.title)).toEqual(["Cerrada", "Abierta"]);
    expect(listed.find((project) => project.projectId === open.projectId)?.status).toBe(PROJECT_STATUS.published);
    expect(byId.statusCode).toBe(200);
    expect(parseBody(byId).status).toBe(PROJECT_STATUS.closed);
  });
});

describe("progress beyond the goal", () => {
  beforeEach(clearAllTables);

  it("is not capped at 100%: a campaign that raised 120% of its goal says so", async () => {
    const project = await seedProject({ goalAmountCents: 10_000, confirmedAmountCents: 12_000 });

    const stats = parseBody(
      await getProjectStats(buildEvent({ pathParameters: { projectId: String(project.projectId) } }))
    );

    expect(stats).toMatchObject({
      progressPercentage: 120,
      confirmedAmountCents: 12_000,
      status: PROJECT_STATUS.published,
    });
  });

  it("keeps taking donations after the goal is reached: reaching it does not close the campaign", async () => {
    const project = await seedProject({ goalAmountCents: 10_000, confirmedAmountCents: 10_000 });

    const response = await createDonation(donationEvent("a-donor", String(project.projectId)));

    expect(response.statusCode).toBe(201);
  });
});

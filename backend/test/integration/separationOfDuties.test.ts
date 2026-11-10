import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { pseudonymizeActor } from "../../src/audit/recordAuditEvent.js";
import { handler as getAuditEvents } from "../../src/audit/getAuditEvents.js";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { handler as createProject } from "../../src/projects/createProject.js";
import { handler as getProject } from "../../src/projects/getProject.js";
import { handler as listProjects } from "../../src/projects/listProjects.js";
import { handler as publishProject } from "../../src/projects/publishProject.js";
import { buildEvent, parseBody, type TestIdentity } from "./helpers/events.js";
import { clearAllTables, countDonationsOf, readAllAuditEvents, readProject, seedProject } from "./helpers/seed.js";

/**
 * Roles are groups of the identity provider and one person can hold several. Rules keep that safe: the auditor and the
 * administrator roles cannot be combined with another (they would audit or grant their own actions), a manager is not a
 * reviewer (shared/roleRules.ts), and whoever created a project cannot donate to it (it would raise its own amount).
 */

const person = (...groups: string[]): TestIdentity => ({ sub: `person-${randomUUID()}`, groups });
const donation = (identity: TestIdentity, projectId: string) =>
  createDonation(
    buildEvent({
      identity,
      headers: { "Idempotency-Key": randomUUID() },
      body: { projectId, amountCents: 5_000 },
    })
  );
const validProject = {
  title: "Comedor popular",
  description: "Un comedor para la comunidad",
  goalAmountCents: 100_000,
};

async function publishedProjectCreatedBy(manager: TestIdentity): Promise<string> {
  const created = parseBody<{ projectId: string }>(
    await createProject(buildEvent({ identity: manager, body: validProject }))
  );
  await publishProject(buildEvent({ identity: manager, pathParameters: { projectId: created.projectId } }));
  return created.projectId;
}

describe("separation of duties: the roles that cannot be combined", () => {
  beforeEach(clearAllTables);

  it.each([
    ["AUDITOR and DONANTE", ["AUDITOR", "DONANTE"]],
    ["AUDITOR and GESTOR", ["AUDITOR", "GESTOR"]],
    ["all three roles", ["AUDITOR", "GESTOR", "DONANTE"]],
    ["REVISOR and GESTOR", ["REVISOR", "GESTOR"]],
    ["ADMIN and DONANTE", ["ADMIN", "DONANTE"]],
    ["ADMIN and AUDITOR", ["ADMIN", "AUDITOR"]],
  ])("refuses someone with %s every protected action, auditing why", async (_label, groups) => {
    const both = person(...groups);
    const project = await seedProject();

    const audit = await getAuditEvents(buildEvent({ identity: both }));
    const donate = await donation(both, String(project.projectId));
    const events = await readAllAuditEvents();

    expect(audit.statusCode).toBe(403);
    expect(donate.statusCode).toBe(403);
    expect(await countDonationsOf(both.sub)).toBe(0);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event).toMatchObject({
        eventType: "AUTHZ_DECISION",
        outcome: "DENIED",
        reason: "SEPARATION_OF_DUTIES",
        actorRef: pseudonymizeActor(both.sub),
      });
    }
  });

  it("still lets an auditor do the audit, and the public catalog stays open to anyone", async () => {
    const auditor = person("AUDITOR");
    const mixed = person("AUDITOR", "DONANTE");

    expect((await getAuditEvents(buildEvent({ identity: auditor }))).statusCode).toBe(200);
    expect((await listProjects(buildEvent({ identity: mixed }))).statusCode).toBe(200);
  });
});

describe("conflict of interest: a project cannot be raised by whoever created it", () => {
  beforeEach(clearAllTables);

  it("lets someone who is both GESTOR and DONANTE donate to a project that someone else created", async () => {
    const other = person("GESTOR");
    const both = person("GESTOR", "DONANTE");
    const projectId = await publishedProjectCreatedBy(other);

    const response = await donation(both, projectId);

    expect(response.statusCode).toBe(201);
  });

  it("refuses the creator a donation to their own project, leaves it untouched and audits the refusal", async () => {
    const both = person("GESTOR", "DONANTE");
    const projectId = await publishedProjectCreatedBy(both);

    const response = await donation(both, projectId);
    const [denial] = (await readAllAuditEvents()).filter((event) => event.outcome === "DENIED");

    expect(response.statusCode).toBe(403);
    expect(await countDonationsOf(both.sub)).toBe(0);
    expect((await readProject(projectId))?.confirmedAmountCents).toBe(0);
    expect(denial).toMatchObject({
      eventType: "AUTHZ_DECISION",
      action: "CreateDonation",
      reason: "CONFLICT_OF_INTEREST",
      resourceRef: `project:${projectId}`,
      actorRef: pseudonymizeActor(both.sub),
    });
  });

  it("lets a different donor donate to that same project", async () => {
    const manager = person("GESTOR", "DONANTE");
    const projectId = await publishedProjectCreatedBy(manager);

    const response = await donation(person("DONANTE"), projectId);

    expect(response.statusCode).toBe(201);
  });

  it("never shows who created a project", async () => {
    const manager = person("GESTOR");
    const created = await createProject(buildEvent({ identity: manager, body: validProject }));
    const projectId = parseBody<{ projectId: string }>(created).projectId;
    const published = await publishProject(buildEvent({ identity: manager, pathParameters: { projectId } }));
    const single = await getProject(buildEvent({ pathParameters: { projectId } }));
    const listed = await listProjects(buildEvent());

    for (const response of [created, published, single, listed]) {
      expect(response.body).not.toContain(manager.sub);
      expect(response.body).not.toContain("createdBy");
    }
    expect((await readProject(projectId))?.createdBy).toBe(manager.sub);
  });
});

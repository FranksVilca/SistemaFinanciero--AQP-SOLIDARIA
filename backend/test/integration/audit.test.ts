import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { handler as getAuditEvents } from "../../src/audit/getAuditEvents.js";
import { pseudonymizeActor } from "../../src/audit/recordAuditEvent.js";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { handler as getMyDonations } from "../../src/donations/getMyDonations.js";
import { handler as createProject } from "../../src/projects/createProject.js";
import { handler as listProjects } from "../../src/projects/listProjects.js";
import { buildEvent, identityFor, parseBody } from "./helpers/events.js";
import { clearAllTables, readAllAuditEvents, seedProject } from "./helpers/seed.js";

const validProject = {
  title: "Agua para Chivay",
  description: "Instalar un sistema de agua potable",
  goalAmountCents: 100_000,
};

type AuditRecord = Record<string, unknown>;

describe("audit trail", () => {
  beforeEach(clearAllTables);

  it("records a role denial with a pseudonymized actor", async () => {
    const donor = identityFor("DONANTE");

    const response = await createProject(buildEvent({ identity: donor, body: validProject }));
    const events = await readAllAuditEvents();

    expect(response.statusCode).toBe(403);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "AUTHZ_DECISION",
      outcome: "DENIED",
      reason: "ROLE",
      action: "CreateProject",
      actorRef: pseudonymizeActor(donor.sub),
    });
    expect(String(events[0].actorRef)).toMatch(/^usr_[0-9a-f]{12}$/);
  });

  it("records a call without identity as anonymous", async () => {
    const project = await seedProject();

    const response = await createDonation(
      buildEvent({
        headers: { "Idempotency-Key": randomUUID() },
        body: { projectId: String(project.projectId), amountCents: 5_000 },
      })
    );
    const [event] = await readAllAuditEvents();

    expect(response.statusCode).toBe(401);
    expect(event).toMatchObject({ outcome: "DENIED", reason: "UNAUTHENTICATED", actorRef: "anonymous" });
  });

  it("records the success of a state-changing action with the created resource", async () => {
    const manager = identityFor("GESTOR");

    const response = await createProject(buildEvent({ identity: manager, body: validProject }));
    const [event] = await readAllAuditEvents();

    expect(response.statusCode).toBe(201);
    expect(event).toMatchObject({
      eventType: "PROJECT_CREATED",
      outcome: "SUCCESS",
      resourceRef: `project:${parseBody(response).projectId}`,
    });
  });

  it("does not audit public actions or successful reads", async () => {
    await listProjects(buildEvent());
    await getMyDonations(buildEvent({ identity: identityFor("DONANTE") }));

    expect(await readAllAuditEvents()).toHaveLength(0);
  });

  it("never stores a raw user identifier or email in any attribute", async () => {
    const donor = identityFor("DONANTE");
    const manager = identityFor("GESTOR");
    await createProject(buildEvent({ identity: donor, body: validProject }));
    await createProject(buildEvent({ identity: manager, body: validProject }));

    const stored = JSON.stringify(await readAllAuditEvents());

    expect(stored).not.toContain(donor.sub);
    expect(stored).not.toContain(manager.sub);
  });

  describe("querying the trail", () => {
    it("lets the auditor read successes and denials, newest first", async () => {
      const auditor = identityFor("AUDITOR");
      await createProject(buildEvent({ identity: identityFor("DONANTE"), body: validProject }));
      await createProject(buildEvent({ identity: identityFor("GESTOR"), body: validProject }));

      const response = await getAuditEvents(buildEvent({ identity: auditor }));
      const events = parseBody<AuditRecord[]>(response);

      expect(response.statusCode).toBe(200);
      expect(events.map((event) => event.outcome)).toEqual(["SUCCESS", "DENIED"]);
      const timestamps = events.map((event) => String(event.timestamp));
      expect([...timestamps].sort().reverse()).toEqual(timestamps);
    });

    it("filters by event type", async () => {
      await createProject(buildEvent({ identity: identityFor("DONANTE"), body: validProject }));
      await createProject(buildEvent({ identity: identityFor("GESTOR"), body: validProject }));

      const response = await getAuditEvents(
        buildEvent({ identity: identityFor("AUDITOR"), queryStringParameters: { eventType: "PROJECT_CREATED" } })
      );

      expect(parseBody<AuditRecord[]>(response).map((event) => event.eventType)).toEqual(["PROJECT_CREATED"]);
    });

    it("denies every other role and records the denial", async () => {
      for (const role of ["DONANTE", "GESTOR"] as const) {
        expect((await getAuditEvents(buildEvent({ identity: identityFor(role) }))).statusCode).toBe(403);
      }
      expect((await getAuditEvents(buildEvent())).statusCode).toBe(401);

      const events = await readAllAuditEvents();
      expect(events).toHaveLength(3);
      expect(events.every((event) => event.action === "ViewAudit" && event.outcome === "DENIED")).toBe(true);
    });

    it("rejects an invalid date range with 400", async () => {
      const response = await getAuditEvents(
        buildEvent({ identity: identityFor("AUDITOR"), queryStringParameters: { from: "not-a-date" } })
      );

      expect(response.statusCode).toBe(400);
    });
  });
});

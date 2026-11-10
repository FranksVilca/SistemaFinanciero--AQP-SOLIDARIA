import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handler as changeUserRole } from "../../src/admin/changeUserRole.js";
import { replaceUserDirectory } from "../../src/admin/userDirectory.js";
import { handler as getAuditEvents } from "../../src/audit/getAuditEvents.js";
import { pseudonymizeActor } from "../../src/audit/recordAuditEvent.js";
import { FakeDirectory } from "../admin/fakeDirectory.js";
import { buildEvent, identityFor, parseBody, type TestIdentity } from "./helpers/events.js";
import { clearAllTables, readAllAuditEvents } from "./helpers/seed.js";

/**
 * Giving and taking away roles, against a real audit table: what is recorded, what the auditor can read of it, and that
 * nothing personal ends up in it.
 */

let directory: FakeDirectory;
let admin: TestIdentity;

const change = (userId: string, body: unknown, caller: TestIdentity = admin) =>
  changeUserRole(buildEvent({ identity: caller, pathParameters: { userId }, body }));

beforeEach(async () => {
  await clearAllTables();
  directory = new FakeDirectory();
  replaceUserDirectory(directory);
  admin = { sub: directory.add("admin@aqp.test", ["ADMIN"]).sub, groups: ["ADMIN"] };
});

afterEach(() => replaceUserDirectory());

describe("the change of a role leaves a trace that the auditor can read", () => {
  it("records ROLE_GRANTED and ROLE_REVOKED with pseudonyms only", async () => {
    const donor = directory.add("ana@aqp.test", ["DONANTE"]);

    expect((await change(donor.username, { action: "ADD", role: "REVISOR" })).statusCode).toBe(200);
    expect((await change(donor.username, { action: "REMOVE", role: "REVISOR" })).statusCode).toBe(200);
    const events = await readAllAuditEvents();

    expect(events.map((event) => event.eventType).sort()).toEqual(["ROLE_GRANTED", "ROLE_REVOKED"]);
    for (const event of events) {
      expect(event).toMatchObject({
        action: "ChangeUserRole",
        outcome: "SUCCESS",
        reason: "REVISOR",
        actorRef: pseudonymizeActor(admin.sub),
        resourceRef: `user:${pseudonymizeActor(donor.sub)}`,
      });
    }
    const stored = JSON.stringify(events);
    for (const secret of ["ana@aqp.test", "admin@aqp.test", donor.sub, admin.sub]) expect(stored).not.toContain(secret);
  });

  it("lets the auditor find the changes of roles by their type", async () => {
    const donor = directory.add("ana@aqp.test", ["DONANTE"]);
    await change(donor.username, { action: "ADD", role: "GESTOR" });

    const response = await getAuditEvents(
      buildEvent({ identity: identityFor("AUDITOR"), queryStringParameters: { eventType: "ROLE_GRANTED" } })
    );

    expect(response.statusCode).toBe(200);
    expect(parseBody<unknown[]>(response)).toEqual([
      expect.objectContaining({ eventType: "ROLE_GRANTED", reason: "GESTOR" }),
    ]);
  });

  it("records a refused attempt as a denial, with its reason, and changes nothing", async () => {
    const auditor = directory.add("aud@aqp.test", ["AUDITOR"]);

    expect((await change(auditor.username, { action: "ADD", role: "GESTOR" })).statusCode).toBe(403);
    expect((await change(admin.sub, { action: "ADD", role: "DONANTE" })).statusCode).toBe(403);
    const events = await readAllAuditEvents();

    expect(events.map((event) => [event.eventType, event.outcome, event.reason])).toEqual(
      expect.arrayContaining([
        ["AUTHZ_DECISION", "DENIED", "PROTECTED_USER"],
        ["AUTHZ_DECISION", "DENIED", "SELF_ROLE_CHANGE"],
      ])
    );
    expect(directory.writes).toEqual([]);
  });
});

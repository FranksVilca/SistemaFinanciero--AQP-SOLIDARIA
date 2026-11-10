import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/audit/recordAuditEvent.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/audit/recordAuditEvent.js")>()),
  recordAuditEvent: vi.fn(async () => undefined),
}));
vi.mock("../../src/authz/sessionCheck.js", () => ({ isSessionActive: vi.fn(async () => true) }));

import { replaceUserDirectory } from "../../src/admin/userDirectory.js";
import { handler as changeUserRole } from "../../src/admin/changeUserRole.js";
import { pseudonymizeActor, recordAuditEvent, type AuditEventInput } from "../../src/audit/recordAuditEvent.js";
import { replaceGroupsLookup } from "../../src/authz/currentGroups.js";
import { isSessionActive } from "../../src/authz/sessionCheck.js";
import { buildEvent, type TestIdentity } from "../integration/helpers/events.js";
import { FakeDirectory } from "./fakeDirectory.js";

let directory: FakeDirectory;
let admin: TestIdentity;

function change(userId: string, body: unknown, caller: TestIdentity | null = admin) {
  return changeUserRole(buildEvent({ identity: caller ?? undefined, pathParameters: { userId }, body }));
}

const bodyOf = (response: { body: string }) => JSON.parse(response.body) as Record<string, unknown>;

function audited(eventType: string): AuditEventInput[] {
  return vi
    .mocked(recordAuditEvent)
    .mock.calls.map(([input]) => input)
    .filter((input) => input.eventType === eventType);
}

beforeEach(() => {
  directory = new FakeDirectory();
  replaceUserDirectory(directory);
  replaceGroupsLookup(async (principal) => principal.groups);
  vi.mocked(recordAuditEvent).mockClear();
  vi.mocked(isSessionActive).mockClear();
  admin = { sub: directory.add("admin@aqp.test", ["ADMIN"]).sub, groups: ["ADMIN"] };
});

afterEach(() => {
  replaceUserDirectory();
  replaceGroupsLookup();
  vi.restoreAllMocks();
});

describe("an administrator gives and takes away roles", () => {
  it("gives GESTOR to a donor, and records who did it, to whom and which role, without the email", async () => {
    const donor = directory.add("ana@aqp.test", ["DONANTE"]);

    const response = await change(donor.username, { action: "ADD", role: "GESTOR" });

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toEqual({ userId: donor.username, roles: ["DONANTE", "GESTOR"], changed: true });
    expect(directory.groupsNow(donor.username)).toEqual(["DONANTE", "GESTOR"]);
    expect(audited("ROLE_GRANTED")).toEqual([
      expect.objectContaining({
        actorSub: admin.sub,
        action: "ChangeUserRole",
        outcome: "SUCCESS",
        reason: "GESTOR",
        resourceRef: `user:${pseudonymizeActor(donor.sub)}`,
      }),
    ]);
    expect(JSON.stringify(vi.mocked(recordAuditEvent).mock.calls)).not.toContain("ana@aqp.test");
  });

  it("takes REVISOR away from a reviewer", async () => {
    const reviewer = directory.add("rev@aqp.test", ["DONANTE", "REVISOR"]);

    const response = await change(reviewer.username, { action: "REMOVE", role: "REVISOR" });

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toMatchObject({ roles: ["DONANTE"], changed: true });
    expect(directory.groupsNow(reviewer.username)).toEqual(["DONANTE"]);
    expect(audited("ROLE_REVOKED")).toHaveLength(1);
    expect(audited("ROLE_GRANTED")).toHaveLength(0);
  });

  it("makes a donor a reviewer: DONANTE and REVISOR can be held together", async () => {
    const donor = directory.add("ana@aqp.test", ["DONANTE"]);

    const response = await change(donor.username, { action: "ADD", role: "REVISOR" });

    expect(bodyOf(response).roles).toEqual(["DONANTE", "REVISOR"]);
  });

  it.each([
    ["ADD", "GESTOR", ["DONANTE", "GESTOR"], "already has the role"],
    ["REMOVE", "REVISOR", ["DONANTE", "GESTOR"], "never had the role"],
  ])("answers %s %s without changing or recording anything when the person %s", async (action, role, groups) => {
    const person = directory.add("ana@aqp.test", groups);

    const response = await change(person.username, { action, role });

    expect(response.statusCode).toBe(200);
    expect(bodyOf(response)).toMatchObject({ changed: false, roles: groups });
    expect(directory.writes).toEqual([]);
    expect(audited("ROLE_GRANTED").concat(audited("ROLE_REVOKED"))).toEqual([]);
  });

  it("keeps the answer of a change that happened when the audit write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(recordAuditEvent).mockRejectedValueOnce(new Error("audit table unavailable"));
    const donor = directory.add("ana@aqp.test", ["DONANTE"]);

    const response = await change(donor.username, { action: "ADD", role: "GESTOR" });

    expect(response.statusCode).toBe(200);
    expect(directory.groupsNow(donor.username)).toContain("GESTOR");
  });
});

describe("the combinations that cannot exist are refused with 409 before anything changes", () => {
  it.each([
    ["REVISOR", ["DONANTE", "GESTOR"]],
    ["GESTOR", ["DONANTE", "REVISOR"]],
  ])("giving %s to someone who holds %j", async (role, groups) => {
    const person = directory.add("ana@aqp.test", groups);

    const response = await change(person.username, { action: "ADD", role });

    expect(response.statusCode).toBe(409);
    expect(bodyOf(response).message).toContain("no pueden combinarse");
    expect(directory.writes).toEqual([]);
    expect(directory.groupsNow(person.username)).toEqual(groups);
  });
});

describe("what an administrator is never allowed, whoever the person is", () => {
  it.each(["AUDITOR", "ADMIN"])("giving or taking %s: the operator script does that (403)", async (role) => {
    const person = directory.add("ana@aqp.test", ["DONANTE"]);

    for (const action of ["ADD", "REMOVE"]) {
      const response = await change(person.username, { action, role });

      expect(response.statusCode).toBe(403);
      expect(bodyOf(response).message).toContain("script de operación");
    }
    expect(directory.writes).toEqual([]);
    expect(audited("AUTHZ_DECISION")).toEqual([
      expect.objectContaining({ outcome: "DENIED", reason: "ROLE_NOT_ASSIGNABLE" }),
      expect.objectContaining({ outcome: "DENIED", reason: "ROLE_NOT_ASSIGNABLE" }),
    ]);
  });

  it("changing their own roles (403), even to take a role away", async () => {
    for (const body of [
      { action: "ADD", role: "DONANTE" },
      { action: "REMOVE", role: "DONANTE" },
    ]) {
      const response = await change(admin.sub, body);

      expect(response.statusCode).toBe(403);
    }
    expect(directory.writes).toEqual([]);
    expect(audited("AUTHZ_DECISION")).toEqual([
      expect.objectContaining({ reason: "SELF_ROLE_CHANGE" }),
      expect.objectContaining({ reason: "SELF_ROLE_CHANGE" }),
    ]);
  });

  it.each([["AUDITOR"], ["ADMIN"]])(
    "touching someone who is %s, so nobody can silence the auditor (403)",
    async (held) => {
      const protectedUser = directory.add("prot@aqp.test", [held]);

      for (const body of [
        { action: "ADD", role: "GESTOR" },
        { action: "REMOVE", role: "DONANTE" },
      ]) {
        expect((await change(protectedUser.username, body)).statusCode).toBe(403);
      }
      expect(directory.writes).toEqual([]);
      expect(audited("AUTHZ_DECISION").map((event) => event.reason)).toEqual(["PROTECTED_USER", "PROTECTED_USER"]);
      expect(directory.groupsNow(protectedUser.username)).toEqual([held]);
    }
  );
});

describe("the request is checked before it reaches the identity provider", () => {
  it("answers 404 for a person who is not in the pool", async () => {
    expect((await change("00000000-0000-4000-8000-000000000000", { action: "ADD", role: "GESTOR" })).statusCode).toBe(
      404
    );
    expect(directory.writes).toEqual([]);
  });

  it.each([
    ["an unknown action", { action: "SET", role: "GESTOR" }],
    ["an unknown role", { action: "ADD", role: "SUPERUSER" }],
    ["a missing role", { action: "ADD" }],
    ["an empty body", {}],
  ])("answers 400 for %s", async (_label, body) => {
    const person = directory.add("ana@aqp.test", ["DONANTE"]);

    expect((await change(person.username, body)).statusCode).toBe(400);
    expect(directory.calls).toEqual([]);
  });

  it.each(["a b", "x".repeat(129), 'abc"; DROP', "../../etc"])("answers 400 for the user id %j", async (userId) => {
    expect((await change(userId, { action: "ADD", role: "GESTOR" })).statusCode).toBe(400);
    expect(directory.calls).toEqual([]);
  });
});

describe("only an administrator, with a role that is still valid, can ask", () => {
  it.each(["DONANTE", "GESTOR", "REVISOR", "AUDITOR"])("refuses a %s (403) and changes nothing", async (role) => {
    const person = directory.add("ana@aqp.test", ["DONANTE"]);

    const response = await change(
      person.username,
      { action: "ADD", role: "GESTOR" },
      { sub: "caller", groups: [role] }
    );

    expect(response.statusCode).toBe(403);
    expect(directory.writes).toEqual([]);
  });

  it("refuses without a token (401)", async () => {
    const person = directory.add("ana@aqp.test", ["DONANTE"]);

    expect((await change(person.username, { action: "ADD", role: "GESTOR" }, null)).statusCode).toBe(401);
    expect(directory.writes).toEqual([]);
  });

  it("refuses an administrator who also holds another role: the roles do not mix", async () => {
    const person = directory.add("ana@aqp.test", ["DONANTE"]);
    const mixed = { sub: "mixed", groups: ["ADMIN", "DONANTE"] };

    const response = await change(person.username, { action: "ADD", role: "GESTOR" }, mixed);

    expect(response.statusCode).toBe(403);
    expect(audited("AUTHZ_DECISION")).toEqual([expect.objectContaining({ reason: "SEPARATION_OF_DUTIES" })]);
    expect(directory.writes).toEqual([]);
  });

  it("refuses when the identity provider says the person is no longer an administrator, though the token says so", async () => {
    replaceGroupsLookup(async () => ["DONANTE"]);
    const person = directory.add("ana@aqp.test", ["DONANTE"]);

    const response = await change(person.username, { action: "ADD", role: "GESTOR" });

    expect(response.statusCode).toBe(403);
    expect(audited("AUTHZ_DECISION")).toEqual([expect.objectContaining({ reason: "ROLE_REVOKED" })]);
    expect(directory.writes).toEqual([]);
  });

  it("refuses when the session was revoked (401), and when the groups cannot be read (fail closed)", async () => {
    const person = directory.add("ana@aqp.test", ["DONANTE"]);

    vi.mocked(isSessionActive).mockResolvedValueOnce(false);
    expect((await change(person.username, { action: "ADD", role: "GESTOR" })).statusCode).toBe(401);

    replaceGroupsLookup(async () => undefined);
    expect((await change(person.username, { action: "ADD", role: "GESTOR" })).statusCode).toBe(403);
    expect(directory.writes).toEqual([]);
  });
});

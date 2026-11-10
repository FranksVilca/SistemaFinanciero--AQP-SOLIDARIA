import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/audit/recordAuditEvent.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/audit/recordAuditEvent.js")>()),
  recordAuditEvent: vi.fn(async () => undefined),
}));
vi.mock("../../src/authz/sessionCheck.js", () => ({ isSessionActive: vi.fn(async () => true) }));

import { handler as listUsers } from "../../src/admin/listUsers.js";
import { replaceUserDirectory } from "../../src/admin/userDirectory.js";
import { replaceGroupsLookup } from "../../src/authz/currentGroups.js";
import { buildEvent, type TestIdentity } from "../integration/helpers/events.js";
import { FakeDirectory } from "./fakeDirectory.js";

interface Item {
  userId: string;
  email?: string;
  roles: string[];
  isSelf: boolean;
  isProtected: boolean;
  addable: string[];
  removable: string[];
}

let directory: FakeDirectory;
let admin: TestIdentity;

const list = (queryStringParameters?: Record<string, string>, caller: TestIdentity | null = admin) =>
  listUsers(buildEvent({ identity: caller ?? undefined, queryStringParameters }));
const itemsOf = (response: { body: string }) => (JSON.parse(response.body) as { items: Item[] }).items;
const itemFor = (items: Item[], email: string) => items.find((item) => item.email === email)!;

beforeEach(() => {
  directory = new FakeDirectory();
  replaceUserDirectory(directory);
  replaceGroupsLookup(async (principal) => principal.groups);
  admin = { sub: directory.add("admin@aqp.test", ["ADMIN"]).sub, groups: ["ADMIN"] };
});

afterEach(() => {
  replaceUserDirectory();
  replaceGroupsLookup();
  vi.restoreAllMocks();
});

describe("the list of people with their roles", () => {
  it("says for each person which roles they hold and which the rules still let the administrator change", async () => {
    directory.add("donor@aqp.test", ["DONANTE"]);
    directory.add("manager@aqp.test", ["DONANTE", "GESTOR"]);
    directory.add("reviewer@aqp.test", ["DONANTE", "REVISOR"]);
    directory.add("auditor@aqp.test", ["AUDITOR"]);

    const items = itemsOf(await list());

    expect(itemFor(items, "donor@aqp.test")).toMatchObject({
      roles: ["DONANTE"],
      addable: ["GESTOR", "REVISOR"],
      removable: ["DONANTE"],
      isProtected: false,
    });
    // GESTOR and REVISOR cannot be held together: neither is offered to someone who has the other.
    expect(itemFor(items, "manager@aqp.test")).toMatchObject({ addable: [], removable: ["DONANTE", "GESTOR"] });
    expect(itemFor(items, "reviewer@aqp.test")).toMatchObject({ addable: [], removable: ["DONANTE", "REVISOR"] });
    expect(itemFor(items, "auditor@aqp.test")).toMatchObject({
      roles: ["AUDITOR"],
      isProtected: true,
      addable: [],
      removable: [],
    });
  });

  it("offers the administrator nothing on their own account", async () => {
    const own = itemFor(itemsOf(await list()), "admin@aqp.test");

    expect(own).toMatchObject({ isSelf: true, isProtected: true, addable: [], removable: [] });
  });

  it("ignores groups that are not roles, and never sends the sub of anybody", async () => {
    directory.add("odd@aqp.test", ["DONANTE", "GESTOR_FAKE"]);

    const response = await list();
    const odd = itemFor(itemsOf(response), "odd@aqp.test");

    expect(odd.roles).toEqual(["DONANTE"]);
    expect(response.body).not.toContain('"sub"');
  });

  it("passes the search by email, the page size and the page token to the directory", async () => {
    directory.nextPageToken = "next-page_1==";

    const response = await list({ email: "ana@", limit: "10", nextToken: "tok.en-1_=" });

    expect(directory.lastListQuery).toEqual({ limit: 10, emailPrefix: "ana@", paginationToken: "tok.en-1_=" });
    expect(JSON.parse(response.body).nextToken).toBe("next-page_1==");
  });

  it("uses 20 people per page unless told otherwise", async () => {
    await list();

    expect(directory.lastListQuery?.limit).toBe(20);
  });

  it.each([
    ["limit", "0"],
    ["limit", "26"],
    ["limit", "abc"],
    ["email", 'a" or email ^= "'],
    ["email", "x".repeat(65)],
    ["nextToken", 'a b"; x'],
  ])("answers 400 for %s=%j without asking the directory", async (name, value) => {
    const response = await list({ [name]: value });

    expect(response.statusCode).toBe(400);
    expect(directory.lastListQuery).toBeUndefined();
  });
});

describe("only an administrator sees the people of the pool", () => {
  it.each(["DONANTE", "GESTOR", "REVISOR", "AUDITOR"])("refuses a %s (403)", async (role) => {
    const response = await list(undefined, { sub: "caller", groups: [role] });

    expect(response.statusCode).toBe(403);
    expect(directory.lastListQuery).toBeUndefined();
  });

  it("refuses without a token (401), and an administrator whose role is gone from the identity provider (403)", async () => {
    expect((await list(undefined, null)).statusCode).toBe(401);

    replaceGroupsLookup(async () => ["DONANTE"]);
    expect((await list()).statusCode).toBe(403);
    expect(directory.lastListQuery).toBeUndefined();
  });
});

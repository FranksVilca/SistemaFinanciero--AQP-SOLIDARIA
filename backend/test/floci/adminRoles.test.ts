import { randomUUID } from "node:crypto";
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminListGroupsForUserCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { beforeEach, describe, expect, inject, it } from "vitest";
import { buildEvent, type TestIdentity } from "../integration/helpers/events.js";
import { clearAllTables, readAllAuditEvents } from "../integration/helpers/seed.js";
import { cognito, createUserInGroup } from "./helpers/cognitoUsers.js";
import { FLOCI_ENV } from "./flociEnv.js";
import { credentialsOf, runHandlerAs } from "./helpers/runHandler.js";

/**
 * The administration of roles with the IAM credentials of its own functions against the emulated Cognito: it lists and
 * changes the groups of real users, and it can do nothing else with the pool.
 */

const LIST = "admin/listUsers.handler";
const CHANGE = "admin/changeUserRole.handler";
const ACCESS_DENIED = "AccessDeniedException";
const pool = inject("rolesPool");

const username = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@aqpsolidaria.pe`;

async function personInGroup(prefix: string, group: string): Promise<TestIdentity> {
  const name = username(prefix);
  await createUserInGroup({ userPoolId: pool.userPoolId, clientId: "unused" }, name, group);
  // A pool that signs in with the email fills this attribute itself; the emulated one needs it for the search.
  await cognito.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: pool.userPoolId,
      Username: name,
      UserAttributes: [
        { Name: "email", Value: name },
        { Name: "email_verified", Value: "true" },
      ],
    })
  );
  // The pool names the user by this username; the claims the gateway verified carry it as `sub` here.
  return { sub: name, groups: [group] };
}

const groupsNow = async (name: string): Promise<string[]> =>
  (await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: pool.userPoolId, Username: name }))).Groups?.map(
    (group) => String(group.GroupName)
  ) ?? [];

const change = (admin: TestIdentity, userId: string, body: unknown) =>
  runHandlerAs(CHANGE, buildEvent({ identity: admin, pathParameters: { userId }, body }), {
    userPoolId: pool.userPoolId,
  });

const list = (admin: TestIdentity, queryStringParameters?: Record<string, string>) =>
  runHandlerAs(LIST, buildEvent({ identity: admin, queryStringParameters }), { userPoolId: pool.userPoolId });

function clientAs(handlerRef: string): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({
    region: FLOCI_ENV.AWS_REGION,
    endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
    credentials: credentialsOf(handlerRef),
  });
}

async function errorNameOf(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return (error as Error).name;
  }
}

describe("an administrator changes the roles of real users of the pool", () => {
  let admin: TestIdentity;

  beforeEach(async () => {
    await clearAllTables();
    admin = await personInGroup("admin", "ADMIN");
  });

  it("gives and takes away GESTOR, in the group of the pool, and records both changes", async () => {
    const donor = await personInGroup("donor", "DONANTE");

    const given = await change(admin, donor.sub, { action: "ADD", role: "GESTOR" });
    expect(given.statusCode).toBe(200);
    expect((await groupsNow(donor.sub)).sort()).toEqual(["DONANTE", "GESTOR"]);

    const taken = await change(admin, donor.sub, { action: "REMOVE", role: "GESTOR" });
    expect(taken.statusCode).toBe(200);
    expect(await groupsNow(donor.sub)).toEqual(["DONANTE"]);
    expect((await readAllAuditEvents()).map((event) => event.eventType).sort()).toEqual([
      "ROLE_GRANTED",
      "ROLE_REVOKED",
    ]);
  });

  it("refuses to make a reviewer a manager (409) and leaves the groups of the pool as they were", async () => {
    const reviewer = await personInGroup("reviewer", "REVISOR");

    const response = await change(admin, reviewer.sub, { action: "ADD", role: "GESTOR" });

    expect(response.statusCode).toBe(409);
    expect(await groupsNow(reviewer.sub)).toEqual(["REVISOR"]);
  });

  it("refuses AUDITOR and ADMIN, and refuses to touch someone who holds one of them (403)", async () => {
    const donor = await personInGroup("donor", "DONANTE");
    const auditor = await personInGroup("auditor", "AUDITOR");

    expect((await change(admin, donor.sub, { action: "ADD", role: "AUDITOR" })).statusCode).toBe(403);
    expect((await change(admin, donor.sub, { action: "ADD", role: "ADMIN" })).statusCode).toBe(403);
    expect((await change(admin, auditor.sub, { action: "ADD", role: "GESTOR" })).statusCode).toBe(403);
    expect(await groupsNow(donor.sub)).toEqual(["DONANTE"]);
    expect(await groupsNow(auditor.sub)).toEqual(["AUDITOR"]);
  });

  it("answers 404 for a user that is not in the pool", async () => {
    expect((await change(admin, username("ghost"), { action: "ADD", role: "GESTOR" })).statusCode).toBe(404);
  });

  it("lists the people with their roles and what can still be done, and searches by the start of the email", async () => {
    const donor = await personInGroup("zz-listed", "DONANTE");

    const response = await list(admin, { email: "zz-listed" });
    const { items } = JSON.parse(response.body) as {
      items: Array<{ userId: string; roles: string[]; addable: string[]; removable: string[] }>;
    };

    expect(response.statusCode).toBe(200);
    expect(items).toEqual([
      expect.objectContaining({
        userId: donor.sub,
        roles: ["DONANTE"],
        addable: ["GESTOR", "REVISOR"],
        removable: ["DONANTE"],
      }),
    ]);
  });
});

describe("IAM: the administration functions can do nothing else with the pool", () => {
  const poolId = () => pool.userPoolId;
  const addToGroup = (handlerRef: string) =>
    clientAs(handlerRef).send(
      new AdminAddUserToGroupCommand({ UserPoolId: poolId(), Username: "anyone", GroupName: "GESTOR" })
    );
  const deleteUser = (handlerRef: string) =>
    clientAs(handlerRef).send(new AdminDeleteUserCommand({ UserPoolId: poolId(), Username: "anyone" }));
  const createUser = (handlerRef: string) =>
    clientAs(handlerRef).send(new AdminCreateUserCommand({ UserPoolId: poolId(), Username: "anyone@x.pe" }));

  it("lets ChangeUserRole add people to a group", async () => {
    expect(await errorNameOf(addToGroup(CHANGE))).not.toBe(ACCESS_DENIED);
  });

  it.each([LIST, "audit/getAuditEvents.handler", "reviews/reviewDonation.handler"])(
    "refuses %s to change a group",
    async (handlerRef) => {
      expect(await errorNameOf(addToGroup(handlerRef))).toBe(ACCESS_DENIED);
    }
  );

  it.each([LIST, CHANGE])("refuses %s to delete or create users", async (handlerRef) => {
    expect(await errorNameOf(deleteUser(handlerRef))).toBe(ACCESS_DENIED);
    expect(await errorNameOf(createUser(handlerRef))).toBe(ACCESS_DENIED);
  });
});

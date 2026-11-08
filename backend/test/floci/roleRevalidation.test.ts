import { randomUUID } from "node:crypto";
import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { beforeEach, describe, expect, inject, it } from "vitest";
import { buildEvent, type TestIdentity } from "../integration/helpers/events.js";
import { clearAllTables, readAllAuditEvents, seedProject } from "../integration/helpers/seed.js";
import { cognito, createUserInGroup } from "./helpers/cognitoUsers.js";
import { FLOCI_ENV } from "./flociEnv.js";
import { credentialsOf, runHandlerAs } from "./helpers/runHandler.js";

/**
 * A token keeps the groups it was issued with. Here a sensitive action reads the current groups of the person from the
 * emulated Cognito with the IAM credentials of its own function, and the token still says the old role.
 */

const AUDIT = "audit/getAuditEvents.handler";
const PUBLISH = "projects/publishProject.handler";
const ACCESS_DENIED = "AccessDeniedException";

const pool = inject("rolesPool");

async function personInGroup(group: string): Promise<TestIdentity> {
  const username = `${group.toLowerCase()}-${randomUUID().slice(0, 8)}@aqpsolidaria.pe`;
  await createUserInGroup({ userPoolId: pool.userPoolId, clientId: "unused" }, username, group);
  // The pool names the user by this username; the claims the gateway verified carry it as `sub` here.
  return { sub: username, groups: [group] };
}

const audit = (identity: TestIdentity) =>
  runHandlerAs(AUDIT, buildEvent({ identity }), { userPoolId: pool.userPoolId });

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

describe("a sensitive action reads the current roles of the person from Cognito", () => {
  beforeEach(clearAllTables);

  it("lets an auditor through while Cognito still lists the AUDITOR group", async () => {
    const auditor = await personInGroup("AUDITOR");

    expect((await audit(auditor)).statusCode).toBe(200);
  });

  it("refuses the same token once the person was removed from the group, and audits why", async () => {
    const auditor = await personInGroup("AUDITOR");
    expect((await audit(auditor)).statusCode).toBe(200);

    await cognito.send(
      new AdminRemoveUserFromGroupCommand({ UserPoolId: pool.userPoolId, Username: auditor.sub, GroupName: "AUDITOR" })
    );
    const response = await audit(auditor); // the token has not changed: it still says AUDITOR
    const denials = (await readAllAuditEvents()).filter((event) => event.outcome === "DENIED");

    expect(response.statusCode).toBe(403);
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({ reason: "ROLE_REVOKED", action: "ViewAudit" });
  });

  it("refuses a manager who lost GESTOR before publishing", async () => {
    const manager = await personInGroup("GESTOR");
    const draft = await seedProject({ status: "BORRADOR" });
    await cognito.send(
      new AdminRemoveUserFromGroupCommand({ UserPoolId: pool.userPoolId, Username: manager.sub, GroupName: "GESTOR" })
    );

    const response = await runHandlerAs(
      PUBLISH,
      buildEvent({ identity: manager, pathParameters: { projectId: String(draft.projectId) } }),
      { userPoolId: pool.userPoolId }
    );

    expect(response.statusCode).toBe(403);
  });

  it("refuses an auditor who was also given another role after the token was issued", async () => {
    const auditor = await personInGroup("AUDITOR");
    await cognito.send(
      new AdminAddUserToGroupCommand({ UserPoolId: pool.userPoolId, Username: auditor.sub, GroupName: "DONANTE" })
    );

    expect((await audit(auditor)).statusCode).toBe(403);
  });

  it("refuses when the user does not exist in the pool (fail closed)", async () => {
    const ghost: TestIdentity = { sub: `ghost-${randomUUID()}`, groups: ["AUDITOR"] };

    expect((await audit(ghost)).statusCode).toBe(403);
  });
});

describe("IAM: only the sensitive functions may list the groups of a user", () => {
  const listGroups = (handlerRef: string) =>
    clientAs(handlerRef).send(new AdminListGroupsForUserCommand({ UserPoolId: pool.userPoolId, Username: "anyone" }));

  it.each([AUDIT, PUBLISH, "donations/simulateDonation.handler"])("%s is allowed to ask", async (handlerRef) => {
    const name = await errorNameOf(listGroups(handlerRef));

    expect(name).not.toBe(ACCESS_DENIED); // a missing user is a different error than a denied permission
  });

  it.each([
    "projects/listProjects.handler",
    "projects/createProject.handler",
    "donations/createDonation.handler",
    "donations/getMyDonations.handler",
  ])("%s is answered with AccessDenied", async (handlerRef) => {
    expect(await errorNameOf(listGroups(handlerRef))).toBe(ACCESS_DENIED);
  });
});

import { randomUUID } from "node:crypto";
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { beforeEach, describe, expect, inject, it } from "vitest";
import type { PostConfirmationEvent } from "../../src/identity/addDonorToGroup.js";
import { clearAllTables, readAllAuditEvents } from "../integration/helpers/seed.js";
import { FLOCI_ENV } from "./flociEnv.js";
import { cognito } from "./helpers/cognitoUsers.js";
import { credentialsOf, runHandlerAs } from "./helpers/runHandler.js";

/**
 * The registration trigger with the IAM credentials of its own function against the emulated Cognito: it adds a new
 * user to the donor group, it can do nothing else with Cognito, and no other function can add anyone to a group.
 */

const TRIGGER = "identity/addDonorToGroup.handler";
const ACCESS_DENIED = "AccessDeniedException";
const pool = inject("rolesPool");

const clientAs = (handlerRef: string) =>
  new CognitoIdentityProviderClient({
    region: FLOCI_ENV.AWS_REGION,
    endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
    credentials: credentialsOf(handlerRef),
  });

async function errorNameOf(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return (error as Error).name;
  }
}

async function newUser(): Promise<string> {
  const username = `new-${randomUUID().slice(0, 8)}@aqpsolidaria.pe`;
  await cognito.send(
    new AdminCreateUserCommand({ UserPoolId: pool.userPoolId, Username: username, MessageAction: "SUPPRESS" })
  );
  return username;
}

const groupsOf = async (username: string): Promise<string[]> =>
  (
    (await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: pool.userPoolId, Username: username })))
      .Groups ?? []
  ).map((group) => String(group.GroupName));

const registration = (username: string, triggerSource = "PostConfirmation_ConfirmSignUp"): PostConfirmationEvent => ({
  triggerSource,
  userPoolId: pool.userPoolId,
  userName: username,
  request: { userAttributes: { sub: randomUUID() } },
});

describe("the registration trigger, with its own IAM role", () => {
  beforeEach(clearAllTables);

  it("makes a newly confirmed user a donor and records it", async () => {
    const username = await newUser();
    expect(await groupsOf(username)).toEqual([]);

    await runHandlerAs(TRIGGER, registration(username), { userPoolId: pool.userPoolId });

    expect(await groupsOf(username)).toEqual(["DONANTE"]);
    const [event] = await readAllAuditEvents();
    expect(event).toMatchObject({ eventType: "ROLE_ASSIGNED", outcome: "SUCCESS", resourceRef: "role:DONANTE" });
  });

  it("leaves a user alone when the confirmation is a password reset", async () => {
    const username = await newUser();

    await runHandlerAs(TRIGGER, registration(username, "PostConfirmation_ConfirmForgotPassword"), {
      userPoolId: pool.userPoolId,
    });

    expect(await groupsOf(username)).toEqual([]);
  });

  it("fails, and records nothing, for a user that does not exist", async () => {
    await expect(
      runHandlerAs(TRIGGER, registration(`ghost-${randomUUID()}`), { userPoolId: pool.userPoolId })
    ).rejects.toBeDefined();

    expect(await readAllAuditEvents()).toHaveLength(0);
  });
});

describe("IAM: adding a user to a group is the only thing the trigger may do with Cognito", () => {
  const add = (handlerRef: string, group = "DONANTE") =>
    clientAs(handlerRef).send(
      new AdminAddUserToGroupCommand({ UserPoolId: pool.userPoolId, Username: "anyone", GroupName: group })
    );

  it("lets the trigger ask to add a user (a missing user is another error than a denied permission)", async () => {
    expect(await errorNameOf(add(TRIGGER))).not.toBe(ACCESS_DENIED);
  });

  it.each([
    "projects/createProject.handler",
    "projects/publishProject.handler",
    "donations/createDonation.handler",
    "audit/getAuditEvents.handler",
  ])("answers %s with AccessDenied when it tries to put someone in a group", async (handlerRef) => {
    expect(await errorNameOf(add(handlerRef, "GESTOR"))).toBe(ACCESS_DENIED);
  });

  it.each([
    [
      "remove a user from a group",
      (client: CognitoIdentityProviderClient) =>
        client.send(
          new AdminRemoveUserFromGroupCommand({ UserPoolId: pool.userPoolId, Username: "anyone", GroupName: "DONANTE" })
        ),
    ],
    [
      "delete a user",
      (client: CognitoIdentityProviderClient) =>
        client.send(new AdminDeleteUserCommand({ UserPoolId: pool.userPoolId, Username: "anyone" })),
    ],
    [
      "read the groups of a user",
      (client: CognitoIdentityProviderClient) =>
        client.send(new AdminListGroupsForUserCommand({ UserPoolId: pool.userPoolId, Username: "anyone" })),
    ],
  ])("does not let the trigger %s", async (_label, operation) => {
    expect(await errorNameOf(operation(clientAs(TRIGGER)))).toBe(ACCESS_DENIED);
  });
});

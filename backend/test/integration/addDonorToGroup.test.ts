import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pseudonymizeActor } from "../../src/audit/recordAuditEvent.js";
import { handler, type PostConfirmationEvent } from "../../src/identity/addDonorToGroup.js";
import { replaceRoleAssigner } from "../../src/identity/assignRole.js";
import { clearAllTables, readAllAuditEvents } from "./helpers/seed.js";

const SUB = "9d3f2c1e-0000-4000-8000-00000000abcd";

const registration = (overrides: Partial<PostConfirmationEvent> = {}): PostConfirmationEvent => ({
  triggerSource: "PostConfirmation_ConfirmSignUp",
  userPoolId: "us-east-1_pool",
  userName: "person@example.com",
  request: { userAttributes: { sub: SUB } },
  ...overrides,
});

interface Assignment {
  userPoolId: string;
  username: string;
  role: string;
}

describe("the registration trigger makes whoever registers a donor", () => {
  let assignments: Assignment[];

  beforeEach(async () => {
    await clearAllTables();
    assignments = [];
    replaceRoleAssigner(async (userPoolId, username, role) => {
      assignments.push({ userPoolId, username, role });
    });
  });
  afterEach(() => replaceRoleAssigner());

  it("gives the donor role to a new registration, returns the event Cognito expects and audits the grant", async () => {
    const event = registration();

    const answer = await handler(event, { awsRequestId: "req-1" });
    const events = await readAllAuditEvents();

    expect(answer).toBe(event);
    expect(assignments).toEqual([{ userPoolId: "us-east-1_pool", username: "person@example.com", role: "DONANTE" }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: "ROLE_ASSIGNED",
      action: "AssignInitialRole",
      outcome: "SUCCESS",
      resourceRef: "role:DONANTE",
      requestId: "req-1",
      actorRef: pseudonymizeActor(SUB),
    });
    expect(JSON.stringify(events)).not.toContain(SUB);
    expect(JSON.stringify(events)).not.toContain("person@example.com");
  });

  it.each(["PostConfirmation_ConfirmForgotPassword", "PreSignUp_SignUp", ""])(
    "does nothing for %j: confirming a password reset must not give back a role an administrator removed",
    async (triggerSource) => {
      const event = registration({ triggerSource });

      expect(await handler(event)).toBe(event);

      expect(assignments).toEqual([]);
      expect(await readAllAuditEvents()).toHaveLength(0);
    }
  );

  it("never grants any role but DONANTE, whatever the event says", async () => {
    await handler(registration({ userName: "GESTOR", userPoolId: "AUDITOR" }));
    await handler(registration({ request: { userAttributes: { sub: "AUDITOR" } } }));

    expect(assignments.map((assignment) => assignment.role)).toEqual(["DONANTE", "DONANTE"]);
  });

  it("fails visibly, without recording a grant that did not happen", async () => {
    replaceRoleAssigner(async () => {
      throw new Error("Cognito is unavailable");
    });

    await expect(handler(registration())).rejects.toThrow("Cognito is unavailable");

    expect(await readAllAuditEvents()).toHaveLength(0);
  });
});

import { describe, expect, it, vi } from "vitest";

// Audit persistence is verified against a real table in test/integration/audit.test.ts.
vi.mock("../src/audit/recordAuditEvent.js", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));

import { WITH_AUTH, withAuth } from "../src/authz/withAuth.js";
import { AUTHZ_ACTIONS } from "../src/shared/constants.js";
import { NotFoundError } from "../src/shared/errors.js";
import { buildSuccessResponse } from "../src/shared/response.js";

const donorEvent = (sub = "donor-1") => ({
  requestContext: { requestId: "req-1", authorizer: { jwt: { claims: { sub, "cognito:groups": '["DONANTE"]' } } } },
});
const eventWithGroups = (groups: string) => ({
  requestContext: { requestId: "req-2", authorizer: { jwt: { claims: { sub: "user-1", "cognito:groups": groups } } } },
});

const okHandler = () => vi.fn(async () => buildSuccessResponse({ ok: true }));

describe("withAuth", () => {
  it("marks the handler so the route coverage test can recognise it", () => {
    const handler = withAuth(okHandler(), { action: AUTHZ_ACTIONS.listProjects, resourceType: "Project" });
    expect(handler[WITH_AUTH]).toBe(true);
  });

  it("returns 401 without running the business logic when there is no identity", async () => {
    const logic = okHandler();
    const handler = withAuth(logic, { action: AUTHZ_ACTIONS.createDonation, resourceType: "Donation" });

    const response = await handler({ requestContext: { requestId: "req-anon" } });

    expect(response.statusCode).toBe(401);
    expect(logic).not.toHaveBeenCalled();
  });

  it("returns 403 without running the business logic when the role is not allowed", async () => {
    const logic = okHandler();
    const handler = withAuth(logic, { action: AUTHZ_ACTIONS.createProject, resourceType: "Project" });

    const response = await handler(donorEvent());

    expect(response.statusCode).toBe(403);
    expect(logic).not.toHaveBeenCalled();
  });

  it("does not grant a role to a group whose name merely resembles it", async () => {
    const handler = withAuth(okHandler(), { action: AUTHZ_ACTIONS.createProject, resourceType: "Project" });

    expect((await handler(eventWithGroups('["GESTOR_FAKE"]'))).statusCode).toBe(403);
    expect((await handler(eventWithGroups("[gestor]"))).statusCode).toBe(403);
  });

  it("accepts the group claim formats delivered by the HTTP API authorizer", async () => {
    const handler = withAuth(okHandler(), { action: AUTHZ_ACTIONS.createProject, resourceType: "Project" });

    expect((await handler(eventWithGroups('["GESTOR"]'))).statusCode).toBe(200);
    expect((await handler(eventWithGroups("[GESTOR DONANTE]"))).statusCode).toBe(200);
  });

  it("returns the 404 of loadResource before evaluating the policy", async () => {
    const logic = okHandler();
    const handler = withAuth(logic, {
      action: AUTHZ_ACTIONS.simulateDonation,
      resourceType: "Donation",
      loadResource: async () => {
        throw new NotFoundError("Donación no encontrada");
      },
    });

    expect((await handler(donorEvent())).statusCode).toBe(404);
    expect(logic).not.toHaveBeenCalled();
  });

  it("does not reveal whether a resource exists to a caller without identity or without the role", async () => {
    const options = {
      action: AUTHZ_ACTIONS.simulateDonation,
      resourceType: "Donation" as const,
      loadResource: async () => {
        throw new NotFoundError("Donación no encontrada");
      },
    };
    const handler = withAuth(okHandler(), options);

    expect((await handler({ requestContext: { requestId: "req-anon" } })).statusCode).toBe(401);
    expect((await handler(eventWithGroups('["GESTOR"]'))).statusCode).toBe(403);
  });

  it("denies an owner mismatch and allows the owner", async () => {
    const logic = okHandler();
    const handler = withAuth(logic, {
      action: AUTHZ_ACTIONS.simulateDonation,
      resourceType: "Donation",
      loadResource: async () => ({ resource: { id: "d-1" }, ownerSub: "donor-owner" }),
    });

    expect((await handler(donorEvent("donor-other"))).statusCode).toBe(403);
    expect(logic).not.toHaveBeenCalled();
    expect((await handler(donorEvent("donor-owner"))).statusCode).toBe(200);
  });

  it("denies when the resource has no owner but ownership is required", async () => {
    const handler = withAuth(okHandler(), {
      action: AUTHZ_ACTIONS.simulateDonation,
      resourceType: "Donation",
      loadResource: async () => ({ resource: { id: "d-2" } }),
    });

    expect((await handler(donorEvent())).statusCode).toBe(403);
  });

  it("maps an unexpected failure to a generic 500 without internal details", async () => {
    const handler = withAuth(
      async () => {
        throw new Error("secret internal detail at /var/task/index.js:10");
      },
      { action: AUTHZ_ACTIONS.listProjects, resourceType: "Project" }
    );

    const response = await handler({ requestContext: { requestId: "req-boom" } });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("secret internal detail");
    expect(response.body).not.toContain("/var/task");
  });
});

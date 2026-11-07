import { afterEach, describe, expect, it, vi } from "vitest";

// Forcing the audit write to fail is the point of this test; every other collaborator is real.
vi.mock("../src/audit/recordAuditEvent.js", () => ({
  recordAuditEvent: vi.fn(async () => {
    throw new Error("audit table unavailable");
  }),
}));

import { recordAuditEvent } from "../src/audit/recordAuditEvent.js";
import { withAuth } from "../src/authz/withAuth.js";
import { AUTHZ_ACTIONS } from "../src/shared/constants.js";
import { buildSuccessResponse } from "../src/shared/response.js";

afterEach(() => vi.restoreAllMocks());

const eventOf = (groups: string) => ({
  requestContext: {
    requestId: "req-audit",
    authorizer: { jwt: { claims: { sub: "user-1", token_use: "access", "cognito:groups": groups } } },
  },
});

describe("audit write failures", () => {
  it("keeps a successful response and logs the failure", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = withAuth(async () => buildSuccessResponse({ created: true }, 201), {
      action: AUTHZ_ACTIONS.createProject,
      resourceType: "Project",
    });

    const response = await handler(eventOf('["GESTOR"]'));

    expect(response.statusCode).toBe(201);
    expect(recordAuditEvent).toHaveBeenCalled();
    expect(errors.mock.calls.map((call) => String(call[0])).join("\n")).toContain("Audit event could not be written");
  });

  it("keeps the denial response and logs the failure", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = withAuth(async () => buildSuccessResponse({}), {
      action: AUTHZ_ACTIONS.createProject,
      resourceType: "Project",
    });

    const response = await handler(eventOf('["DONANTE"]'));

    expect(response.statusCode).toBe(403);
    expect(errors.mock.calls.map((call) => String(call[0])).join("\n")).toContain("Audit event could not be written");
  });
});

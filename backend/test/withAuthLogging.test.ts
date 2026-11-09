import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/audit/recordAuditEvent.js", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));

import { withAuth } from "../src/authz/withAuth.js";
import { AUTHZ_ACTIONS } from "../src/shared/constants.js";
import { ConflictError, ServiceUnavailableError, TooManyRequestsError } from "../src/shared/errors.js";

afterEach(() => vi.restoreAllMocks());

const donorEvent = {
  requestContext: {
    requestId: "req-log",
    authorizer: { jwt: { claims: { sub: "donor-1", token_use: "access", "cognito:groups": '["DONANTE"]' } } },
  },
};

async function run(failure: Error) {
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const handler = withAuth(
    async () => {
      throw failure;
    },
    { action: AUTHZ_ACTIONS.createDonation, resourceType: "Donation" }
  );
  const response = await handler(donorEvent);
  return { response, warnings, errors };
}

describe("how a failed request is logged", () => {
  it.each([
    ["a rate limit (429)", new TooManyRequestsError(), 429],
    ["a conflict (409)", new ConflictError("ya existe"), 409],
    ["a contended retry (503)", new ServiceUnavailableError("reintente", 1), 503],
  ])("logs %s as a warning, so an alarm on errors stays quiet", async (_name, failure, status) => {
    const { response, warnings, errors } = await run(failure);

    expect(response.statusCode).toBe(status);
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(warnings.mock.calls[0]?.[0]));
    expect(entry.message).toBe("Request refused");
    expect(entry.context).toMatchObject({ requestId: "req-log", statusCode: status });
  });

  it("still logs an unexpected fault as an error, with its stack", async () => {
    const { response, warnings, errors } = await run(new Error("boom"));

    expect(response.statusCode).toBe(500);
    expect(warnings).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(errors.mock.calls[0]?.[0])).error.stack).toContain("boom");
  });
});

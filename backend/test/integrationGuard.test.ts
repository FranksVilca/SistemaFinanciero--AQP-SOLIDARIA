import { describe, it, expect } from "vitest";
import { assertIntegrationEndpoint } from "./integration/support/localTables.js";

// A CI run without DYNAMODB_ENDPOINT must fail instead of reporting green with zero tests.
describe("integration endpoint guard", () => {
  it("fails in CI when DYNAMODB_ENDPOINT is missing", () => {
    expect(() => assertIntegrationEndpoint({ CI: "true" })).toThrow(/DYNAMODB_ENDPOINT/);
  });

  it("allows a local run without the endpoint to skip", () => {
    expect(assertIntegrationEndpoint({})).toBe(false);
  });

  it("reports the endpoint as available when it is set", () => {
    expect(assertIntegrationEndpoint({ CI: "true", DYNAMODB_ENDPOINT: "http://localhost:8000" })).toBe(true);
  });
});

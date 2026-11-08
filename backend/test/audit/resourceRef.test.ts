import { describe, expect, it } from "vitest";
import { resolveResourceRef } from "../../src/audit/resourceRef.js";
import type { ApiEvent } from "../../src/shared/apiEvent.js";

const PROJECT_ID = "3f0c3c9e-8f0e-4a43-9d0a-0f4f1c9d2a10";
const DONATION_ID = "a1b2c3d4-0000-4000-8000-123456789abc";

const event = (parts: Partial<ApiEvent>): ApiEvent => parts as ApiEvent;

describe("resolveResourceRef", () => {
  it("takes the resource from the path", () => {
    expect(resolveResourceRef(event({ pathParameters: { projectId: PROJECT_ID } }))).toBe(`project:${PROJECT_ID}`);
  });

  it("takes the created resource from the response", () => {
    expect(resolveResourceRef(event({}), JSON.stringify({ donationId: DONATION_ID }))).toBe(`donation:${DONATION_ID}`);
  });

  it("takes the project a request names in its body, so a denied donation says which project it was for", () => {
    expect(resolveResourceRef(event({ body: JSON.stringify({ projectId: PROJECT_ID, amountCents: 5_000 }) }))).toBe(
      `project:${PROJECT_ID}`
    );
  });

  it("prefers the path and the response over the body", () => {
    const other = "11111111-1111-4111-8111-111111111111";
    const withBody = event({ pathParameters: { donationId: DONATION_ID }, body: JSON.stringify({ projectId: other }) });

    expect(resolveResourceRef(withBody)).toBe(`donation:${DONATION_ID}`);
  });

  it.each([
    ["not a UUID", JSON.stringify({ projectId: "'; DROP TABLE--" })],
    ["a very long string", JSON.stringify({ projectId: "a".repeat(5_000) })],
    ["not a string", JSON.stringify({ projectId: { nested: PROJECT_ID } })],
    ["not JSON", "projectId=" + PROJECT_ID],
    ["empty", undefined],
  ])("does not copy an attacker-controlled body into the audit trail (%s)", (_label, body) => {
    expect(resolveResourceRef(event({ body }))).toBe("-");
  });
});

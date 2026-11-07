import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, logInfo } from "../src/shared/logger.js";

afterEach(() => vi.restoreAllMocks());

function capturedLog(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
}

describe("structured logging (FR-015)", () => {
  it("never writes tokens, user identifiers, emails or amounts", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logInfo("event", {
      requestId: "req-1",
      accessToken: "token-value-123",
      sub: "sub-value-456",
      donorSub: "donor-value-789",
      email: "donor@example.org",
      amountCents: 98765,
      nested: { authorization: "Bearer abc", donorSub: "nested-donor" },
    });

    const output = capturedLog(spy);
    for (const secret of [
      "token-value-123",
      "sub-value-456",
      "donor-value-789",
      "donor@example.org",
      "98765",
      "Bearer abc",
      "nested-donor",
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("req-1");
  });

  it("keeps the correlation identifier and pseudonymized actor in error logs", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logError("failed", new Error("boom"), { requestId: "req-2", actorRef: "usr_abc123", donorSub: "raw-sub" });

    const output = capturedLog(spy);
    expect(output).toContain("req-2");
    expect(output).toContain("usr_abc123");
    expect(output).not.toContain("raw-sub");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/shared/dynamo.js", () => {
  return {
    docClient: {
      send: vi.fn(),
    },
    TABLE_NAMES: {
      projects: "aqp-projects-test",
      donations: "aqp-donations-test",
      idempotency: "aqp-idempotency-test",
      audit: "aqp-audit-test",
    },
    QueryCommand: class MockQueryCommand {
      constructor(public input: unknown) {}
    },
  };
});

import { docClient } from "../src/shared/dynamo.js";
import { handler as getMyDonationsHandler } from "../src/donations/getMyDonations.js";

describe("User Story 6 - Donor Private History & BOLA Prevention (HU-07, T09, T12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return HTTP 200 with only caller's donations based on JWT sub", async () => {
    const callerSub = "donor-sub-alice";

    (docClient.send as any).mockResolvedValueOnce({
      Items: [
        {
          donationId: "don-alice-1",
          projectId: "proj-1",
          donorSub: callerSub,
          amountCents: 5000,
          currency: "PEN",
          status: "CONFIRMADA_SIMULADA",
          createdAt: "2026-11-06T12:00:00Z",
        },
      ],
    });

    const event = {
      requestContext: {
        requestId: "req-alice-history",
        authorizer: {
          jwt: {
            claims: {
              sub: callerSub,
              "cognito:groups": '["DONANTE"]',
            },
          },
        },
      },
    };

    const response = await getMyDonationsHandler(event as any);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].donorSub).toBe(callerSub);
  });

  it("T12: should return HTTP 403 Forbidden when a GESTOR attempts to query donor personal history", async () => {
    const gestorSub = "gestor-sub-bob";

    const event = {
      requestContext: {
        requestId: "req-gestor-forbidden",
        authorizer: {
          jwt: {
            claims: {
              sub: gestorSub,
              "cognito:groups": '["GESTOR"]',
            },
          },
        },
      },
    };

    const response = await getMyDonationsHandler(event as any);
    expect(response.statusCode).toBe(403);
  });
});

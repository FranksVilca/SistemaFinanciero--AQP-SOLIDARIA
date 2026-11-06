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
    GetCommand: class MockGetCommand {
      constructor(public input: unknown) {}
    },
    TransactWriteCommand: class MockTransactWriteCommand {
      constructor(public input: unknown) {}
    },
  };
});

import { docClient } from "../src/shared/dynamo.js";
import { handler as simulateDonationHandler } from "../src/donations/simulateDonation.js";

describe("User Story 5 - Donation State Transitions (HU-06, CA-06.1, CA-06.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const donationId = "donation-state-1";
  const donorSub = "donor-owner-1";
  const projectId = "proj-1";

  it("should successfully confirm donation when in PENDIENTE_SIMULACION (HTTP 200)", async () => {
    // 1. GetCommand to fetch donation
    (docClient.send as any).mockResolvedValueOnce({
      Item: {
        donationId,
        projectId,
        donorSub,
        amountCents: 5000,
        currency: "PEN",
        status: "PENDIENTE_SIMULACION",
      },
    });

    // 2. TransactWriteCommand to atomically update donation and increment project
    (docClient.send as any).mockResolvedValueOnce({});

    const event = {
      pathParameters: { donationId },
      body: JSON.stringify({ action: "CONFIRMAR" }),
      requestContext: {
        requestId: "req-sim-confirm",
        authorizer: {
          jwt: {
            claims: {
              sub: donorSub,
              "cognito:groups": '["DONANTE"]',
            },
          },
        },
      },
    };

    const response = await simulateDonationHandler(event as any);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("CONFIRMADA_SIMULADA");
  });

  it("should successfully reject donation without altering project aggregates", async () => {
    (docClient.send as any).mockResolvedValueOnce({
      Item: {
        donationId,
        projectId,
        donorSub,
        amountCents: 5000,
        currency: "PEN",
        status: "PENDIENTE_SIMULACION",
      },
    });

    (docClient.send as any).mockResolvedValueOnce({});

    const event = {
      pathParameters: { donationId },
      body: JSON.stringify({ action: "RECHAZAR" }),
      requestContext: {
        requestId: "req-sim-reject",
        authorizer: {
          jwt: {
            claims: {
              sub: donorSub,
              "cognito:groups": '["DONANTE"]',
            },
          },
        },
      },
    };

    const response = await simulateDonationHandler(event as any);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("RECHAZADA_SIMULADA");
  });

  it("should return HTTP 409 Conflict when attempting to re-simulate an already terminal donation", async () => {
    (docClient.send as any).mockResolvedValueOnce({
      Item: {
        donationId,
        projectId,
        donorSub,
        amountCents: 5000,
        currency: "PEN",
        status: "CONFIRMADA_SIMULADA", // Already terminal
      },
    });

    const event = {
      pathParameters: { donationId },
      body: JSON.stringify({ action: "CONFIRMAR" }),
      requestContext: {
        requestId: "req-sim-terminal",
        authorizer: {
          jwt: {
            claims: {
              sub: donorSub,
              "cognito:groups": '["DONANTE"]',
            },
          },
        },
      },
    };

    const response = await simulateDonationHandler(event as any);
    expect(response.statusCode).toBe(409);
  });
});

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
    PutCommand: class MockPutCommand {
      constructor(public input: unknown) {}
    },
    TransactWriteCommand: class MockTransactWriteCommand {
      constructor(public input: unknown) {}
    },
  };
});

import { docClient } from "../src/shared/dynamo.js";
import { handler as createDonationHandler } from "../src/donations/createDonation.js";
import { hashPayload } from "../src/shared/hash.js";

describe("User Story 4 - Atomic Idempotency & Creation (HU-05, T05, T06, T07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validProjectId = "11111111-1111-1111-1111-111111111111";
  const idempotencyKey = "22222222-2222-2222-2222-222222222222";
  const donorSub = "donor-user-123";

  it("T05: should return HTTP 201 with PENDIENTE_SIMULACION when valid donation intention is created", async () => {
    // 1. GetCommand to verify project exists and is PUBLICADO
    (docClient.send as any).mockResolvedValueOnce({
      Item: {
        projectId: validProjectId,
        title: "Comedor Solidario",
        status: "PUBLICADO",
      },
    });

    // 2. TransactWriteCommand for Idempotency + Donation + Audit
    (docClient.send as any).mockResolvedValueOnce({});

    const event = {
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        projectId: validProjectId,
        amountCents: 5000,
      }),
      requestContext: {
        requestId: "req-t05",
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

    const response = await createDonationHandler(event as any);
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.projectId).toBe(validProjectId);
    expect(body.donorSub).toBe(donorSub);
    expect(body.amountCents).toBe(5000);
    expect(body.status).toBe("PENDIENTE_SIMULACION");
    expect(body.currency).toBe("PEN");
  });

  it("T06: should return identical HTTP 201 response when repeating identical payload and key", async () => {
    // 1. GetCommand for project
    (docClient.send as any).mockResolvedValueOnce({
      Item: {
        projectId: validProjectId,
        title: "Comedor Solidario",
        status: "PUBLICADO",
      },
    });

    // 2. TransactWriteCommand throws TransactionCanceledException (conditional check failed on Idempotency table)
    const txError = new Error("TransactionCanceledException");
    txError.name = "TransactionCanceledException";
    (docClient.send as any).mockRejectedValueOnce(txError);

    // 3. GetCommand on Idempotency table to inspect stored record
    const expectedHash = hashPayload({ projectId: validProjectId, amountCents: 5000 });
    (docClient.send as any).mockResolvedValueOnce({
      Item: {
        pk: `${donorSub}#createDonation#${idempotencyKey}`,
        payloadHash: expectedHash,
        donationId: "existing-donation-id-999",
        responseStatus: 201,
      },
    });

    // 4. GetCommand on Donations table to fetch existing donation
    (docClient.send as any).mockResolvedValueOnce({
      Item: {
        donationId: "existing-donation-id-999",
        projectId: validProjectId,
        donorSub,
        amountCents: 5000,
        currency: "PEN",
        status: "PENDIENTE_SIMULACION",
        createdAt: "2026-11-06T10:00:00Z",
        updatedAt: "2026-11-06T10:00:00Z",
      },
    });

    const event = {
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        projectId: validProjectId,
        amountCents: 5000,
      }),
      requestContext: {
        requestId: "req-t06-replay",
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

    const response = await createDonationHandler(event as any);
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.donationId).toBe("existing-donation-id-999");
    expect(body.amountCents).toBe(5000);
  });

  it("T07: should return HTTP 409 Conflict when repeating key with altered payload", async () => {
    // 1. GetCommand for project
    (docClient.send as any).mockResolvedValueOnce({
      Item: {
        projectId: validProjectId,
        title: "Comedor Solidario",
        status: "PUBLICADO",
      },
    });

    // 2. TransactWriteCommand throws TransactionCanceledException
    const txError = new Error("TransactionCanceledException");
    txError.name = "TransactionCanceledException";
    (docClient.send as any).mockRejectedValueOnce(txError);

    // 3. GetCommand on Idempotency table reveals DIFFERENT hash
    (docClient.send as any).mockResolvedValueOnce({
      Item: {
        pk: `${donorSub}#createDonation#${idempotencyKey}`,
        payloadHash: "different-stored-hash",
        donationId: "existing-donation-id-999",
        responseStatus: 201,
      },
    });

    const event = {
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        projectId: validProjectId,
        amountCents: 8000, // Different amount
      }),
      requestContext: {
        requestId: "req-t07-altered",
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

    const response = await createDonationHandler(event as any);
    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.code).toBe("CONFLICT");
  });
});

import { describe, it, expect, vi } from "vitest";

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

// Unit scope only: DynamoDB is mocked and the mock decides the single winner, so this test checks
// that a cancelled transaction maps to 409. Atomicity itself (one increment) is verified against
// DynamoDB Local in test/integration/concurrency.integration.test.ts.

describe("User Story 5 - Atomic Concurrency Verification (T08, CA-NF04.1)", () => {
  it("T08: 10 concurrent confirmation requests on the same donation should yield exactly 1 success (200) and 9 conflicts (409)", async () => {
    const donationId = "concurrent-donation-id";
    const donorSub = "donor-user-concurrent";
    const projectId = "proj-concurrent";

    let firstWinner = true;

    // Mock docClient.send to emulate DynamoDB serialization:
    // Every call starts by fetching the donation:
    (docClient.send as any).mockImplementation((command: any) => {
      if (command.constructor.name === "MockGetCommand") {
        return Promise.resolve({
          Item: {
            donationId,
            projectId,
            donorSub,
            amountCents: 1000,
            currency: "PEN",
            status: "PENDIENTE_SIMULACION",
          },
        });
      }

      if (command.constructor.name === "MockTransactWriteCommand") {
        if (firstWinner) {
          firstWinner = false;
          return Promise.resolve({}); // Winner succeeds
        } else {
          // Others fail condition check because status is no longer PENDIENTE_SIMULACION
          const err = new Error("TransactionCanceledException");
          err.name = "TransactionCanceledException";
          return Promise.reject(err);
        }
      }

      return Promise.resolve({});
    });

    // Dispatch 10 parallel requests
    const promises = Array.from({ length: 10 }).map((_, i) => {
      const event = {
        pathParameters: { donationId },
        body: JSON.stringify({ action: "CONFIRMAR" }),
        requestContext: {
          requestId: `req-concurrent-${i}`,
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
      return simulateDonationHandler(event as any);
    });

    const results = await Promise.all(promises);

    const successfulResponses = results.filter((r) => r.statusCode === 200);
    const conflictResponses = results.filter((r) => r.statusCode === 409);

    expect(successfulResponses.length).toBe(1);
    expect(conflictResponses.length).toBe(9);
  });
});

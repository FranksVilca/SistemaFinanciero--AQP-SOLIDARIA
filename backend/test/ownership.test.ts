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
    QueryCommand: class MockQueryCommand {
      constructor(public input: unknown) {}
    },
    TransactWriteCommand: class MockTransactWriteCommand {
      constructor(public input: unknown) {}
    },
  };
});

import { docClient } from "../src/shared/dynamo.js";
import { handler as simulateDonationHandler } from "../src/donations/simulateDonation.js";
import { handler as getMyDonationsHandler } from "../src/donations/getMyDonations.js";

// T09 / CA-07.2 - a donor cannot read or act on another donor's donation, and the error
// response does not leak any field of that donation. Handler level, DynamoDB mocked.

const OWNER_SUB = "donor-owner-alice";
const ATTACKER_SUB = "donor-attacker-mallory";
const VICTIM_DONATION = {
  donationId: "don-victim-7c1e",
  projectId: "proj-victim-93ab",
  donorSub: OWNER_SUB,
  amountCents: 98765,
  currency: "PEN",
  status: "PENDIENTE_SIMULACION",
  createdAt: "2026-11-06T12:00:00Z",
};

const send = docClient.send as unknown as ReturnType<typeof vi.fn>;
const sentCommands = () => send.mock.calls.map(([command]) => command.constructor.name as string);

const donorEvent = (sub: string, extra: Record<string, unknown> = {}) => ({
  ...extra,
  requestContext: {
    requestId: `req-${sub}`,
    authorizer: { jwt: { claims: { sub, "cognito:groups": '["DONANTE"]' } } },
  },
});

function expectNoDonationLeak(body: string) {
  const parsed = JSON.parse(body);
  expect(Object.keys(parsed).sort()).toEqual(["code", "message", "requestId"]);
  for (const value of [
    VICTIM_DONATION.donorSub,
    VICTIM_DONATION.projectId,
    String(VICTIM_DONATION.amountCents),
    VICTIM_DONATION.status,
  ]) {
    expect(body).not.toContain(value);
  }
}

describe("T09 / CA-07.2 - simulateDonation on another donor's donation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["CONFIRMAR", "RECHAZAR"])(
    "%s by a non-owner returns 403 without leaking the donation and without writing",
    async (action) => {
      send.mockResolvedValueOnce({ Item: { ...VICTIM_DONATION } });

      const response = await simulateDonationHandler(
        donorEvent(ATTACKER_SUB, {
          pathParameters: { donationId: VICTIM_DONATION.donationId },
          body: JSON.stringify({ action }),
        })
      );

      expect(response.statusCode).toBe(403);
      expectNoDonationLeak(response.body);
      expect(sentCommands()).toEqual(["MockGetCommand"]);
    }
  );

  it("a body claiming the owner's sub does not change the ownership decision", async () => {
    send.mockResolvedValueOnce({ Item: { ...VICTIM_DONATION } });

    const response = await simulateDonationHandler(
      donorEvent(ATTACKER_SUB, {
        pathParameters: { donationId: VICTIM_DONATION.donationId },
        body: JSON.stringify({ action: "CONFIRMAR", donorSub: OWNER_SUB, sub: OWNER_SUB }),
      })
    );

    expect(response.statusCode).toBe(403);
    expectNoDonationLeak(response.body);
    expect(sentCommands()).toEqual(["MockGetCommand"]);
  });

  it("an unknown donation id returns 404 without writing", async () => {
    send.mockResolvedValueOnce({});

    const response = await simulateDonationHandler(
      donorEvent(ATTACKER_SUB, {
        pathParameters: { donationId: "don-does-not-exist" },
        body: JSON.stringify({ action: "CONFIRMAR" }),
      })
    );

    expect(response.statusCode).toBe(404);
    expect(Object.keys(JSON.parse(response.body)).sort()).toEqual(["code", "message", "requestId"]);
    expect(sentCommands()).toEqual(["MockGetCommand"]);
  });
});

describe("T09 / CA-07.2 - getMyDonations is scoped to the token sub only", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries the donor GSI with the JWT sub, ignoring sub/donorSub sent by the client", async () => {
    send.mockResolvedValueOnce({ Items: [] });

    const response = await getMyDonationsHandler(
      donorEvent(ATTACKER_SUB, {
        queryStringParameters: { sub: OWNER_SUB, donorSub: OWNER_SUB },
        pathParameters: { donorSub: OWNER_SUB },
        body: JSON.stringify({ sub: OWNER_SUB, donorSub: OWNER_SUB }),
        headers: { "x-donor-sub": OWNER_SUB },
      }) as never
    );

    expect(response.statusCode).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const [command] = send.mock.calls[0];
    expect(command.constructor.name).toBe("MockQueryCommand");
    expect(command.input).toMatchObject({
      IndexName: "donorSub-createdAt-index",
      KeyConditionExpression: "donorSub = :sub",
      ExpressionAttributeValues: { ":sub": ATTACKER_SUB },
    });
    expect(JSON.stringify(command.input)).not.toContain(OWNER_SUB);
  });

  it("a token without sub is rejected before any query", async () => {
    const response = await getMyDonationsHandler({
      queryStringParameters: { donorSub: OWNER_SUB },
      requestContext: { requestId: "req-no-sub", authorizer: { jwt: { claims: {} } } },
    } as never);

    expect(response.statusCode).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });
});

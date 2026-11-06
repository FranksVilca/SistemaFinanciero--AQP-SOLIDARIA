import { afterEach, describe, expect, it, vi } from "vitest";
import { docClient, GetCommand, TABLE_NAMES } from "../../src/shared/dynamo.js";
import { handler as simulateDonationHandler } from "../../src/donations/simulateDonation.js";
import { hasLocalEndpoint } from "./support/localTables.js";
import { donorEvent, getItem, seedPendingDonation, seedPublishedProject, statusCounts } from "./support/fixtures.js";

// T08 / CA-06.2 / CA-NF04.1 against DynamoDB Local: the real handler and the real
// TransactWriteItems condition decide the single winner (no mocked DynamoDB decision).

const CONCURRENT_REQUESTS = 10;
const AMOUNT_CENTS = 2500;
const DONOR_SUB = "it-donor-concurrency";

const confirmConcurrently = (donationId: string) =>
  Promise.all(
    Array.from({ length: CONCURRENT_REQUESTS }, () =>
      simulateDonationHandler(
        donorEvent(DONOR_SUB, {
          pathParameters: { donationId },
          body: JSON.stringify({ action: "CONFIRMAR" }),
        })
      )
    )
  );

async function expectSingleIncrement(projectId: string, donationId: string) {
  const project = await getItem("projects", { projectId });
  const donation = await getItem("donations", { donationId });
  expect(project?.confirmedAmountCents).toBe(AMOUNT_CENTS);
  expect(donation?.status).toBe("CONFIRMADA_SIMULADA");
}

describe.skipIf(!hasLocalEndpoint())("T08 - concurrent confirmations on DynamoDB Local", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("10 concurrent CONFIRMAR calls yield exactly one 200, nine 409 and one increment", async () => {
    const projectId = await seedPublishedProject();
    const { donationId } = await seedPendingDonation(projectId, DONOR_SUB, AMOUNT_CENTS);

    const responses = await confirmConcurrently(donationId);

    console.info(`[T08] status codes: ${JSON.stringify(statusCounts(responses))}`);
    expect(statusCounts(responses)).toEqual({ 200: 1, 409: 9 });
    await expectSingleIncrement(projectId, donationId);
  });

  it("the conditional transaction alone keeps one increment when all 10 calls read PENDIENTE", async () => {
    const projectId = await seedPublishedProject();
    const pending = await seedPendingDonation(projectId, DONOR_SUB, AMOUNT_CENTS);

    // Every handler reads the same stale PENDIENTE snapshot, so the in-code status check passes
    // for all 10 and only DynamoDB's ConditionExpression can reject the duplicates.
    const realSend = docClient.send.bind(docClient);
    let transactions = 0;
    vi.spyOn(docClient, "send").mockImplementation(((command: unknown) => {
      if (command instanceof GetCommand && command.input.TableName === TABLE_NAMES.donations) {
        return Promise.resolve({ Item: { ...pending } });
      }
      transactions += 1;
      return realSend(command as never);
    }) as typeof docClient.send);

    const responses = await confirmConcurrently(pending.donationId);
    vi.restoreAllMocks();

    expect(transactions).toBe(CONCURRENT_REQUESTS);
    expect(statusCounts(responses)).toEqual({ 200: 1, 409: 9 });
    await expectSingleIncrement(projectId, pending.donationId);
  });
});

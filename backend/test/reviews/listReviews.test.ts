import { randomUUID } from "node:crypto";
import type { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/audit/recordAuditEvent.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/audit/recordAuditEvent.js")>()),
  recordAuditEvent: vi.fn(async () => undefined),
}));

import { pseudonymizeActor } from "../../src/audit/recordAuditEvent.js";
import { replaceGroupsLookup } from "../../src/authz/currentGroups.js";
import { handler as listReviews } from "../../src/reviews/listReviews.js";
import { buildEvent, identityFor, type TestIdentity } from "../integration/helpers/events.js";
import { FakeDynamo } from "../donations/helpers/fakeDynamo.js";

type Item = Record<string, unknown>;
interface Queue {
  items: Item[];
  nextToken?: string;
}

let dynamo: FakeDynamo;
let queries: Array<QueryCommand["input"]>;

function held(index: number): Item {
  return {
    donationId: randomUUID(),
    projectId: randomUUID(),
    donorSub: `donor-${randomUUID()}`,
    amountCents: 90_000 + index,
    currency: "PEN",
    status: "EN_REVISION",
    reviewReasons: ["HOURLY_AMOUNT"],
    createdAt: `2026-11-0${index + 1}T10:00:00.000Z`,
    updatedAt: `2026-11-0${index + 1}T10:00:00.000Z`,
  };
}

/** Serves the held donations a page at a time, like the index would, from the key it was given. */
function serve(items: Item[]): void {
  dynamo.onQuery = (input) => {
    queries.push(input);
    const start = input.ExclusiveStartKey
      ? items.findIndex((item) => item.donationId === input.ExclusiveStartKey!.donationId) + 1
      : 0;
    const page = items.slice(start, start + (input.Limit ?? items.length));
    const last = page.at(-1);
    const more = start + page.length < items.length;
    return {
      Items: page,
      ...(more &&
        last && {
          LastEvaluatedKey: { donationId: last.donationId, status: last.status, createdAt: last.createdAt },
        }),
    };
  };
}

const list = (identity: TestIdentity | undefined, queryStringParameters?: Record<string, string>) =>
  listReviews(buildEvent({ identity, queryStringParameters }));

beforeEach(() => {
  replaceGroupsLookup(async (principal) => principal.groups);
  queries = [];
  dynamo = new FakeDynamo();
  dynamo.install();
});

afterEach(() => vi.restoreAllMocks());

describe("the review queue", () => {
  it("lists the held donations oldest first from the status index", async () => {
    const items = [held(0), held(1)];
    serve(items);

    const response = await list(identityFor("REVISOR"));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).items.map((item: Item) => item.donationId)).toEqual(
      items.map((item) => item.donationId)
    );
    expect(queries[0]).toMatchObject({
      IndexName: "status-createdAt-index",
      ExpressionAttributeValues: { ":status": "EN_REVISION" },
      ScanIndexForward: true,
      Limit: 20,
    });
  });

  it("returns only what the reviewer needs, with a pseudonymized donor and never the donorSub", async () => {
    const item = held(0);
    serve([item]);

    const response = await list(identityFor("REVISOR"));
    const [listed] = JSON.parse(response.body).items as Item[];

    expect(listed).toEqual({
      donationId: item.donationId,
      projectId: item.projectId,
      amountCents: item.amountCents,
      createdAt: item.createdAt,
      reviewReasons: ["HOURLY_AMOUNT"],
      donorRef: pseudonymizeActor(String(item.donorSub)),
    });
    expect(response.body).not.toContain(String(item.donorSub));
    expect(response.body).not.toContain("donorSub");
  });

  it("paginates with a limit and an opaque next token", async () => {
    const items = [held(0), held(1), held(2)];
    serve(items);

    const first = JSON.parse((await list(identityFor("REVISOR"), { limit: "2" })).body) as Queue;
    const second = JSON.parse(
      (await list(identityFor("REVISOR"), { limit: "2", nextToken: first.nextToken! })).body
    ) as Queue;

    expect(first.items).toHaveLength(2);
    expect(first.nextToken).toEqual(expect.any(String));
    expect(first.nextToken).not.toContain(String(items[1].donationId));
    expect(second.items.map((item) => item.donationId)).toEqual([items[2].donationId]);
    expect(second.nextToken).toBeUndefined();
    expect(queries[1].ExclusiveStartKey).toEqual({
      donationId: items[1].donationId,
      status: "EN_REVISION",
      createdAt: items[1].createdAt,
    });
  });

  it("caps the page at 50", async () => {
    serve([]);

    expect((await list(identityFor("REVISOR"), { limit: "50" })).statusCode).toBe(200);
    expect(queries[0].Limit).toBe(50);
  });

  it.each([
    ["a limit of zero", { limit: "0" }],
    ["a limit above 50", { limit: "51" }],
    ["a limit that is not a number", { limit: "diez" }],
    ["a token that is not ours", { nextToken: "bm90LWpzb24" }],
    [
      "a token that points to another status",
      {
        nextToken: Buffer.from(
          JSON.stringify({ donationId: randomUUID(), status: "CONFIRMADA_SIMULADA", createdAt: "2026-11-01" })
        ).toString("base64url"),
      },
    ],
  ])("answers 400 to %s without reading the table", async (_label, parameters) => {
    serve([]);

    const response = await list(identityFor("REVISOR"), parameters);

    expect(response.statusCode).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it.each(["DONANTE", "GESTOR", "AUDITOR"] as const)("is refused to a %s", async (role) => {
    serve([held(0)]);

    expect((await list(identityFor(role))).statusCode).toBe(403);
    expect(queries).toHaveLength(0);
  });

  it("is refused without identity", async () => {
    serve([held(0)]);

    expect((await list(undefined)).statusCode).toBe(401);
  });
});

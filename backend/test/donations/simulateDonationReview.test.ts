import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/audit/recordAuditEvent.js", () => ({ recordAuditEvent: vi.fn(async () => undefined) }));
// A confirmation is a sensitive request; its session check against Cognito is exercised elsewhere.
vi.mock("../../src/authz/sessionCheck.js", () => ({ isSessionActive: vi.fn(async () => true) }));

import { replaceGroupsLookup } from "../../src/authz/currentGroups.js";
import { handler as simulateDonation } from "../../src/donations/simulateDonation.js";
import { TABLE_NAMES } from "../../src/shared/dynamo.js";
import { buildEvent, identityFor } from "../integration/helpers/events.js";
import { FakeDynamo } from "./helpers/fakeDynamo.js";

let dynamo: FakeDynamo;

beforeEach(() => {
  replaceGroupsLookup(async (principal) => principal.groups);
  dynamo = new FakeDynamo();
  dynamo.install();
});

afterEach(() => vi.restoreAllMocks());

describe("a donation held for review", () => {
  it.each(["CONFIRMAR", "RECHAZAR"])("cannot be moved with %s and never reaches the project total", async (action) => {
    const donor = identityFor("DONANTE");
    const donationId = randomUUID();
    dynamo.put(
      TABLE_NAMES.donations,
      { donationId, projectId: randomUUID(), donorSub: donor.sub, amountCents: 90_000, status: "EN_REVISION" },
      ["donationId"]
    );

    const response = await simulateDonation(
      buildEvent({ identity: donor, pathParameters: { donationId }, body: { action } })
    );

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).message).toBe(
      "La donación está en revisión por los controles antifraude y no puede confirmarse ni rechazarse"
    );
    expect(dynamo.transactions).toHaveLength(0);
  });
});

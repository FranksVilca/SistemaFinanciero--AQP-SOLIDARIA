import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/audit/recordAuditEvent.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/audit/recordAuditEvent.js")>()),
  recordAuditEvent: vi.fn(async () => undefined),
}));
vi.mock("../../src/authz/sessionCheck.js", () => ({ isSessionActive: vi.fn(async () => true) }));

import { pseudonymizeActor, recordAuditEvent, type AuditEventInput } from "../../src/audit/recordAuditEvent.js";
import { replaceGroupsLookup } from "../../src/authz/currentGroups.js";
import { isSessionActive } from "../../src/authz/sessionCheck.js";
import { handler as reviewDonation } from "../../src/reviews/reviewDonation.js";
import { TABLE_NAMES } from "../../src/shared/dynamo.js";
import { buildEvent, identityFor, type TestIdentity } from "../integration/helpers/events.js";
import { FakeDynamo } from "../donations/helpers/fakeDynamo.js";

const MOTIVO = "Donante verificado por teléfono; el patrón corresponde a una colecta familiar.";

let dynamo: FakeDynamo;
let donorSub: string;
let managerSub: string;
let projectId: string;

function heldDonation(overrides: Record<string, unknown> = {}): string {
  const donationId = randomUUID();
  dynamo.put(
    TABLE_NAMES.donations,
    {
      donationId,
      projectId,
      donorSub,
      amountCents: 95_000,
      status: "EN_REVISION",
      reviewReasons: ["STRUCTURING"],
      createdAt: "2026-11-09T10:00:00.000Z",
      ...overrides,
    },
    ["donationId"]
  );
  return donationId;
}

function decide(reviewer: TestIdentity | undefined, donationId: string, body: unknown) {
  return reviewDonation(buildEvent({ identity: reviewer, pathParameters: { donationId }, body }));
}

function audited(eventType: string): AuditEventInput[] {
  return vi
    .mocked(recordAuditEvent)
    .mock.calls.map(([input]) => input)
    .filter((input) => input.eventType === eventType);
}

beforeEach(() => {
  replaceGroupsLookup(async (principal) => principal.groups);
  vi.mocked(recordAuditEvent).mockClear();
  vi.mocked(isSessionActive).mockClear();
  donorSub = `donor-${randomUUID()}`;
  managerSub = `manager-${randomUUID()}`;
  projectId = randomUUID();
  dynamo = new FakeDynamo();
  dynamo.put(TABLE_NAMES.projects, { projectId, status: "PUBLICADO", createdBy: managerSub }, ["projectId"]);
  dynamo.install();
});

afterEach(() => vi.restoreAllMocks());

describe("a reviewer decides on a held donation", () => {
  it("approves it: the donation becomes PENDIENTE_SIMULACION and records who decided, when and why", async () => {
    const reviewer = identityFor("REVISOR");
    const donationId = heldDonation();

    const response = await decide(reviewer, donationId, { decision: "APROBAR", motivo: `  ${MOTIVO}  ` });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ donationId, projectId, status: "PENDIENTE_SIMULACION" });
    expect(dynamo.get(TABLE_NAMES.donations, { donationId })).toMatchObject({
      status: "PENDIENTE_SIMULACION",
      reviewDecision: "APROBAR",
      reviewMotivo: MOTIVO,
      reviewedBy: pseudonymizeActor(reviewer.sub),
      reviewedAt: expect.any(String),
    });
  });

  it("rejects it: the donation becomes RECHAZADA_REVISION", async () => {
    const reviewer = identityFor("REVISOR");
    const donationId = heldDonation();

    const response = await decide(reviewer, donationId, { decision: "RECHAZAR", motivo: MOTIVO });

    expect(response.statusCode).toBe(200);
    expect(dynamo.get(TABLE_NAMES.donations, { donationId })).toMatchObject({
      status: "RECHAZADA_REVISION",
      reviewDecision: "RECHAZAR",
    });
  });

  it("never answers with the identity of the donor or of the reviewer", async () => {
    const reviewer = identityFor("REVISOR");
    const donationId = heldDonation();

    const response = await decide(reviewer, donationId, { decision: "APROBAR", motivo: MOTIVO });

    expect(response.body).not.toContain(donorSub);
    expect(response.body).not.toContain(reviewer.sub);
    expect(JSON.parse(response.body)).not.toHaveProperty("donorSub");
  });

  it("writes a REVIEW_DECISION audit event with the decision and without the motivo", async () => {
    const reviewer = identityFor("REVISOR");
    const donationId = heldDonation();

    await decide(reviewer, donationId, { decision: "RECHAZAR", motivo: MOTIVO });

    const events = audited("REVIEW_DECISION");
    expect(events).toEqual([
      expect.objectContaining({
        actorSub: reviewer.sub,
        action: "ReviewDonation",
        outcome: "SUCCESS",
        reason: "RECHAZAR",
        resourceRef: `donation:${donationId}`,
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(MOTIVO);
  });

  it("revalidates the session of the reviewer before deciding (sensitive action)", async () => {
    const donationId = heldDonation();
    vi.mocked(isSessionActive).mockResolvedValueOnce(false);

    const response = await decide(identityFor("REVISOR"), donationId, { decision: "APROBAR", motivo: MOTIVO });

    expect(response.statusCode).toBe(401);
    expect(dynamo.updates).toHaveLength(0);
  });

  it("refuses a reviewer whose REVISOR group was removed after the token was issued", async () => {
    const donationId = heldDonation();
    replaceGroupsLookup(async () => []);

    const response = await decide(identityFor("REVISOR"), donationId, { decision: "APROBAR", motivo: MOTIVO });

    expect(response.statusCode).toBe(403);
    expect(dynamo.updates).toHaveLength(0);
  });
});

describe("the decision is refused", () => {
  it.each([
    ["the status already changed", { status: "PENDIENTE_SIMULACION" }],
    ["it was already rejected", { status: "RECHAZADA_REVISION" }],
  ])("with 409 when %s", async (_label, overrides) => {
    const donationId = heldDonation(overrides);

    const response = await decide(identityFor("REVISOR"), donationId, { decision: "APROBAR", motivo: MOTIVO });

    expect(response.statusCode).toBe(409);
    expect(dynamo.get(TABLE_NAMES.donations, { donationId })?.status).toBe(overrides.status);
  });

  it("with 409 when another reviewer decided between the read and the write (conditional write)", async () => {
    const donationId = heldDonation();
    dynamo.onUpdate = () => {
      const current = dynamo.get(TABLE_NAMES.donations, { donationId })!;
      dynamo.put(TABLE_NAMES.donations, { ...current, status: "RECHAZADA_REVISION" }, ["donationId"]);
    };

    const response = await decide(identityFor("REVISOR"), donationId, { decision: "APROBAR", motivo: MOTIVO });

    expect(response.statusCode).toBe(409);
    expect(dynamo.get(TABLE_NAMES.donations, { donationId })?.status).toBe("RECHAZADA_REVISION");
    expect(audited("REVIEW_DECISION")).toHaveLength(0);
  });

  it("with 404 when the donation does not exist", async () => {
    const response = await decide(identityFor("REVISOR"), randomUUID(), { decision: "APROBAR", motivo: MOTIVO });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ["no motivo", { decision: "APROBAR" }],
    ["a motivo shorter than 10 characters once trimmed", { decision: "APROBAR", motivo: "   corto    " }],
    ["a motivo longer than 500 characters", { decision: "RECHAZAR", motivo: "x".repeat(501) }],
    ["a motivo that is not text", { decision: "RECHAZAR", motivo: 1234567890123 }],
    ["an unknown decision", { decision: "CONFIRMAR", motivo: MOTIVO }],
  ])("with 400 for %s", async (_label, body) => {
    const donationId = heldDonation();

    const response = await decide(identityFor("REVISOR"), donationId, body);

    expect(response.statusCode).toBe(400);
    expect(dynamo.updates).toHaveLength(0);
  });

  it("accepts a motivo of exactly 10 and of exactly 500 characters", async () => {
    for (const motivo of ["a".repeat(10), "b".repeat(500)]) {
      const response = await decide(identityFor("REVISOR"), heldDonation(), { decision: "RECHAZAR", motivo });
      expect(response.statusCode).toBe(200);
    }
  });

  it("with 403 when the reviewer is the donor of the donation, and audits why", async () => {
    const reviewer: TestIdentity = { sub: donorSub, groups: ["REVISOR", "DONANTE"] };
    const donationId = heldDonation();

    const response = await decide(reviewer, donationId, { decision: "APROBAR", motivo: MOTIVO });

    expect(response.statusCode).toBe(403);
    expect(dynamo.get(TABLE_NAMES.donations, { donationId })?.status).toBe("EN_REVISION");
    expect(audited("AUTHZ_DECISION")).toEqual([
      expect.objectContaining({ outcome: "DENIED", reason: "CONFLICT_OF_INTEREST", action: "ReviewDonation" }),
    ]);
  });

  it("with 403 when the reviewer created the project of the donation, and audits why", async () => {
    // Created the project while they were a manager; the roles cannot be combined, so today they are only a reviewer.
    const reviewer: TestIdentity = { sub: managerSub, groups: ["REVISOR", "DONANTE"] };
    const donationId = heldDonation();

    const response = await decide(reviewer, donationId, { decision: "RECHAZAR", motivo: MOTIVO });

    expect(response.statusCode).toBe(403);
    expect(dynamo.get(TABLE_NAMES.donations, { donationId })?.status).toBe("EN_REVISION");
    expect(audited("AUTHZ_DECISION")).toEqual([
      expect.objectContaining({ outcome: "DENIED", reason: "CONFLICT_OF_INTEREST" }),
    ]);
  });

  it.each(["DONANTE", "GESTOR", "AUDITOR"] as const)("with 403 for a %s", async (role) => {
    const response = await decide(identityFor(role), heldDonation(), { decision: "APROBAR", motivo: MOTIVO });

    expect(response.statusCode).toBe(403);
    expect(dynamo.updates).toHaveLength(0);
  });

  it("with 403 for someone who is AUDITOR and REVISOR", async () => {
    const both: TestIdentity = { sub: `x-${randomUUID()}`, groups: ["AUDITOR", "REVISOR"] };

    const response = await decide(both, heldDonation(), { decision: "APROBAR", motivo: MOTIVO });

    expect(response.statusCode).toBe(403);
  });

  it("with 401 without identity", async () => {
    const response = await decide(undefined, heldDonation(), { decision: "APROBAR", motivo: MOTIVO });

    expect(response.statusCode).toBe(401);
  });
});

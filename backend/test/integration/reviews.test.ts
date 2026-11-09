import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { handler as getMyDonations } from "../../src/donations/getMyDonations.js";
import { handler as simulateDonation } from "../../src/donations/simulateDonation.js";
import { handler as getProjectStats } from "../../src/projects/getProjectStats.js";
import { handler as expireReviews } from "../../src/reviews/expireReviews.js";
import { handler as listReviews } from "../../src/reviews/listReviews.js";
import { handler as reviewDonation } from "../../src/reviews/reviewDonation.js";
import { pseudonymizeActor } from "../../src/audit/recordAuditEvent.js";
import { buildEvent, identityFor, parseBody, type TestIdentity } from "./helpers/events.js";
import {
  clearAllTables,
  readAllAuditEvents,
  readDonation,
  readProject,
  seedDonation,
  seedProject,
} from "./helpers/seed.js";

// Fixed instant: the three donations of a donor always fall in the same velocity minute and hour.
const FROZEN_INSTANT = Date.parse("2030-03-04T09:20:10.000Z");
const NEAR_MAX_CENTS = 95_000;
const DAY_MS = 86_400_000;
const MOTIVO = "Revisión manual completada con la documentación del donante.";

interface QueueItem {
  donationId: string;
  reviewReasons?: string[];
  donorRef: string;
}

function donate(donor: TestIdentity, projectId: string) {
  return createDonation(
    buildEvent({
      identity: donor,
      headers: { "Idempotency-Key": randomUUID() },
      body: { projectId, amountCents: NEAR_MAX_CENTS },
    })
  );
}

/** The third donation close to the maximum within the hour is held by the structuring control. */
async function heldDonationOf(donor: TestIdentity, projectId: string): Promise<string> {
  await donate(donor, projectId);
  await donate(donor, projectId);
  const third = parseBody<{ donationId: string; status: string }>(await donate(donor, projectId));
  expect(third.status).toBe("EN_REVISION");
  return third.donationId;
}

const decide = (reviewer: TestIdentity, donationId: string, decision: "APROBAR" | "RECHAZAR") =>
  reviewDonation(
    buildEvent({ identity: reviewer, pathParameters: { donationId }, body: { decision, motivo: MOTIVO } })
  );

const confirm = (donor: TestIdentity, donationId: string) =>
  simulateDonation(buildEvent({ identity: donor, pathParameters: { donationId }, body: { action: "CONFIRMAR" } }));

async function queue(reviewer: TestIdentity): Promise<QueueItem[]> {
  return parseBody<{ items: QueueItem[] }>(await listReviews(buildEvent({ identity: reviewer }))).items;
}

describe("human review of the donations held by the velocity controls", () => {
  let projectId: string;
  let donor: TestIdentity;
  let reviewer: TestIdentity;

  beforeEach(async () => {
    await clearAllTables();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN_INSTANT);
    projectId = String((await seedProject({ createdBy: `manager-${randomUUID()}` })).projectId);
    donor = identityFor("DONANTE");
    reviewer = identityFor("REVISOR");
  });

  afterEach(() => vi.useRealTimers());

  it("shows the held donation in the queue with its reason and without the donor, and hides the reason from the donor", async () => {
    const donationId = await heldDonationOf(donor, projectId);

    const response = await listReviews(buildEvent({ identity: reviewer }));
    const history = await getMyDonations(buildEvent({ identity: donor }));

    expect(parseBody<{ items: QueueItem[] }>(response).items).toEqual([
      expect.objectContaining({ donationId, reviewReasons: ["STRUCTURING"], donorRef: expect.stringMatching(/^don_/) }),
    ]);
    expect(response.body).not.toContain(donor.sub);
    expect(history.body).not.toContain("reviewReasons");
  });

  it("approves a held donation, which the donor can then confirm into the project total", async () => {
    const donationId = await heldDonationOf(donor, projectId);

    const approved = await decide(reviewer, donationId, "APROBAR");
    const confirmed = await confirm(donor, donationId);

    expect(approved.statusCode).toBe(200);
    expect(confirmed.statusCode).toBe(200);
    expect(parseBody(confirmed).status).toBe("CONFIRMADA_SIMULADA");
    for (const field of ["reviewReasons", "reviewMotivo", "reviewedBy"]) expect(confirmed.body).not.toContain(field);
    expect((await readProject(projectId))?.confirmedAmountCents).toBe(NEAR_MAX_CENTS);
    expect(await queue(reviewer)).toEqual([]);
    const [decision] = (await readAllAuditEvents()).filter((event) => event.eventType === "REVIEW_DECISION");
    expect(decision).toMatchObject({ outcome: "SUCCESS", reason: "APROBAR", resourceRef: `donation:${donationId}` });
    expect(JSON.stringify(decision)).not.toContain(reviewer.sub);
    const reviewSuccesses = (await readAllAuditEvents()).filter(
      (event) => event.action === "ReviewDonation" && event.outcome === "SUCCESS"
    );
    expect(reviewSuccesses).toHaveLength(1);
  });

  it("never shows a reviewer who is also a donor their own held donations", async () => {
    const both: TestIdentity = { sub: `both-${randomUUID()}`, groups: ["DONANTE", "REVISOR"] };
    const donationId = await heldDonationOf(both, projectId);

    const own = await queue(both);
    const [listed] = await queue(reviewer);

    expect(own).toEqual([]);
    expect(listed).toMatchObject({ donationId });
    expect(listed.donorRef).not.toBe(pseudonymizeActor(both.sub));
  });

  it("rejects a held donation for good: it never counts toward the project total", async () => {
    const donationId = await heldDonationOf(donor, projectId);

    const rejected = await decide(reviewer, donationId, "RECHAZAR");
    const confirmAttempt = await confirm(donor, donationId);
    const stats = parseBody<{ confirmedAmountCents: number }>(
      await getProjectStats(buildEvent({ pathParameters: { projectId } }))
    );

    expect(rejected.statusCode).toBe(200);
    expect((await readDonation(donationId))?.status).toBe("RECHAZADA_REVISION");
    expect(confirmAttempt.statusCode).toBe(409);
    expect(stats.confirmedAmountCents).toBe(0);
    const history = parseBody<Array<{ donationId: string; status: string }>>(
      await getMyDonations(buildEvent({ identity: donor }))
    );
    expect(history.find((donation) => donation.donationId === donationId)?.status).toBe("RECHAZADA_REVISION");
  });

  it("lets exactly one of two concurrent decisions on the same donation win; the other gets 409", async () => {
    const donationId = await heldDonationOf(donor, projectId);
    const otherReviewer = identityFor("REVISOR");

    const responses = await Promise.all([
      decide(reviewer, donationId, "APROBAR"),
      decide(otherReviewer, donationId, "RECHAZAR"),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const winner = responses.find((response) => response.statusCode === 200)!;
    expect((await readDonation(donationId))?.status).toBe(parseBody(winner).status);
    expect((await readAllAuditEvents()).filter((event) => event.eventType === "REVIEW_DECISION")).toHaveLength(1);
  });

  it("refuses a reviewer who created the project, and one who is the donor", async () => {
    const managerAndReviewer: TestIdentity = { sub: `manager-${randomUUID()}`, groups: ["GESTOR", "REVISOR"] };
    const ownProject = String((await seedProject({ createdBy: managerAndReviewer.sub })).projectId);
    const donorAndReviewer: TestIdentity = { sub: `donor-${randomUUID()}`, groups: ["DONANTE", "REVISOR"] };
    const toOwnProject = await heldDonationOf(donor, ownProject);
    const ownDonation = await heldDonationOf(donorAndReviewer, projectId);

    expect((await decide(managerAndReviewer, toOwnProject, "APROBAR")).statusCode).toBe(403);
    expect((await decide(donorAndReviewer, ownDonation, "APROBAR")).statusCode).toBe(403);
    expect((await readDonation(toOwnProject))?.status).toBe("EN_REVISION");
    expect((await readDonation(ownDonation))?.status).toBe("EN_REVISION");
    const denials = (await readAllAuditEvents()).filter((event) => event.reason === "CONFLICT_OF_INTEREST");
    expect(denials).toHaveLength(2);
  });

  it("expires the donations nobody reviewed in 7 days, as the system, and leaves the recent ones", async () => {
    const old = await seedDonation(donor.sub, projectId, {
      status: "EN_REVISION",
      createdAt: new Date(FROZEN_INSTANT - 8 * DAY_MS).toISOString(),
    });
    const recent = await seedDonation(donor.sub, projectId, {
      status: "EN_REVISION",
      createdAt: new Date(FROZEN_INSTANT - 2 * DAY_MS).toISOString(),
    });

    const summary = await expireReviews();

    expect(summary).toEqual({ expired: 1, skipped: 0, hasMore: false });
    expect(await readDonation(String(old.donationId))).toMatchObject({
      status: "RECHAZADA_REVISION",
      reviewMotivo: "Vencida sin revisión",
      reviewedBy: "system",
    });
    expect((await readDonation(String(recent.donationId)))?.status).toBe("EN_REVISION");
    const expired = (await readAllAuditEvents()).filter((event) => event.eventType === "REVIEW_EXPIRED");
    expect(expired).toEqual([
      expect.objectContaining({
        actorRef: "system",
        action: "ExpireReview",
        resourceRef: `donation:${old.donationId}`,
      }),
    ]);
  });
});

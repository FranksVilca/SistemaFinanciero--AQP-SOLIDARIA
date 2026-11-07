import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { handler as getAuditEvents } from "../../src/audit/getAuditEvents.js";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { handler as getMyDonations } from "../../src/donations/getMyDonations.js";
import { handler as simulateDonation } from "../../src/donations/simulateDonation.js";
import { handler as createProject } from "../../src/projects/createProject.js";
import { handler as publishProject } from "../../src/projects/publishProject.js";
import { TABLE_NAMES } from "../../src/shared/dynamo.js";
import { buildEvent, identityFor, type TestEvent, type TestIdentity, type TestRole } from "./helpers/events.js";
import { clearAllTables, countItems, seedDonation, seedProject } from "./helpers/seed.js";

type Anonymous = "ANONYMOUS";
type Caller = TestRole | Anonymous;

const ALL_CALLERS: Caller[] = ["DONANTE", "GESTOR", "AUDITOR", "GESTOR_FAKE", "ANONYMOUS"];

interface Route {
  name: string;
  allowedRole: TestRole;
  call: (identity: TestIdentity | undefined) => Promise<{ statusCode: number }>;
}

function identityOf(caller: Caller): TestIdentity | undefined {
  return caller === "ANONYMOUS" ? undefined : identityFor(caller);
}

async function buildRoutes(): Promise<Route[]> {
  const project = await seedProject();
  const draft = await seedProject({ status: "BORRADOR" });
  const donationOwner = identityFor("DONANTE");
  const donation = await seedDonation(donationOwner.sub, String(project.projectId));

  const withIdentity = (
    identity: TestIdentity | undefined,
    rest: Omit<Parameters<typeof buildEvent>[0], "identity"> = {}
  ): TestEvent => buildEvent({ identity, ...rest });

  return [
    {
      name: "POST /v1/projects",
      allowedRole: "GESTOR",
      call: (identity) =>
        createProject(
          withIdentity(identity, {
            body: { title: "Proyecto", description: "Descripción larga", goalAmountCents: 10_000 },
          })
        ),
    },
    {
      name: "PATCH /v1/projects/{id}/publish",
      allowedRole: "GESTOR",
      call: (identity) =>
        publishProject(withIdentity(identity, { pathParameters: { projectId: String(draft.projectId) } })),
    },
    {
      name: "POST /v1/donations",
      allowedRole: "DONANTE",
      call: (identity) =>
        createDonation(
          withIdentity(identity, {
            headers: { "Idempotency-Key": randomUUID() },
            body: { projectId: String(project.projectId), amountCents: 5_000 },
          })
        ),
    },
    {
      name: "POST /v1/donations/{id}/simulate",
      allowedRole: "DONANTE",
      call: (identity) =>
        simulateDonation(
          withIdentity(identity, {
            pathParameters: { donationId: String(donation.donationId) },
            body: { action: "RECHAZAR" },
          })
        ),
    },
    {
      name: "GET /v1/donations/me",
      allowedRole: "DONANTE",
      call: (identity) => getMyDonations(withIdentity(identity)),
    },
    { name: "GET /v1/audit", allowedRole: "AUDITOR", call: (identity) => getAuditEvents(withIdentity(identity)) },
  ];
}

async function snapshotCounts(): Promise<Record<string, number>> {
  return {
    projects: await countItems(TABLE_NAMES.projects),
    donations: await countItems(TABLE_NAMES.donations),
    idempotency: await countItems(TABLE_NAMES.idempotency),
  };
}

describe("role x action matrix", () => {
  beforeEach(clearAllTables);

  it("rejects every disallowed caller with 401 or 403 and never changes the data", async () => {
    const routes = await buildRoutes();

    for (const route of routes) {
      for (const caller of ALL_CALLERS.filter((candidate) => candidate !== route.allowedRole)) {
        const before = await snapshotCounts();

        const { statusCode } = await route.call(identityOf(caller));

        const expected = caller === "ANONYMOUS" ? 401 : 403;
        expect(statusCode, `${route.name} as ${caller}`).toBe(expected);
        expect(await snapshotCounts(), `${route.name} as ${caller} changed data`).toEqual(before);
      }
    }
  });

  it("lets the allowed role reach the business logic", async () => {
    const routes = await buildRoutes();

    for (const route of routes) {
      const identity = route.name.includes("simulate") ? undefined : identityFor(route.allowedRole);
      if (!identity) continue; // the owner-bound route is covered by bola.test.ts

      const { statusCode } = await route.call(identity);

      expect([401, 403], `${route.name} as ${route.allowedRole}`).not.toContain(statusCode);
    }
  });
});

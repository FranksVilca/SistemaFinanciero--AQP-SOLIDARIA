import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { handler as getAuditEvents } from "../../src/audit/getAuditEvents.js";
import { handler as createProject } from "../../src/projects/createProject.js";
import { handler as getMyDonations } from "../../src/donations/getMyDonations.js";
import { handler as simulateDonation } from "../../src/donations/simulateDonation.js";
import { handler as publishProject } from "../../src/projects/publishProject.js";
import { SESSION_CHECK_TIMEOUT_MS } from "../../src/shared/constants.js";
import { replaceGroupsLookup } from "../../src/authz/currentGroups.js";
import { buildEvent, identityFor } from "./helpers/events.js";
import { clearAllTables, readAllAuditEvents, readDonation, seedDonation, seedProject } from "./helpers/seed.js";

type UserInfoBehavior = { kind: "status"; status: number } | { kind: "delay"; ms: number };

const originalUrl = process.env.COGNITO_USERINFO_URL;
const OPEN_PORT_PLACEHOLDER = 0;

let server: Server | undefined;
let requestCount = 0;

async function startUserInfo(behavior: UserInfoBehavior): Promise<void> {
  requestCount = 0;
  server = createServer((_request, response) => {
    requestCount += 1;
    const answer = () => {
      response.writeHead(behavior.kind === "status" ? behavior.status : 200);
      response.end("{}");
    };
    if (behavior.kind === "delay") setTimeout(answer, behavior.ms);
    else answer();
  });
  await new Promise<void>((resolve) => server!.listen(OPEN_PORT_PLACEHOLDER, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  process.env.COGNITO_USERINFO_URL = `http://127.0.0.1:${port}/oauth2/userInfo`;
}

async function stopServerCompletely(): Promise<void> {
  if (!server) return;
  const closing = server;
  server = undefined;
  closing.closeAllConnections();
  await new Promise<void>((resolve) => closing.close(() => resolve()));
}

async function draftPublishEvent() {
  const draft = await seedProject({ status: "BORRADOR" });
  return buildEvent({ identity: identityFor("GESTOR"), pathParameters: { projectId: String(draft.projectId) } });
}

describe("session revalidation on sensitive actions", () => {
  beforeEach(clearAllTables);
  afterEach(stopServerCompletely);
  afterAll(() => {
    process.env.COGNITO_USERINFO_URL = originalUrl;
  });

  it("lets a sensitive action through when the session is active", async () => {
    await startUserInfo({ kind: "status", status: 200 });

    const response = await publishProject(await draftPublishEvent());

    expect(response.statusCode).toBe(200);
    expect(requestCount).toBe(1);
  });

  it("rejects a sensitive action with 401 when the session was revoked and audits the reason", async () => {
    await startUserInfo({ kind: "status", status: 401 });

    const response = await publishProject(await draftPublishEvent());
    const [event] = await readAllAuditEvents();

    expect(response.statusCode).toBe(401);
    expect(event).toMatchObject({ outcome: "DENIED", reason: "SESSION_REVOKED", action: "PublishProject" });
  });

  it("rejects the audit query when the session cannot be verified in time (fail closed)", async () => {
    await startUserInfo({ kind: "delay", ms: SESSION_CHECK_TIMEOUT_MS + 500 });

    const response = await getAuditEvents(buildEvent({ identity: identityFor("AUDITOR") }));

    expect(response.statusCode).toBe(401);
  });

  it("rejects a sensitive action when the identity provider is unreachable (fail closed)", async () => {
    await startUserInfo({ kind: "status", status: 200 });
    await stopServerCompletely(); // the URL now points to a closed port

    const response = await getAuditEvents(buildEvent({ identity: identityFor("AUDITOR") }));

    expect(response.statusCode).toBe(401);
  });

  it("rejects a sensitive action when no user info URL is configured (fail closed)", async () => {
    delete process.env.COGNITO_USERINFO_URL;

    const response = await getAuditEvents(buildEvent({ identity: identityFor("AUDITOR") }));

    expect(response.statusCode).toBe(401);
  });

  it("revalidates the session when a donation is confirmed but not when it is rejected", async () => {
    await startUserInfo({ kind: "status", status: 401 });
    const donor = identityFor("DONANTE");
    const project = await seedProject();
    const confirmable = await seedDonation(donor.sub, String(project.projectId));
    const rejectable = await seedDonation(donor.sub, String(project.projectId));
    const simulate = (donationId: unknown, action: string) =>
      simulateDonation(
        buildEvent({ identity: donor, pathParameters: { donationId: String(donationId) }, body: { action } })
      );

    expect((await simulate(confirmable.donationId, "CONFIRMAR")).statusCode).toBe(401);
    expect((await readDonation(String(confirmable.donationId)))?.status).toBe("PENDIENTE_SIMULACION");
    expect((await simulate(rejectable.donationId, "RECHAZAR")).statusCode).toBe(200);
  });

  it("never calls the identity provider for non-sensitive actions", async () => {
    await startUserInfo({ kind: "status", status: 401 });

    const created = await createProject(
      buildEvent({
        identity: identityFor("GESTOR"),
        body: {
          title: "Agua para Chivay",
          description: "Instalar un sistema de agua potable",
          goalAmountCents: 100_000,
        },
      })
    );
    const history = await getMyDonations(buildEvent({ identity: identityFor("DONANTE") }));

    expect(created.statusCode).toBe(201);
    expect(history.statusCode).toBe(200);
    expect(requestCount).toBe(0);
  });
});

describe("role revalidation on sensitive actions: a token keeps the groups it was issued with", () => {
  beforeEach(clearAllTables);
  afterEach(async () => {
    await stopServerCompletely();
    replaceGroupsLookup(async (principal) => principal.groups);
  });

  it("refuses a manager who was removed from GESTOR after the token was issued, and audits why", async () => {
    await startUserInfo({ kind: "status", status: 200 }); // the session itself is still valid
    replaceGroupsLookup(async () => ["DONANTE"]); // the provider no longer lists GESTOR

    const response = await publishProject(await draftPublishEvent());
    const [event] = await readAllAuditEvents();

    expect(response.statusCode).toBe(403);
    expect(event).toMatchObject({ outcome: "DENIED", reason: "ROLE_REVOKED", action: "PublishProject" });
  });

  it("refuses an auditor whose role was removed, even though the token still says AUDITOR", async () => {
    await startUserInfo({ kind: "status", status: 200 });
    replaceGroupsLookup(async () => []);

    const response = await getAuditEvents(buildEvent({ identity: identityFor("AUDITOR") }));

    expect(response.statusCode).toBe(403);
  });

  it("refuses when the groups cannot be read (fail closed)", async () => {
    await startUserInfo({ kind: "status", status: 200 });
    replaceGroupsLookup(async () => undefined);

    const response = await getAuditEvents(buildEvent({ identity: identityFor("AUDITOR") }));

    expect(response.statusCode).toBe(403);
  });

  it("refuses when the person gained another role after the token was issued and the auditor role stops being exclusive", async () => {
    await startUserInfo({ kind: "status", status: 200 });
    replaceGroupsLookup(async () => ["AUDITOR", "DONANTE"]);

    const response = await getAuditEvents(buildEvent({ identity: identityFor("AUDITOR") }));

    expect(response.statusCode).toBe(403);
  });

  it("lets the action through while the provider still lists the role", async () => {
    await startUserInfo({ kind: "status", status: 200 });
    replaceGroupsLookup(async () => ["AUDITOR"]);

    const response = await getAuditEvents(buildEvent({ identity: identityFor("AUDITOR") }));

    expect(response.statusCode).toBe(200);
  });

  it("asks the provider for the groups only on sensitive actions", async () => {
    let lookups = 0;
    replaceGroupsLookup(async (principal) => {
      lookups += 1;
      return principal.groups;
    });

    await getMyDonations(buildEvent({ identity: identityFor("DONANTE") }));
    await createProject(
      buildEvent({
        identity: identityFor("GESTOR"),
        body: {
          title: "Agua para Chivay",
          description: "Instalar un sistema de agua potable",
          goalAmountCents: 100_000,
        },
      })
    );

    expect(lookups).toBe(0);
  });
});

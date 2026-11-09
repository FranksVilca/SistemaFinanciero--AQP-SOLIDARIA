import { randomUUID } from "node:crypto";
import {
  BatchWriteItemCommand,
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";
import { buildEvent, identityFor } from "../integration/helpers/events.js";
import {
  clearAllTables,
  readAllAuditEvents,
  readProject,
  seedDonation,
  seedProject,
} from "../integration/helpers/seed.js";
import { FLOCI_ENV } from "./flociEnv.js";
import { credentialsOf, runHandlerAs } from "./helpers/runHandler.js";

/**
 * T10: every function runs with an IAM user that holds exactly the inline policy of its role in
 * infra/template.yaml, and Floci enforces IAM. The first block proves each handler still works with so few
 * permissions; the second proves that everything outside the contract is answered with AccessDenied.
 */

const ACCESS_DENIED = "AccessDeniedException";

type TableKey = "projects" | "donations" | "idempotency" | "audit";

const TABLES: Record<TableKey, { name: string; key: (suffix: string) => Record<string, { S: string }> }> = {
  projects: { name: FLOCI_ENV.PROJECTS_TABLE, key: (id) => ({ projectId: { S: id } }) },
  donations: { name: FLOCI_ENV.DONATIONS_TABLE, key: (id) => ({ donationId: { S: id } }) },
  idempotency: { name: FLOCI_ENV.IDEMPOTENCY_TABLE, key: (id) => ({ pk: { S: id } }) },
  audit: {
    name: FLOCI_ENV.AUDIT_TABLE,
    key: (id) => ({ auditDay: { S: "2026-01-01" }, "timestamp#eventId": { S: `2026-01-01T00:00:00.000Z#${id}` } }),
  },
};

// Writes each function may perform (the contract in specs/002-zta-hardening/contracts/iam-permissions-matrix.md).
const MAY_PUT: Record<string, TableKey[]> = {
  "projects/listProjects.handler": [],
  "projects/getProject.handler": [],
  "projects/getProjectStats.handler": [],
  "projects/createProject.handler": ["projects", "audit"],
  "projects/publishProject.handler": ["audit"],
  "donations/createDonation.handler": ["donations", "idempotency", "audit"],
  "donations/simulateDonation.handler": ["audit"],
  "donations/getMyDonations.handler": ["audit"],
  "audit/getAuditEvents.handler": ["audit"],
};
const MAY_UPDATE: Record<string, TableKey[]> = {
  "projects/publishProject.handler": ["projects"],
  "donations/createDonation.handler": ["idempotency"],
  "donations/simulateDonation.handler": ["projects", "donations"],
};

function clientAs(handlerRef: string): DynamoDBClient {
  const config: DynamoDBClientConfig = {
    region: FLOCI_ENV.AWS_REGION,
    endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
    credentials: credentialsOf(handlerRef),
  };
  return new DynamoDBClient(config);
}

async function errorNameOf(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return (error as Error).name;
  }
}

describe("each handler works with the minimal permissions of its own role", () => {
  beforeEach(clearAllTables);

  it("listProjects", async () => {
    await seedProject();
    expect((await runHandlerAs("projects/listProjects.handler", buildEvent())).statusCode).toBe(200);
  });

  it("getProject and getProjectStats", async () => {
    const project = await seedProject();
    const pathParameters = { projectId: String(project.projectId) };

    expect((await runHandlerAs("projects/getProject.handler", buildEvent({ pathParameters }))).statusCode).toBe(200);
    expect((await runHandlerAs("projects/getProjectStats.handler", buildEvent({ pathParameters }))).statusCode).toBe(
      200
    );
  });

  it("createProject writes the project and its audit event", async () => {
    const event = buildEvent({
      identity: identityFor("GESTOR"),
      body: { title: "Agua para Chivay", description: "Instalar un sistema de agua potable", goalAmountCents: 100_000 },
    });

    expect((await runHandlerAs("projects/createProject.handler", event)).statusCode).toBe(201);
    expect((await readAllAuditEvents()).map((auditEvent) => auditEvent.eventType)).toEqual(["PROJECT_CREATED"]);
  });

  it("publishProject updates the project and writes its audit event", async () => {
    const draft = await seedProject({ status: "BORRADOR" });
    const event = buildEvent({
      identity: identityFor("GESTOR"),
      pathParameters: { projectId: String(draft.projectId) },
    });

    expect((await runHandlerAs("projects/publishProject.handler", event)).statusCode).toBe(200);
    expect((await readProject(String(draft.projectId)))?.status).toBe("PUBLICADO");
    expect(await readAllAuditEvents()).toHaveLength(1);
  });

  it("createDonation runs its transaction over donations and idempotency", async () => {
    const project = await seedProject();
    const event = buildEvent({
      identity: identityFor("DONANTE"),
      headers: { "Idempotency-Key": randomUUID() },
      body: { projectId: String(project.projectId), amountCents: 5_000 },
    });

    expect((await runHandlerAs("donations/createDonation.handler", event)).statusCode).toBe(201);
    expect((await readAllAuditEvents()).map((auditEvent) => auditEvent.eventType)).toEqual(["DONATION_CREATED"]);
  });

  it("simulateDonation confirms a donation with its transaction over donations and projects", async () => {
    const donor = identityFor("DONANTE");
    const project = await seedProject();
    const donation = await seedDonation(donor.sub, String(project.projectId), { amountCents: 4_000 });
    const event = buildEvent({
      identity: donor,
      pathParameters: { donationId: String(donation.donationId) },
      body: { action: "CONFIRMAR" },
    });

    expect((await runHandlerAs("donations/simulateDonation.handler", event)).statusCode).toBe(200);
    expect((await readProject(String(project.projectId)))?.confirmedAmountCents).toBe(4_000);
  });

  it("getMyDonations reads the index and records a denial when the role is wrong", async () => {
    const donor = identityFor("DONANTE");
    const project = await seedProject();
    await seedDonation(donor.sub, String(project.projectId));

    expect((await runHandlerAs("donations/getMyDonations.handler", buildEvent({ identity: donor }))).statusCode).toBe(
      200
    );
    expect(
      (await runHandlerAs("donations/getMyDonations.handler", buildEvent({ identity: identityFor("GESTOR") })))
        .statusCode
    ).toBe(403);
    expect((await readAllAuditEvents()).map((auditEvent) => auditEvent.outcome)).toEqual(["DENIED"]);
  });

  it("getAuditEvents queries the audit table", async () => {
    const response = await runHandlerAs(
      "audit/getAuditEvents.handler",
      buildEvent({ identity: identityFor("AUDITOR") })
    );

    expect(response.statusCode).toBe(200);
  });
});

describe("everything outside the contract of a role is denied (T10)", () => {
  const handlers = Object.keys(MAY_PUT);
  const tables = Object.keys(TABLES) as TableKey[];
  const cases = handlers.flatMap((handlerRef) => tables.map((table) => [handlerRef, table] as const));

  it.each(cases)("%s on the %s table", async (handlerRef, table) => {
    const client = clientAs(handlerRef);
    const { name, key } = TABLES[table];
    const id = randomUUID();

    const put = await errorNameOf(client.send(new PutItemCommand({ TableName: name, Item: key(id) })));
    const update = await errorNameOf(
      client.send(
        new UpdateItemCommand({
          TableName: name,
          Key: key(id),
          UpdateExpression: "SET touchedAt = :now",
          ExpressionAttributeValues: { ":now": { S: "now" } },
        })
      )
    );
    const remove = await errorNameOf(client.send(new DeleteItemCommand({ TableName: name, Key: key(id) })));
    const batchRemove = await errorNameOf(
      client.send(new BatchWriteItemCommand({ RequestItems: { [name]: [{ DeleteRequest: { Key: key(id) } }] } }))
    );
    const scan = await errorNameOf(client.send(new ScanCommand({ TableName: name })));

    // Never allowed anywhere: deleting, batch writing and scanning.
    expect(remove, "DeleteItem").toBe(ACCESS_DENIED);
    expect(batchRemove, "BatchWriteItem").toBe(ACCESS_DENIED);
    expect(scan, "Scan").toBe(ACCESS_DENIED);
    // Writes are allowed only where the contract says so.
    expect(put === ACCESS_DENIED, "PutItem denied").toBe(!MAY_PUT[handlerRef].includes(table));
    expect(update === ACCESS_DENIED, "UpdateItem denied").toBe(!(MAY_UPDATE[handlerRef] ?? []).includes(table));
  });
});

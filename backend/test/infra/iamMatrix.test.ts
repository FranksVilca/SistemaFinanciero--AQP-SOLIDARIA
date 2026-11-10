import { describe, expect, it } from "vitest";
import {
  STAGES,
  eventsOf,
  handlerOf,
  lambdaFunctions,
  loadTemplate,
  policiesOf,
  type Json,
  type JsonObject,
} from "./helpers/loadTemplate.js";

// Mirrors specs/002-zta-hardening/contracts/iam-permissions-matrix.md (R = GetItem/Query, P = PutItem, U = UpdateItem).
const READ = ["dynamodb:GetItem", "dynamodb:Query"];
const PUT = ["dynamodb:PutItem"];
const UPDATE = ["dynamodb:UpdateItem"];

type Table = "ProjectsTable" | "DonationsTable" | "IdempotencyTable" | "AuditTable";

const MATRIX: Record<string, Partial<Record<Table, string[]>>> = {
  "projects/listProjects.handler": { ProjectsTable: READ },
  "projects/getProject.handler": { ProjectsTable: READ },
  "projects/getProjectStats.handler": { ProjectsTable: READ },
  "projects/createProject.handler": { ProjectsTable: PUT, AuditTable: PUT },
  "projects/publishProject.handler": { ProjectsTable: UPDATE, AuditTable: PUT },
  // Reads the project to compare its owner, then updates its status.
  "projects/closeProject.handler": { ProjectsTable: [...READ, ...UPDATE], AuditTable: PUT },
  "donations/createDonation.handler": {
    ProjectsTable: READ,
    DonationsTable: [...PUT, ...READ],
    // UpdateItem only for the velocity counters, which live in the idempotency table.
    IdempotencyTable: [...PUT, ...READ, ...UPDATE],
    AuditTable: PUT,
  },
  "donations/simulateDonation.handler": { ProjectsTable: UPDATE, DonationsTable: [...READ, ...UPDATE], AuditTable: PUT },
  "donations/getMyDonations.handler": { DonationsTable: READ, AuditTable: PUT },
  "audit/getAuditEvents.handler": { AuditTable: [...READ, ...PUT] },
  // Review of the donations held by the velocity controls.
  "reviews/listReviews.handler": { DonationsTable: READ, AuditTable: PUT },
  "reviews/reviewDonation.handler": { ProjectsTable: READ, DonationsTable: [...READ, ...UPDATE], AuditTable: PUT },
  // Administration of roles: it talks to Cognito (see roleRevalidation.test.ts) and only records its denials.
  "admin/listUsers.handler": { AuditTable: PUT },
  "admin/changeUserRole.handler": { AuditTable: PUT },
  // Scheduled job: no route.
  "reviews/expireReviews.handler": { DonationsTable: [...READ, ...UPDATE], AuditTable: PUT },
  // Cognito trigger: records that it gave the donor role.
  "identity/addDonorToGroup.handler": { AuditTable: PUT },
};

const COGNITO_TRIGGERS = ["identity/addDonorToGroup.handler"];
const SCHEDULED_JOBS = ["reviews/expireReviews.handler"];

const PUBLIC_HANDLERS = ["projects/listProjects.handler", "projects/getProject.handler", "projects/getProjectStats.handler"];
const FORBIDDEN_ACTION = /Delete|BatchWrite|Scan|^dynamodb:\*$|^\*$/;

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource: Json;
}

function statementsOf(definition: JsonObject): Statement[] {
  return policiesOf(definition).flatMap((policy) => {
    const document = policy as JsonObject;
    if (!("Statement" in document)) throw new Error(`Only inline statements are allowed, found: ${JSON.stringify(policy)}`);
    return document.Statement as unknown as Statement[];
  });
}

const actionsOf = (statement: Statement): string[] => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]);

function tablesReferencedBy(resource: Json): Table[] {
  const text = JSON.stringify(resource);
  return (["ProjectsTable", "DonationsTable", "IdempotencyTable", "AuditTable"] as const).filter((table) => text.includes(table));
}

describe.each(STAGES)("least-privilege IAM in stage %s", (stage) => {
  const template = loadTemplate(stage);
  const functions = lambdaFunctions(template);

  it("covers every function with an entry of the matrix", () => {
    expect(functions.map(([, definition]) => handlerOf(definition)).sort()).toEqual(
      Object.keys(MATRIX).filter((handler) => stage === "academic" || !handler.includes("simulateDonation")).sort()
    );
  });

  it("only exposes the simulation function in the academic stage", () => {
    const hasSimulation = functions.some(([, definition]) => handlerOf(definition) === "donations/simulateDonation.handler");
    expect(hasSimulation).toBe(stage === "academic");
  });

  describe.each(functions.map(([name, definition]) => [name, definition] as const))("%s", (_name, definition) => {
    const handler = handlerOf(definition);
    const statements = statementsOf(definition);

    it("uses only explicit Allow statements without forbidden actions or wildcard resources", () => {
      for (const statement of statements) {
        expect(statement.Effect).toBe("Allow");
        for (const action of actionsOf(statement)) expect(action).not.toMatch(FORBIDDEN_ACTION);
        expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
      }
    });

    it("grants exactly the tables and actions of the matrix", () => {
      const granted: Partial<Record<Table, Set<string>>> = {};
      for (const statement of statements) {
        for (const table of tablesReferencedBy(statement.Resource)) {
          granted[table] = new Set([...(granted[table] ?? []), ...actionsOf(statement)]);
        }
      }

      const allowed = MATRIX[handler];
      expect(Object.keys(granted).sort()).toEqual(Object.keys(allowed).sort());
      for (const [table, actions] of Object.entries(granted)) {
        for (const action of actions) expect(allowed[table as Table], `${handler} on ${table}`).toContain(action);
      }
    });

    it("never gives the audit table more than PutItem (plus Query for the audit reader)", () => {
      const auditActions = statements
        .filter((statement) => tablesReferencedBy(statement.Resource).includes("AuditTable"))
        .flatMap(actionsOf);
      const allowedOnAudit = handler === "audit/getAuditEvents.handler" ? ["dynamodb:PutItem", "dynamodb:Query"] : ["dynamodb:PutItem"];

      for (const action of auditActions) expect(allowedOnAudit).toContain(action);
    });
  });

  it("gives the public functions no access to the audit table", () => {
    for (const [, definition] of functions.filter(([, candidate]) => PUBLIC_HANDLERS.includes(handlerOf(candidate)))) {
      expect(JSON.stringify(statementsOf(definition))).not.toContain("AuditTable");
    }
  });

  it("declares one route per function and no shared policy resources", () => {
    for (const [, definition] of functions) {
      // An API function has one route; a Cognito trigger is called by Cognito and has none; a scheduled job has its
      // schedule and no route.
      const handler = handlerOf(definition);
      const events = eventsOf(definition);
      expect(events.length).toBe(COGNITO_TRIGGERS.includes(handler) ? 0 : 1);
      for (const [, event] of events) expect(event.Type).toBe(SCHEDULED_JOBS.includes(handler) ? "Schedule" : "HttpApi");
    }
    expect(Object.values(template.resources).filter((resource) => resource.Type === "AWS::IAM::ManagedPolicy")).toHaveLength(0);
  });
});

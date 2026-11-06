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
    PutCommand: class MockPutCommand {
      constructor(public input: unknown) {}
    },
    UpdateCommand: class MockUpdateCommand {
      constructor(public input: unknown) {}
    },
    GetCommand: class MockGetCommand {
      constructor(public input: unknown) {}
    },
  };
});

import { docClient } from "../src/shared/dynamo.js";
import { handler as createProjectHandler } from "../src/projects/createProject.js";
import { handler as publishProjectHandler } from "../src/projects/publishProject.js";
import { handler as getProjectStatsHandler } from "../src/projects/getProjectStats.js";

describe("User Story 3 - Project Lifecycle Management (HU-08, HU-09, T03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createProject", () => {
    it("T03: should return HTTP 403 Forbidden when a DONANTE attempts to create a project", async () => {
      const event = {
        body: JSON.stringify({
          title: "Intento de Proyecto",
          description: "Descripción válida con más de 10 caracteres",
          goalAmountCents: 500000,
        }),
        requestContext: {
          requestId: "req-t03",
          authorizer: {
            jwt: {
              claims: {
                sub: "donor-user-1",
                "cognito:groups": '["DONANTE"]',
              },
            },
          },
        },
      };

      const response = await createProjectHandler(event as any);
      expect(response.statusCode).toBe(403);
    });

    it("should return HTTP 201 Created and initial BORRADOR status when created by GESTOR", async () => {
      (docClient.send as any).mockResolvedValueOnce({}); // PutCommand for Project
      (docClient.send as any).mockResolvedValueOnce({}); // PutCommand for AuditEvent

      const event = {
        body: JSON.stringify({
          title: "Salud Comunitaria Cerro Colorado",
          description: "Jornadas médicas y preventivas",
          goalAmountCents: 1000000,
        }),
        requestContext: {
          requestId: "req-create-gestor",
          authorizer: {
            jwt: {
              claims: {
                sub: "gestor-user-1",
                "cognito:groups": '["GESTOR"]',
              },
            },
          },
        },
      };

      const response = await createProjectHandler(event as any);
      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.title).toBe("Salud Comunitaria Cerro Colorado");
      expect(body.status).toBe("BORRADOR");
      expect(body.confirmedAmountCents).toBe(0);
      expect(body.currency).toBe("PEN");
    });

    it("should return HTTP 400 when body fails Zod schema validation", async () => {
      const event = {
        body: JSON.stringify({
          title: "No", // < 3 chars
          description: "Corta", // < 10 chars
          goalAmountCents: -50,
        }),
        requestContext: {
          requestId: "req-bad-input",
          authorizer: {
            jwt: {
              claims: {
                sub: "gestor-user-1",
                "cognito:groups": '["GESTOR"]',
              },
            },
          },
        },
      };

      const response = await createProjectHandler(event as any);
      expect(response.statusCode).toBe(400);
    });
  });

  describe("publishProject", () => {
    it("should return HTTP 200 and PUBLICADO status when GESTOR publishes a draft", async () => {
      (docClient.send as any).mockResolvedValueOnce({
        Attributes: {
          projectId: "proj-draft-1",
          title: "Proyecto a publicar",
          status: "PUBLICADO",
          confirmedAmountCents: 0,
        },
      });

      const event = {
        pathParameters: { projectId: "proj-draft-1" },
        requestContext: {
          requestId: "req-publish",
          authorizer: {
            jwt: {
              claims: {
                sub: "gestor-user-1",
                "cognito:groups": '["GESTOR"]',
              },
            },
          },
        },
      };

      const response = await publishProjectHandler(event as any);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("PUBLICADO");
    });

    it("should return HTTP 409 Conflict if project is already published or conditional check fails", async () => {
      const conditionError = new Error("ConditionalCheckFailedException");
      conditionError.name = "ConditionalCheckFailedException";
      (docClient.send as any).mockRejectedValueOnce(conditionError);

      const event = {
        pathParameters: { projectId: "proj-already-published" },
        requestContext: {
          requestId: "req-pub-conflict",
          authorizer: {
            jwt: {
              claims: {
                sub: "gestor-user-1",
                "cognito:groups": '["GESTOR"]',
              },
            },
          },
        },
      };

      const response = await publishProjectHandler(event as any);
      expect(response.statusCode).toBe(409);
    });
  });

  describe("getProjectStats", () => {
    it("should return HTTP 200 with verified aggregates and percentage (HU-09)", async () => {
      (docClient.send as any).mockResolvedValueOnce({
        Item: {
          projectId: "proj-stats-1",
          goalAmountCents: 100000,
          confirmedAmountCents: 25000,
          currency: "PEN",
          status: "PUBLICADO",
        },
      });

      const event = {
        pathParameters: { projectId: "proj-stats-1" },
        requestContext: { requestId: "req-stats" },
      };

      const response = await getProjectStatsHandler(event as any);
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.projectId).toBe("proj-stats-1");
      expect(body.goalAmountCents).toBe(100000);
      expect(body.confirmedAmountCents).toBe(25000);
      expect(body.progressPercentage).toBe(25);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DynamoDB client before importing handlers
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
    QueryCommand: class MockQueryCommand {
      constructor(public input: unknown) {}
    },
    GetCommand: class MockGetCommand {
      constructor(public input: unknown) {}
    },
    PutCommand: class MockPutCommand {
      constructor(public input: unknown) {}
    },
    UpdateCommand: class MockUpdateCommand {
      constructor(public input: unknown) {}
    },
  };
});

import { docClient } from "../src/shared/dynamo.js";
import { handler as listProjectsHandler } from "../src/projects/listProjects.js";
import { handler as getProjectHandler } from "../src/projects/getProject.js";

describe("User Story 1 - Public Project Discovery (HU-01, HU-02, T01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listProjects", () => {
    it("should return HTTP 200 with only PUBLICADO projects and exclude BORRADOR (CA-01.1, CA-01.2, T01)", async () => {
      const mockItems = [
        {
          projectId: "proj-1",
          title: "Comedor Comunitario Arequipa",
          description: "Apoyo a comedores populares en distritos vulnerables",
          goalAmountCents: 500000,
          confirmedAmountCents: 150000,
          currency: "PEN",
          status: "PUBLICADO",
          createdAt: "2026-11-01T10:00:00Z",
          updatedAt: "2026-11-01T10:00:00Z",
        },
      ];

      (docClient.send as any).mockResolvedValueOnce({ Items: mockItems });

      const event = {
        requestContext: { requestId: "req-t01-list" },
      };

      const response = await listProjectsHandler(event as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(1);
      expect(body[0].title).toBe("Comedor Comunitario Arequipa");
      expect(body[0].status).toBe("PUBLICADO");
      expect(body[0].confirmedAmountCents).toBe(150000);
      // Verify no donor PII
      expect(body[0].donorSub).toBeUndefined();
    });

    it("should return HTTP 200 with empty array when no projects are published (CA-01.3)", async () => {
      (docClient.send as any).mockResolvedValueOnce({ Items: [] });

      const event = {
        requestContext: { requestId: "req-t01-empty" },
      };

      const response = await listProjectsHandler(event as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(0);
    });
  });

  describe("getProject", () => {
    it("should return HTTP 200 with project details for an existing PUBLICADO project (CA-02.1)", async () => {
      const mockProject = {
        projectId: "proj-123",
        title: "Educación Digital Cayma",
        description: "Equipamiento de aulas digitales",
        goalAmountCents: 300000,
        confirmedAmountCents: 85000,
        currency: "PEN",
        status: "PUBLICADO",
        createdAt: "2026-11-02T12:00:00Z",
        updatedAt: "2026-11-02T12:00:00Z",
      };

      (docClient.send as any).mockResolvedValueOnce({ Item: mockProject });

      const event = {
        pathParameters: { projectId: "proj-123" },
        requestContext: { requestId: "req-t02-get" },
      };

      const response = await getProjectHandler(event as any);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.projectId).toBe("proj-123");
      expect(body.status).toBe("PUBLICADO");
    });

    it("should return HTTP 404 if project is missing or in BORRADOR state (CA-02.2)", async () => {
      // Case 1: missing
      (docClient.send as any).mockResolvedValueOnce({ Item: undefined });

      const eventMissing = {
        pathParameters: { projectId: "proj-missing" },
        requestContext: { requestId: "req-t02-missing" },
      };

      const resMissing = await getProjectHandler(eventMissing as any);
      expect(resMissing.statusCode).toBe(404);

      // Case 2: exists but BORRADOR
      (docClient.send as any).mockResolvedValueOnce({
        Item: {
          projectId: "proj-draft",
          title: "Borrador Secreto",
          status: "BORRADOR",
        },
      });

      const eventDraft = {
        pathParameters: { projectId: "proj-draft" },
        requestContext: { requestId: "req-t02-draft" },
      };

      const resDraft = await getProjectHandler(eventDraft as any);
      expect(resDraft.statusCode).toBe(404);
      const body = JSON.parse(resDraft.body);
      expect(body.code).toBe("NOT_FOUND");
    });
  });
});

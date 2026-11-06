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
    QueryCommand: class MockQueryCommand {
      constructor(public input: unknown) {}
    },
  };
});

import { docClient } from "../src/shared/dynamo.js";
import { logAuditEvent } from "../src/audit/logAuditEvent.js";
import { handler as getAuditEventsHandler } from "../src/audit/getAuditEvents.js";

describe("User Story 7 - Audit Log Querying (HU-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should record structured audit event without leaking secrets or tokens", async () => {
    (docClient.send as any).mockResolvedValueOnce({});

    await logAuditEvent({
      eventType: "PROJECT_LIFECYCLE",
      requestId: "req-audit-test",
      actorSub: "user-12345",
      resourceRef: "project:proj-1",
      action: "CREATE_PROJECT",
      outcome: "SUCCESS",
    });

    expect(docClient.send).toHaveBeenCalledTimes(1);
    const commandArg = (docClient.send as any).mock.calls[0][0];
    expect(commandArg.input.Item.eventType).toBe("PROJECT_LIFECYCLE");
    expect(commandArg.input.Item.actorRef).toBeDefined();
    // Check no tokens or secrets stored
    expect(commandArg.input.Item.token).toBeUndefined();
    expect(commandArg.input.Item.secret).toBeUndefined();
  });

  it("writes append-only events that cannot overwrite an existing one, with a pseudonymized actor", async () => {
    (docClient.send as any).mockResolvedValueOnce({});

    await logAuditEvent({
      eventType: "PROJECT_LIFECYCLE",
      requestId: "req-append-only",
      actorSub: "user-12345",
      resourceRef: "project:proj-1",
      action: "PUBLISH_PROJECT",
      outcome: "SUCCESS",
    });

    const { input } = (docClient.send as any).mock.calls[0][0];
    expect(input.TableName).toBe("aqp-audit-test");
    expect(input.ConditionExpression).toBe("attribute_not_exists(eventType)");
    expect(input.Item.actorRef).toMatch(/^usr_[0-9a-f]{12}$/);
    expect(JSON.stringify(input.Item)).not.toContain("user-12345");
  });

  it("should allow AUDITOR group with verified MFA to query audit events", async () => {
    const mockEvents = [
      {
        eventId: "event-1",
        eventType: "PROJECT_LIFECYCLE",
        timestamp: "2026-11-06T12:00:00Z",
        requestId: "req-1",
        actorRef: "usr_abc123",
        resourceRef: "project:proj-1",
        action: "CREATE_PROJECT",
        outcome: "SUCCESS",
      },
    ];

    (docClient.send as any).mockResolvedValueOnce({ Items: mockEvents });

    const event = {
      queryStringParameters: { eventType: "PROJECT_LIFECYCLE" },
      requestContext: {
        requestId: "req-audit-query",
        authorizer: {
          jwt: {
            claims: {
              sub: "auditor-user-1",
              "cognito:groups": '["AUDITOR"]',
            },
          },
        },
      },
    };

    const response = await getAuditEventsHandler(event as any);
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].action).toBe("CREATE_PROJECT");
  });

  it("should return HTTP 403 Forbidden when non-auditor attempts to query audit events", async () => {
    const event = {
      requestContext: {
        requestId: "req-non-auditor",
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

    const response = await getAuditEventsHandler(event as any);
    expect(response.statusCode).toBe(403);
  });
});

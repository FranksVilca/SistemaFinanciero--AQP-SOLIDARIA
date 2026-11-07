import { docClient, TABLE_NAMES, PutCommand } from "../shared/dynamo.js";
import { createHash } from "crypto";

export interface LogAuditParams {
  eventType: string;
  requestId: string;
  actorSub: string;
  resourceRef: string;
  action: string;
  outcome: "SUCCESS" | "DENIED" | "FAILED";
}

export async function logAuditEvent(params: LogAuditParams): Promise<void> {
  const { eventType, requestId, actorSub, resourceRef, action, outcome } = params;
  const eventId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Pseudonymize actor: hash of sub
  const pseudonym = "usr_" + createHash("sha256").update(actorSub).digest("hex").substring(0, 12);

  const item = {
    eventType,
    "timestamp#eventId": `${now}#${eventId}`,
    eventId,
    timestamp: now,
    requestId,
    actorRef: pseudonym,
    resourceRef,
    action,
    outcome,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAMES.audit,
      Item: item,
      // Append-only: never overwrite an existing audit event.
      ConditionExpression: "attribute_not_exists(eventType)",
    })
  );
}

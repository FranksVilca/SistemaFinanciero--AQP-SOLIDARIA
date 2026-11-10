import { createHash, randomUUID } from "node:crypto";
import {
  ANONYMOUS_ACTOR,
  OPERATOR_ACTOR,
  SYSTEM_ACTOR,
  type AuditAction,
  type AuditEventType,
  type AuditOutcome,
} from "../shared/constants.js";
import { docClient, PutCommand, TABLE_NAMES } from "../shared/dynamo.js";

const PSEUDONYM_PREFIX = "usr_";
const PSEUDONYM_HEX_LENGTH = 12;
const UTC_DAY_LENGTH = "YYYY-MM-DD".length;

export interface AuditEventInput {
  eventType: AuditEventType;
  requestId: string;
  /** Raw identifier of the actor; it is pseudonymized here and never stored. */
  actorSub?: string;
  /** The system acted on its own (a scheduled job): recorded as SYSTEM_ACTOR instead of a person. */
  system?: boolean;
  /** An operator acted from the command line, outside the application: recorded as OPERATOR_ACTOR. */
  operator?: boolean;
  resourceRef: string;
  action: AuditAction;
  outcome: AuditOutcome;
  reason?: string;
  /** Numeric context of the decision (for example a total and its threshold); never personal data. */
  details?: Record<string, number>;
}

/**
 * Stable pseudonym of a user. The `sub` is a random UUID (122 bits), so its hash cannot be reversed by
 * guessing and no secret salt is needed.
 */
export function pseudonymizeActor(actorSub: string | undefined): string {
  if (!actorSub) return ANONYMOUS_ACTOR;
  return PSEUDONYM_PREFIX + createHash("sha256").update(actorSub).digest("hex").slice(0, PSEUDONYM_HEX_LENGTH);
}

function actorRefOf(input: AuditEventInput): string {
  if (input.system) return SYSTEM_ACTOR;
  if (input.operator) return OPERATOR_ACTOR;
  return pseudonymizeActor(input.actorSub);
}

/**
 * The only function that writes audit events. The table only accepts inserts: the condition prevents
 * overwriting an existing event and the IAM roles never grant update or delete.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  const eventId = randomUUID();
  const timestamp = new Date().toISOString();

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAMES.audit,
      Item: {
        auditDay: timestamp.slice(0, UTC_DAY_LENGTH),
        "timestamp#eventId": `${timestamp}#${eventId}`,
        eventId,
        timestamp,
        eventType: input.eventType,
        requestId: input.requestId,
        actorRef: actorRefOf(input),
        resourceRef: input.resourceRef,
        action: input.action,
        outcome: input.outcome,
        ...(input.reason && { reason: input.reason }),
        ...(input.details && { details: input.details }),
      },
      ConditionExpression: "attribute_not_exists(auditDay)",
    })
  );
}

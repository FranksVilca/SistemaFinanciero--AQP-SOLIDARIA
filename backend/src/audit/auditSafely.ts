import { logError } from "../shared/logger.js";
import { recordAuditEvent, type AuditEventInput } from "./recordAuditEvent.js";

/**
 * Like every audit write made by a handler: a failure is logged and never changes the answer of a change that already
 * happened (the same choice as the rest of the application).
 */
export async function auditSafely(input: AuditEventInput): Promise<void> {
  try {
    await recordAuditEvent(input);
  } catch (error) {
    logError("Audit event could not be written", error, { requestId: input.requestId, action: input.action });
  }
}

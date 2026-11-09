import { recordAuditEvent, type AuditEventInput } from "../audit/recordAuditEvent.js";
import { logError } from "../shared/logger.js";

/** Like every audit write, a failure is logged and never changes the outcome of the review that already happened. */
export async function auditReview(input: AuditEventInput): Promise<void> {
  try {
    await recordAuditEvent(input);
  } catch (error) {
    logError("Audit event could not be written", error, { requestId: input.requestId, action: input.action });
  }
}

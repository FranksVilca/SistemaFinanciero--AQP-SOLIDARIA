import { randomUUID } from "node:crypto";
import { recordAuditEvent } from "../audit/recordAuditEvent.js";
import { AUDIT_EVENT_TYPES, AUDIT_OUTCOME, ROLES, SYSTEM_ACTIONS } from "../shared/constants.js";
import { logError, logInfo } from "../shared/logger.js";
import { assignRole } from "./assignRole.js";

/** What Cognito sends to its post-confirmation trigger, and expects back unchanged. */
export interface PostConfirmationEvent {
  triggerSource: string;
  userPoolId: string;
  userName: string;
  request: { userAttributes: { sub?: string } };
}

// Only the confirmation of a new registration. Confirming a password reset also calls this trigger, and it must not give
// back a role that an administrator took away.
const NEW_REGISTRATION = "PostConfirmation_ConfirmSignUp";
const DONOR_RESOURCE = `role:${ROLES.donor}`;

/**
 * Cognito trigger, not an API route (so no withAuth): everyone who registers and confirms their email becomes a donor.
 * It grants this one role and no other; GESTOR and AUDITOR are granted by an administrator. Failing here is visible
 * (the registration answers with an error and the log says why) instead of leaving a person without a role unnoticed.
 */
export async function handler(
  event: PostConfirmationEvent,
  context?: { awsRequestId?: string }
): Promise<PostConfirmationEvent> {
  if (event.triggerSource !== NEW_REGISTRATION) return event;

  const requestId = context?.awsRequestId ?? randomUUID();
  const actorSub = event.request.userAttributes.sub;
  try {
    await assignRole(event.userPoolId, event.userName, ROLES.donor);
  } catch (error) {
    logError("The donor role could not be assigned to a new user", error, { requestId });
    throw error;
  }

  // A role is a privilege: giving it is recorded in the audit trail like any other change of access.
  await recordAuditEvent({
    eventType: AUDIT_EVENT_TYPES.roleAssigned,
    requestId,
    actorSub,
    resourceRef: DONOR_RESOURCE,
    action: SYSTEM_ACTIONS.assignInitialRole,
    outcome: AUDIT_OUTCOME.success,
  });
  logInfo("Donor role assigned to a new user", { requestId });
  return event;
}

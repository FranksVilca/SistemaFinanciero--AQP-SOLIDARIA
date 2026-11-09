import { pseudonymizeActor } from "../audit/recordAuditEvent.js";
import { requirePrincipal, withAuth } from "../authz/withAuth.js";
import { AUDIT_EVENT_TYPES, AUDIT_OUTCOME, AUTHZ_ACTIONS, DONATION_STATUS } from "../shared/constants.js";
import { docClient, GetCommand, TABLE_NAMES } from "../shared/dynamo.js";
import { ConflictError, NotFoundError, PolicyDenialError } from "../shared/errors.js";
import { logInfo } from "../shared/logger.js";
import { parseJsonBody, requirePathParameter } from "../shared/request.js";
import { buildSuccessResponse } from "../shared/response.js";
import { ReviewDonationSchema } from "../shared/schemas.js";
import { auditReview } from "./auditReview.js";
import { resolveReview, statusAfter } from "./resolveReview.js";

const ALREADY_RESOLVED = "La donación ya no está en revisión: otro revisor la resolvió o venció";

async function loadHeldDonation(donationId: string): Promise<Record<string, unknown>> {
  const { Item } = await docClient.send(
    new GetCommand({ TableName: TABLE_NAMES.donations, Key: { donationId }, ConsistentRead: true })
  );
  if (!Item) throw new NotFoundError("Donación no encontrada");
  return Item;
}

/** Four eyes: nobody decides on their own donation or on a donation to a project they created. */
async function assertNoConflictOfInterest(donation: Record<string, unknown>, reviewerSub: string): Promise<void> {
  if (donation.donorSub === reviewerSub) {
    throw new PolicyDenialError("CONFLICT_OF_INTEREST", "Acceso denegado: no puede revisar una donación propia");
  }
  const { Item: project } = await docClient.send(
    new GetCommand({ TableName: TABLE_NAMES.projects, Key: { projectId: donation.projectId } })
  );
  // A donation always names an existing project; if it cannot be read, nobody can prove there is no conflict.
  if (!project || project.createdBy === reviewerSub) {
    throw new PolicyDenialError(
      "CONFLICT_OF_INTEREST",
      "Acceso denegado: no puede revisar donaciones de un proyecto que usted creó"
    );
  }
}

export const handler = withAuth(
  async (context) => {
    const { event, requestId } = context;
    const reviewerSub = requirePrincipal(context).sub;
    const donationId = requirePathParameter(event, "donationId", "Identificador de donación no proporcionado");
    const { decision, motivo } = parseJsonBody(event, ReviewDonationSchema);

    const donation = await loadHeldDonation(donationId);
    await assertNoConflictOfInterest(donation, reviewerSub);
    if (donation.status !== DONATION_STATUS.underReview) throw new ConflictError(ALREADY_RESOLVED);

    const reviewedAt = new Date().toISOString();
    const resolved = await resolveReview({
      donationId,
      decision,
      motivo,
      reviewedBy: pseudonymizeActor(reviewerSub),
      reviewedAt,
    });
    if (!resolved) throw new ConflictError(ALREADY_RESOLVED);

    await auditReview({
      eventType: AUDIT_EVENT_TYPES.reviewDecision,
      requestId,
      actorSub: reviewerSub,
      resourceRef: `donation:${donationId}`,
      action: AUTHZ_ACTIONS.reviewDonation,
      outcome: AUDIT_OUTCOME.success,
      // The decision only: the motivo is free text written by a person and stays on the donation.
      reason: decision,
    });
    const status = statusAfter(decision);
    logInfo("Donation review decided", { requestId, donationId, decision });
    return buildSuccessResponse({
      donationId,
      projectId: donation.projectId,
      status,
      reviewDecision: decision,
      reviewedAt,
    });
  },
  { action: AUTHZ_ACTIONS.reviewDonation, resourceType: "Donation" }
);

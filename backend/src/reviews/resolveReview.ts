import { DONATION_STATUS } from "../shared/constants.js";
import { docClient, TABLE_NAMES, UpdateCommand } from "../shared/dynamo.js";
import { DYNAMO_ERROR, isDynamoError } from "../shared/dynamoErrors.js";
import type { ReviewDecision } from "../shared/schemas.js";

export interface ReviewResolution {
  donationId: string;
  decision: ReviewDecision;
  motivo: string;
  /** Pseudonymized reviewer (the same reference the audit trail uses), or the system actor for an expiry. */
  reviewedBy: string;
  reviewedAt: string;
}

const STATUS_AFTER: Record<ReviewDecision, string> = {
  APROBAR: DONATION_STATUS.pending,
  RECHAZAR: DONATION_STATUS.rejectedByReview,
};

export const statusAfter = (decision: ReviewDecision): string => STATUS_AFTER[decision];

/**
 * Moves a held donation out of EN_REVISION. The write only happens while the donation is still EN_REVISION, so two
 * decisions on the same donation (two reviewers, or a reviewer and the expiry job) can never both win. Returns false
 * when the condition failed: someone else already resolved it.
 */
export async function resolveReview(resolution: ReviewResolution): Promise<boolean> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAMES.donations,
        Key: { donationId: resolution.donationId },
        UpdateExpression:
          "SET #status = :newStatus, reviewDecision = :decision, reviewMotivo = :motivo, reviewedBy = :reviewedBy, reviewedAt = :now, updatedAt = :now",
        ConditionExpression: "attribute_exists(donationId) AND #status = :underReview",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":newStatus": statusAfter(resolution.decision),
          ":decision": resolution.decision,
          ":motivo": resolution.motivo,
          ":reviewedBy": resolution.reviewedBy,
          ":now": resolution.reviewedAt,
          ":underReview": DONATION_STATUS.underReview,
        },
      })
    );
    return true;
  } catch (error) {
    if (isDynamoError(error, DYNAMO_ERROR.conditionalCheckFailed)) return false;
    throw error;
  }
}

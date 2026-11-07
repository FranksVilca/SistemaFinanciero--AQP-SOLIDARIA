import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { withAuth } from "../authz/withAuth.js";
import type { ApiEvent } from "../shared/apiEvent.js";
import { AUTHZ_ACTIONS, DONATION_STATUS } from "../shared/constants.js";
import { docClient, GetCommand, TABLE_NAMES, TransactWriteCommand } from "../shared/dynamo.js";
import { DYNAMO_ERROR, isDynamoError } from "../shared/dynamoErrors.js";
import { ConflictError, NotFoundError } from "../shared/errors.js";
import { logInfo } from "../shared/logger.js";
import { parseJsonBody, requirePathParameter } from "../shared/request.js";
import { buildSuccessResponse } from "../shared/response.js";
import { SimulateDonationSchema, type SimulateDonationInput } from "../shared/schemas.js";

type Donation = Record<string, unknown> & { donationId: string; projectId: string; donorSub: string; status: string };
type TransactItems = NonNullable<TransactWriteCommandInput["TransactItems"]>;

function buildTransition(donation: Donation, action: SimulateDonationInput["action"], now: string): TransactItems {
  const isConfirmation = action === "CONFIRMAR";
  const transition: TransactItems = [
    {
      Update: {
        TableName: TABLE_NAMES.donations,
        Key: { donationId: donation.donationId },
        UpdateExpression: "SET #status = :newStatus, updatedAt = :now",
        ConditionExpression: "attribute_exists(donationId) AND #status = :pending AND donorSub = :sub",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":newStatus": isConfirmation ? DONATION_STATUS.confirmed : DONATION_STATUS.rejected,
          ":pending": DONATION_STATUS.pending,
          ":sub": donation.donorSub,
          ":now": now,
        },
      },
    },
  ];

  if (isConfirmation) {
    transition.push({
      Update: {
        TableName: TABLE_NAMES.projects,
        Key: { projectId: donation.projectId },
        UpdateExpression: "ADD confirmedAmountCents :amount SET updatedAt = :now",
        ConditionExpression: "attribute_exists(projectId)",
        ExpressionAttributeValues: { ":amount": donation.amountCents, ":now": now },
      },
    });
  }
  return transition;
}

/**
 * Confirming a donation is sensitive; rejecting it is not. A body that cannot be read is treated as a
 * confirmation so the stricter session check applies (fail closed); the handler then answers 400.
 */
function isConfirmationRequest(event: ApiEvent): boolean {
  if (!event.body) return true;
  try {
    const parsed: unknown = JSON.parse(event.body);
    return (parsed as { action?: unknown })?.action !== "RECHAZAR";
  } catch {
    return true;
  }
}

export const handler = withAuth<Donation>(
  async ({ event, requestId, resource: donation }) => {
    if (!donation) throw new NotFoundError("Donación no encontrada");
    const { action } = parseJsonBody(event, SimulateDonationSchema, "La acción debe ser CONFIRMAR o RECHAZAR");

    if (donation.status !== DONATION_STATUS.pending) {
      throw new ConflictError(`La donación ya se encuentra en estado terminal: ${donation.status}`);
    }

    const now = new Date().toISOString();
    try {
      await docClient.send(new TransactWriteCommand({ TransactItems: buildTransition(donation, action, now) }));
    } catch (error) {
      if (isDynamoError(error, DYNAMO_ERROR.transactionCanceled)) {
        throw new ConflictError("Transición inválida o donación ya confirmada/rechazada concurrentemente");
      }
      throw error;
    }

    const newStatus = action === "CONFIRMAR" ? DONATION_STATUS.confirmed : DONATION_STATUS.rejected;
    logInfo("Donation transitioned", { requestId, donationId: donation.donationId, newStatus });
    return buildSuccessResponse({ ...donation, status: newStatus, updatedAt: now });
  },
  {
    action: AUTHZ_ACTIONS.simulateDonation,
    resourceType: "Donation",
    sensitiveWhen: isConfirmationRequest,
    loadResource: async (event) => {
      const donationId = requirePathParameter(event, "donationId", "Identificador de donación no proporcionado");
      const { Item } = await docClient.send(new GetCommand({ TableName: TABLE_NAMES.donations, Key: { donationId } }));
      if (!Item) throw new NotFoundError("Donación no encontrada");
      return { resource: Item as Donation, ownerSub: Item.donorSub };
    },
  }
);

import {
  docClient,
  TABLE_NAMES,
  GetCommand,
  TransactWriteCommand,
} from "../shared/dynamo.js";
import { SimulateDonationSchema } from "../shared/schemas.js";
import { buildSuccessResponse, buildErrorResponse, ApiResponse } from "../shared/response.js";
import { extractAuthClaims, enforceAuthz } from "../authz/evaluateAuthz.js";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../shared/errors.js";
import { logInfo, logError } from "../shared/logger.js";

export async function handler(event: {
  pathParameters?: { donationId?: string };
  body?: string;
  requestContext?: {
    requestId?: string;
    authorizer?: {
      jwt?: {
        claims?: Record<string, unknown>;
      };
    };
  };
}): Promise<ApiResponse> {
  const requestId = event.requestContext?.requestId || `req-${Date.now()}`;
  const donationId = event.pathParameters?.donationId;

  logInfo("Iniciando simulación de donación", { requestId, donationId, action: "SimulateDonation" });

  try {
    const principal = extractAuthClaims(event);
    if (!principal) {
      throw new ForbiddenError("Identidad no provista");
    }

    if (!donationId) {
      throw new NotFoundError("Identificador de donación no proporcionado");
    }

    if (!event.body) {
      throw new ValidationError("Cuerpo de solicitud requerido");
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(event.body);
    } catch {
      throw new ValidationError("Formato JSON inválido");
    }

    const validation = SimulateDonationSchema.safeParse(parsedBody);
    if (!validation.success) {
      throw new ValidationError("La acción debe ser CONFIRMAR o RECHAZAR");
    }

    const { action } = validation.data;

    // Fetch existing donation
    const donationResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.donations,
        Key: { donationId },
      })
    );

    const donation = donationResult.Item;
    if (!donation) {
      throw new NotFoundError("Donación no encontrada");
    }

    // Zero Trust / BOLA Ownership Check
    await enforceAuthz({
      principal,
      action: "SimulateDonation",
      resourceType: "Donation",
      resourceOwnerSub: donation.donorSub,
    });

    // Invariant: Transition only from PENDIENTE_SIMULACION
    if (donation.status !== "PENDIENTE_SIMULACION") {
      throw new ConflictError(
        `La donación ya se encuentra en estado terminal: ${donation.status}`
      );
    }

    const now = new Date().toISOString();
    const newStatus =
      action === "CONFIRMAR" ? "CONFIRMADA_SIMULADA" : "RECHAZADA_SIMULADA";

    const transactItems: any[] = [
      {
        Update: {
          TableName: TABLE_NAMES.donations,
          Key: { donationId },
          UpdateExpression: "SET #status = :newStatus, updatedAt = :now",
          ConditionExpression:
            "attribute_exists(donationId) AND #status = :pending AND donorSub = :sub",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":newStatus": newStatus,
            ":pending": "PENDIENTE_SIMULACION",
            ":sub": principal.sub,
            ":now": now,
          },
        },
      },
    ];

    if (action === "CONFIRMAR") {
      transactItems.push({
        Update: {
          TableName: TABLE_NAMES.projects,
          Key: { projectId: donation.projectId },
          UpdateExpression: "SET updatedAt = :now ADD confirmedAmountCents :amount",
          ConditionExpression: "attribute_exists(projectId)",
          ExpressionAttributeValues: {
            ":amount": donation.amountCents,
            ":now": now,
          },
        },
      });
    }

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: transactItems,
        })
      );
    } catch (txErr: any) {
      if (
        txErr.name === "TransactionCanceledException" ||
        txErr.code === "TransactionCanceledException"
      ) {
        throw new ConflictError(
          "Transición inválida o donación ya confirmada/rechazada concurrentemente"
        );
      }
      throw txErr;
    }

    logInfo("Donación transicionada exitosamente", {
      requestId,
      donationId,
      newStatus,
      amountCents: donation.amountCents,
    });

    const updatedDonation = {
      ...donation,
      status: newStatus,
      updatedAt: now,
    };

    return buildSuccessResponse(updatedDonation, 200);
  } catch (err) {
    logError("Error al simular donación", err, { requestId, donationId });
    return buildErrorResponse(err, requestId);
  }
}

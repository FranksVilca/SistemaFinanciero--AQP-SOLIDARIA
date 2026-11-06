import {
  docClient,
  TABLE_NAMES,
  GetCommand,
  TransactWriteCommand,
} from "../shared/dynamo.js";
import { CreateDonationSchema, IdempotencyHeaderSchema } from "../shared/schemas.js";
import { buildSuccessResponse, buildErrorResponse, ApiResponse } from "../shared/response.js";
import { extractAuthClaims, enforceAuthz } from "../authz/evaluateAuthz.js";
import { ValidationError, NotFoundError, ConflictError } from "../shared/errors.js";
import { hashPayload } from "../shared/hash.js";
import { logInfo, logError } from "../shared/logger.js";

export async function handler(event: {
  headers?: Record<string, string | undefined>;
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
  logInfo("Iniciando creación de intención de donación", { requestId, action: "CreateDonation" });

  try {
    const principal = extractAuthClaims(event);
    await enforceAuthz({
      principal,
      action: "CreateDonation",
      resourceType: "Donation",
    });

    const donorSub = principal!.sub;

    // Extract and validate Idempotency-Key header (case-insensitive)
    const rawHeaders = event.headers || {};
    const idempotencyHeaderKey = Object.keys(rawHeaders).find(
      (h) => h.toLowerCase() === "idempotency-key"
    );
    const idempotencyKey = idempotencyHeaderKey ? rawHeaders[idempotencyHeaderKey] : undefined;

    if (!idempotencyKey) {
      throw new ValidationError("Cabecera Idempotency-Key (UUID) es obligatoria");
    }

    const headerValidation = IdempotencyHeaderSchema.safeParse(idempotencyKey);
    if (!headerValidation.success) {
      throw new ValidationError("Cabecera Idempotency-Key debe ser un UUID válido");
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

    const bodyValidation = CreateDonationSchema.safeParse(parsedBody);
    if (!bodyValidation.success) {
      const errorMsg = bodyValidation.error.errors.map((e) => e.message).join(", ");
      throw new ValidationError(errorMsg);
    }

    const { projectId, amountCents } = bodyValidation.data;

    // Verify Project exists and is in PUBLICADO state
    const projectResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.projects,
        Key: { projectId },
      })
    );

    const project = projectResult.Item;
    if (!project) {
      throw new NotFoundError("Proyecto no encontrado");
    }

    if (project.status !== "PUBLICADO") {
      throw new ConflictError("El proyecto no está disponible para donaciones (no PUBLICADO)");
    }

    const payloadHash = hashPayload({ projectId, amountCents });
    const idempotencyPk = `${donorSub}#createDonation#${idempotencyKey}`;
    const donationId = crypto.randomUUID();
    const now = new Date().toISOString();
    const ttlEpoch = Math.floor(Date.now() / 1000) + 86400; // 24 hours

    const newDonation = {
      donationId,
      projectId,
      donorSub,
      amountCents,
      currency: "PEN" as const,
      status: "PENDIENTE_SIMULACION" as const,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLE_NAMES.idempotency,
                Item: {
                  pk: idempotencyPk,
                  payloadHash,
                  donationId,
                  responseStatus: 201,
                  expiresAt: ttlEpoch,
                },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            {
              Put: {
                TableName: TABLE_NAMES.donations,
                Item: newDonation,
              },
            },
          ],
        })
      );

      logInfo("Intención de donación creada exitosamente", {
        requestId,
        donationId,
        donorSub,
        amountCents,
      });
      return buildSuccessResponse(newDonation, 201);
    } catch (txErr: any) {
      if (
        txErr.name === "TransactionCanceledException" ||
        txErr.code === "TransactionCanceledException"
      ) {
        logInfo("Transacción cancelada: verificando clave de idempotencia existente", {
          requestId,
          idempotencyPk,
        });

        // Inspect existing record
        const existingRecord = await docClient.send(
          new GetCommand({
            TableName: TABLE_NAMES.idempotency,
            Key: { pk: idempotencyPk },
            ConsistentRead: true,
          })
        );

        if (existingRecord.Item) {
          if (existingRecord.Item.payloadHash === payloadHash) {
            // Replay original response
            const existingDonation = await docClient.send(
              new GetCommand({
                TableName: TABLE_NAMES.donations,
                Key: { donationId: existingRecord.Item.donationId },
                ConsistentRead: true,
              })
            );

            logInfo("Respuesta idempotente rejugada", {
              requestId,
              donationId: existingRecord.Item.donationId,
            });
            return buildSuccessResponse(existingDonation.Item, 201);
          } else {
            // Reused key with altered payload
            throw new ConflictError(
              "La clave de idempotencia ya fue utilizada previamente con parámetros distintos"
            );
          }
        }
      }
      throw txErr;
    }
  } catch (err) {
    logError("Error al registrar intención de donación", err, { requestId });
    return buildErrorResponse(err, requestId);
  }
}

import { randomUUID } from "node:crypto";
import { requirePrincipal, withAuth } from "../authz/withAuth.js";
import { readHeader, type ApiEvent } from "../shared/apiEvent.js";
import {
  AUTHZ_ACTIONS,
  CURRENCY,
  DONATION_STATUS,
  IDEMPOTENCY_TTL_SECONDS,
  PROJECT_STATUS,
} from "../shared/constants.js";
import { docClient, GetCommand, TABLE_NAMES, TransactWriteCommand } from "../shared/dynamo.js";
import { DYNAMO_ERROR, isDynamoError } from "../shared/dynamoErrors.js";
import { ConflictError, NotFoundError, ValidationError } from "../shared/errors.js";
import { hashPayload } from "../shared/hash.js";
import { logInfo } from "../shared/logger.js";
import { parseJsonBody } from "../shared/request.js";
import { buildSuccessResponse, type ApiResponse } from "../shared/response.js";
import { CreateDonationSchema, IdempotencyHeaderSchema } from "../shared/schemas.js";

const IDEMPOTENCY_HEADER = "Idempotency-Key";
const CREATED = 201;

function readIdempotencyKey(event: ApiEvent): string {
  const rawKey = readHeader(event, IDEMPOTENCY_HEADER);
  if (!rawKey) throw new ValidationError("Cabecera Idempotency-Key (UUID) es obligatoria");
  if (!IdempotencyHeaderSchema.safeParse(rawKey).success) {
    throw new ValidationError("Cabecera Idempotency-Key debe ser un UUID válido");
  }
  return rawKey;
}

async function assertProjectIsPublished(projectId: string): Promise<void> {
  const { Item: project } = await docClient.send(
    new GetCommand({ TableName: TABLE_NAMES.projects, Key: { projectId } })
  );
  if (!project) throw new NotFoundError("Proyecto no encontrado");
  if (project.status !== PROJECT_STATUS.published) {
    throw new ConflictError("El proyecto no está disponible para donaciones (no PUBLICADO)");
  }
}

/** Answers a retried request: the original donation for the same payload, a conflict for a different one. */
async function replayIdempotentRequest(idempotencyPk: string, payloadHash: string): Promise<ApiResponse | undefined> {
  const { Item: record } = await docClient.send(
    new GetCommand({ TableName: TABLE_NAMES.idempotency, Key: { pk: idempotencyPk }, ConsistentRead: true })
  );
  if (!record) return undefined;

  if (record.payloadHash !== payloadHash) {
    throw new ConflictError("La clave de idempotencia ya fue utilizada previamente con parámetros distintos");
  }
  const { Item: donation } = await docClient.send(
    new GetCommand({ TableName: TABLE_NAMES.donations, Key: { donationId: record.donationId }, ConsistentRead: true })
  );
  return buildSuccessResponse(donation, CREATED);
}

export const handler = withAuth(
  async (context) => {
    const { event, requestId } = context;
    const donorSub = requirePrincipal(context).sub;
    const idempotencyKey = readIdempotencyKey(event);
    const { projectId, amountCents } = parseJsonBody(event, CreateDonationSchema);
    await assertProjectIsPublished(projectId);

    const payloadHash = hashPayload({ projectId, amountCents });
    const idempotencyPk = `${donorSub}#createDonation#${idempotencyKey}`;
    const now = new Date().toISOString();
    const donation = {
      donationId: randomUUID(),
      projectId,
      donorSub,
      amountCents,
      currency: CURRENCY,
      status: DONATION_STATUS.pending,
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
                  donationId: donation.donationId,
                  responseStatus: CREATED,
                  expiresAt: Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS,
                },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            { Put: { TableName: TABLE_NAMES.donations, Item: donation } },
          ],
        })
      );
      logInfo("Donation intent created", { requestId, donationId: donation.donationId });
      return buildSuccessResponse(donation, CREATED);
    } catch (error) {
      if (isDynamoError(error, DYNAMO_ERROR.transactionCanceled)) {
        const replay = await replayIdempotentRequest(idempotencyPk, payloadHash);
        if (replay) return replay;
      }
      throw error;
    }
  },
  { action: AUTHZ_ACTIONS.createDonation, resourceType: "Donation" }
);

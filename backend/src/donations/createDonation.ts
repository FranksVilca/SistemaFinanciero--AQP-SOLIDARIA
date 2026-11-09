import { randomUUID } from "node:crypto";
import { recordAuditEvent, type AuditEventInput } from "../audit/recordAuditEvent.js";
import { resolveResourceRef } from "../audit/resourceRef.js";
import { requirePrincipal, withAuth } from "../authz/withAuth.js";
import { readHeader, type ApiEvent } from "../shared/apiEvent.js";
import {
  AUDIT_EVENT_TYPES,
  AUDIT_OUTCOME,
  AUTHZ_ACTIONS,
  CURRENCY,
  DONATION_STATUS,
  IDEMPOTENCY_TTL_SECONDS,
  PROJECT_STATUS,
} from "../shared/constants.js";
import { docClient, GetCommand, TABLE_NAMES, TransactWriteCommand } from "../shared/dynamo.js";
import { DYNAMO_ERROR, isDynamoError } from "../shared/dynamoErrors.js";
import {
  ConflictError,
  NotFoundError,
  PolicyDenialError,
  TooManyRequestsError,
  ValidationError,
} from "../shared/errors.js";
import { hashPayload } from "../shared/hash.js";
import { logError, logInfo } from "../shared/logger.js";
import { parseJsonBody } from "../shared/request.js";
import { buildSuccessResponse, type ApiResponse } from "../shared/response.js";
import { CreateDonationSchema, IdempotencyHeaderSchema } from "../shared/schemas.js";
import {
  assessDonation,
  isMinuteQuotaExhausted,
  readHourlyWindow,
  readVelocityConfig,
  velocityTransactItems,
  velocityWindowsOf,
  type Assessment,
  type VelocityConfig,
} from "./velocity.js";

const IDEMPOTENCY_HEADER = "Idempotency-Key";
const CREATED = 201;
// Concurrent donations of one donor contend for the same hourly window; each round commits at least one of them.
const MAX_ATTEMPTS = 10;
const RETRY_BASE_DELAY_MS = 10;

function readIdempotencyKey(event: ApiEvent): string {
  const rawKey = readHeader(event, IDEMPOTENCY_HEADER);
  if (!rawKey) throw new ValidationError("Cabecera Idempotency-Key (UUID) es obligatoria");
  if (!IdempotencyHeaderSchema.safeParse(rawKey).success) {
    throw new ValidationError("Cabecera Idempotency-Key debe ser un UUID válido");
  }
  return rawKey;
}

async function assertProjectAcceptsDonationFrom(projectId: string, donorSub: string): Promise<void> {
  const { Item: project } = await docClient.send(
    new GetCommand({ TableName: TABLE_NAMES.projects, Key: { projectId } })
  );
  if (!project) throw new NotFoundError("Proyecto no encontrado");
  // Whoever manages a project must not raise its amount by donating to it.
  if (project.createdBy === donorSub) {
    throw new PolicyDenialError("CONFLICT_OF_INTEREST", "Acceso denegado: no puede donar a un proyecto que usted creó");
  }
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

interface DonationRequest {
  event: ApiEvent;
  requestId: string;
  donorSub: string;
  projectId: string;
  amountCents: number;
  idempotencyPk: string;
  payloadHash: string;
  config: VelocityConfig;
}

type Donation = Record<string, unknown> & { donationId: string };

/** Velocity events are written by the handler; like every audit write, a failure is logged and never changes the answer. */
async function auditVelocity(
  request: DonationRequest,
  input: Omit<AuditEventInput, "requestId" | "actorSub" | "action">
) {
  try {
    await recordAuditEvent({
      ...input,
      requestId: request.requestId,
      actorSub: request.donorSub,
      action: AUTHZ_ACTIONS.createDonation,
    });
  } catch (error) {
    logError("Audit event could not be written", error, {
      requestId: request.requestId,
      action: AUTHZ_ACTIONS.createDonation,
    });
  }
}

function buildDonation(request: DonationRequest, assessment: Assessment): Donation {
  const now = new Date().toISOString();
  return {
    donationId: randomUUID(),
    projectId: request.projectId,
    donorSub: request.donorSub,
    amountCents: request.amountCents,
    currency: CURRENCY,
    status: assessment.reasons.length > 0 ? DONATION_STATUS.underReview : DONATION_STATUS.pending,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * One attempt: read the hourly window, decide the status and write the idempotency record, the donation and both
 * velocity counters in a single transaction. Nothing is written unless everything is, so a replay or a rate-limited
 * request never touches the counters and never leaves a record behind.
 */
async function tryCreate(request: DonationRequest): Promise<{ donation: Donation; assessment: Assessment }> {
  const windows = velocityWindowsOf(request.donorSub, new Date());
  const hourly = await readHourlyWindow(windows.hourPk);
  const assessment = assessDonation(hourly, request.amountCents, request.config);
  const donation = buildDonation(request, assessment);
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAMES.idempotency,
            Item: {
              pk: request.idempotencyPk,
              payloadHash: request.payloadHash,
              donationId: donation.donationId,
              responseStatus: CREATED,
              expiresAt: Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        { Put: { TableName: TABLE_NAMES.donations, Item: donation } },
        ...velocityTransactItems(windows, hourly, assessment, request.config),
      ],
    })
  );
  return { donation, assessment };
}

/** After a cancelled transaction: a replay answers with the original donation, an exhausted quota with 429. */
async function resolveCancellation(request: DonationRequest): Promise<ApiResponse | undefined> {
  const replay = await replayIdempotentRequest(request.idempotencyPk, request.payloadHash);
  if (replay) return replay;
  const { minutePk } = velocityWindowsOf(request.donorSub, new Date());
  if (!(await isMinuteQuotaExhausted(minutePk, request.config))) return undefined; // contention: try again
  await auditVelocity(request, {
    eventType: AUDIT_EVENT_TYPES.donationRateLimited,
    resourceRef: resolveResourceRef(request.event),
    outcome: AUDIT_OUTCOME.denied,
    reason: "VELOCITY_PER_MINUTE",
    details: { limitPerMinute: request.config.maxPerMinute },
  });
  throw new TooManyRequestsError();
}

async function flagIfSuspicious(request: DonationRequest, donation: Donation, assessment: Assessment): Promise<void> {
  if (assessment.reasons.length === 0) return;
  await auditVelocity(request, {
    eventType: AUDIT_EVENT_TYPES.suspiciousVelocity,
    resourceRef: `donation:${donation.donationId}`,
    outcome: AUDIT_OUTCOME.success,
    reason: assessment.reasons.join(","),
    details: {
      hourlyTotalCents: assessment.totalCents,
      thresholdCents: request.config.reviewThresholdCents,
      nearMaxCount: assessment.nearMaxCount,
      structuringCount: request.config.structuringCount,
    },
  });
}

const backoff = (attempt: number) =>
  new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt * (1 + Math.random())));

async function createWithVelocityControls(request: DonationRequest): Promise<ApiResponse> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { donation, assessment } = await tryCreate(request);
      logInfo("Donation intent created", { requestId: request.requestId, donationId: donation.donationId });
      await flagIfSuspicious(request, donation, assessment);
      return buildSuccessResponse(donation, CREATED);
    } catch (error) {
      if (!isDynamoError(error, DYNAMO_ERROR.transactionCanceled)) throw error;
      const answer = await resolveCancellation(request);
      if (answer) return answer;
      await backoff(attempt);
    }
  }
  throw new ConflictError("Otras donaciones suyas se están procesando al mismo tiempo; intente nuevamente");
}

export const handler = withAuth(
  async (context) => {
    const { event, requestId } = context;
    const donorSub = requirePrincipal(context).sub;
    const idempotencyKey = readIdempotencyKey(event);
    const { projectId, amountCents } = parseJsonBody(event, CreateDonationSchema);
    await assertProjectAcceptsDonationFrom(projectId, donorSub);

    return createWithVelocityControls({
      event,
      requestId,
      donorSub,
      projectId,
      amountCents,
      idempotencyPk: `${donorSub}#createDonation#${idempotencyKey}`,
      payloadHash: hashPayload({ projectId, amountCents }),
      config: readVelocityConfig(),
    });
  },
  { action: AUTHZ_ACTIONS.createDonation, resourceType: "Donation" }
);

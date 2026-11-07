import { docClient, TABLE_NAMES, PutCommand } from "../shared/dynamo.js";
import { CreateProjectSchema } from "../shared/schemas.js";
import { buildSuccessResponse, buildErrorResponse, ApiResponse } from "../shared/response.js";
import { extractAuthClaims, enforceAuthz } from "../authz/evaluateAuthz.js";
import { ValidationError } from "../shared/errors.js";
import { logInfo, logError } from "../shared/logger.js";
import { logAuditEvent } from "../audit/logAuditEvent.js";

export async function handler(event: {
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
  logInfo("Iniciando creación de proyecto", { requestId, action: "CreateProject" });

  try {
    const principal = extractAuthClaims(event);
    await enforceAuthz({
      principal,
      action: "CreateProject",
      resourceType: "Project",
    });

    if (!event.body) {
      throw new ValidationError("Cuerpo de solicitud requerido");
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(event.body);
    } catch {
      throw new ValidationError("Formato JSON inválido");
    }

    const validationResult = CreateProjectSchema.safeParse(parsedBody);
    if (!validationResult.success) {
      const errorMsg = validationResult.error.errors.map((e) => e.message).join(", ");
      throw new ValidationError(errorMsg);
    }

    const { title, description, goalAmountCents } = validationResult.data;
    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();

    const newProject = {
      projectId,
      title,
      description,
      goalAmountCents,
      confirmedAmountCents: 0,
      currency: "PEN" as const,
      status: "BORRADOR" as const,
      createdAt: now,
      updatedAt: now,
    };

    // Save project
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAMES.projects,
        Item: newProject,
      })
    );

    // Save audit event (append-only, pseudonymized actor)
    await logAuditEvent({
      eventType: "PROJECT_LIFECYCLE",
      requestId,
      actorSub: principal?.sub || "unknown",
      resourceRef: `project:${projectId}`,
      action: "CREATE_PROJECT",
      outcome: "SUCCESS",
    });

    logInfo("Proyecto creado exitosamente en BORRADOR", {
      requestId,
      projectId,
      action: "CreateProject",
    });
    return buildSuccessResponse(newProject, 201);
  } catch (err) {
    logError("Error al crear proyecto", err, { requestId });
    return buildErrorResponse(err, requestId);
  }
}

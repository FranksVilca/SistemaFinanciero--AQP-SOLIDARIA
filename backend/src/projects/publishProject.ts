import { docClient, TABLE_NAMES, UpdateCommand, PutCommand } from "../shared/dynamo.js";
import { buildSuccessResponse, buildErrorResponse, ApiResponse } from "../shared/response.js";
import { extractAuthClaims, enforceAuthz } from "../authz/evaluateAuthz.js";
import { ConflictError, NotFoundError } from "../shared/errors.js";
import { logInfo, logError } from "../shared/logger.js";

export async function handler(event: {
  pathParameters?: { projectId?: string };
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
  const projectId = event.pathParameters?.projectId;

  logInfo("Iniciando publicación de proyecto", { requestId, projectId, action: "PublishProject" });

  try {
    const principal = extractAuthClaims(event);
    await enforceAuthz({
      principal,
      action: "PublishProject",
      resourceType: "Project",
    });

    if (!projectId) {
      throw new NotFoundError("Identificador de proyecto no proporcionado");
    }

    const now = new Date().toISOString();

    let result;
    try {
      result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAMES.projects,
          Key: { projectId },
          UpdateExpression: "SET #status = :published, updatedAt = :now",
          ConditionExpression: "attribute_exists(projectId) AND #status = :draft",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":published": "PUBLICADO",
            ":draft": "BORRADOR",
            ":now": now,
          },
          ReturnValues: "ALL_NEW",
        })
      );
    } catch (dbErr: any) {
      if (
        dbErr.name === "ConditionalCheckFailedException" ||
        dbErr.code === "ConditionalCheckFailedException"
      ) {
        throw new ConflictError(
          "El proyecto no existe en estado BORRADOR o ya ha sido publicado previamente"
        );
      }
      throw dbErr;
    }

    // Save audit event
    const eventId = crypto.randomUUID();
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAMES.audit,
        Item: {
          eventType: "PROJECT_LIFECYCLE",
          "timestamp#eventId": `${now}#${eventId}`,
          eventId,
          timestamp: now,
          requestId,
          actorRef: principal?.sub || "unknown",
          resourceRef: `project:${projectId}`,
          action: "PUBLISH_PROJECT",
          outcome: "SUCCESS",
        },
      })
    );

    logInfo("Proyecto publicado con éxito", { requestId, projectId });
    return buildSuccessResponse(result.Attributes, 200);
  } catch (err) {
    logError("Error al publicar proyecto", err, { requestId, projectId });
    return buildErrorResponse(err, requestId);
  }
}

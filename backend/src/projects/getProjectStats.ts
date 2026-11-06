import { docClient, TABLE_NAMES, GetCommand } from "../shared/dynamo.js";
import { buildSuccessResponse, buildErrorResponse, ApiResponse } from "../shared/response.js";
import { NotFoundError } from "../shared/errors.js";
import { logInfo, logError } from "../shared/logger.js";

export async function handler(event: {
  pathParameters?: { projectId?: string };
  requestContext?: { requestId?: string };
}): Promise<ApiResponse> {
  const requestId = event.requestContext?.requestId || `req-${Date.now()}`;
  const projectId = event.pathParameters?.projectId;

  logInfo("Consultando estadísticas de proyecto", { requestId, projectId, action: "GetStats" });

  try {
    if (!projectId) {
      throw new NotFoundError("Identificador de proyecto no proporcionado");
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAMES.projects,
        Key: { projectId },
      })
    );

    const project = result.Item;
    if (!project || project.status !== "PUBLICADO") {
      throw new NotFoundError("Proyecto no encontrado o no disponible");
    }

    const goal = project.goalAmountCents || 1;
    const confirmed = project.confirmedAmountCents || 0;
    const progressPercentage = Math.min(100, Math.round((confirmed / goal) * 100));

    const stats = {
      projectId,
      goalAmountCents: goal,
      confirmedAmountCents: confirmed,
      currency: "PEN",
      progressPercentage,
    };

    return buildSuccessResponse(stats, 200);
  } catch (err) {
    logError("Error al consultar estadísticas", err, { requestId, projectId });
    return buildErrorResponse(err, requestId);
  }
}

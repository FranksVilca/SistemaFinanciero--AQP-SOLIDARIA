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

  logInfo("Consultando detalle de proyecto", { requestId, projectId, action: "ViewProject" });

  try {
    if (!projectId) {
      throw new NotFoundError("Identificador de proyecto no proporcionado");
    }

    const command = new GetCommand({
      TableName: TABLE_NAMES.projects,
      Key: { projectId },
    });

    const result = await docClient.send(command);
    const project = result.Item;

    // Zero Trust / Confidentiality: if project does not exist or is in BORRADOR,
    // return 404 to unauthenticated/general visitors without revealing existence.
    if (!project || project.status !== "PUBLICADO") {
      throw new NotFoundError("Proyecto no encontrado o no disponible");
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { donorSub, ...safeProject } = project as any;
    return buildSuccessResponse(safeProject, 200);
  } catch (err) {
    logError("Error al consultar proyecto", err, { requestId, projectId });
    return buildErrorResponse(err, requestId);
  }
}

import { docClient, TABLE_NAMES, QueryCommand } from "../shared/dynamo.js";
import { buildSuccessResponse, buildErrorResponse, ApiResponse } from "../shared/response.js";
import { logInfo, logError } from "../shared/logger.js";

export async function handler(event: {
  requestContext?: { requestId?: string };
}): Promise<ApiResponse> {
  const requestId = event.requestContext?.requestId || `req-${Date.now()}`;
  logInfo("Listando proyectos publicados", { requestId, action: "ListProjects" });

  try {
    const command = new QueryCommand({
      TableName: TABLE_NAMES.projects,
      IndexName: "status-createdAt-index",
      KeyConditionExpression: "#status = :published",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":published": "PUBLICADO",
      },
      ScanIndexForward: false, // Descending by createdAt
    });

    const result = await docClient.send(command);
    const projects = result.Items || [];

    // Ensure no donor PII is exposed
    const safeProjects = projects.map((p) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { donorSub, ...safeData } = p as any;
      return safeData;
    });

    return buildSuccessResponse(safeProjects, 200);
  } catch (err) {
    logError("Error al listar proyectos", err, { requestId });
    return buildErrorResponse(err, requestId);
  }
}

import { docClient, TABLE_NAMES, QueryCommand } from "../shared/dynamo.js";
import { buildSuccessResponse, buildErrorResponse, ApiResponse } from "../shared/response.js";
import { extractAuthClaims, enforceAuthz } from "../authz/evaluateAuthz.js";
import { logInfo, logError } from "../shared/logger.js";

export async function handler(event: {
  queryStringParameters?: {
    eventType?: string;
    from?: string;
    to?: string;
  };
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
  logInfo("Consultando eventos de auditoría", { requestId, action: "ViewAudit" });

  try {
    const principal = extractAuthClaims(event);
    await enforceAuthz({
      principal,
      action: "ViewAudit",
      resourceType: "AuditEvent",
    });

    const eventType = event.queryStringParameters?.eventType || "PROJECT_LIFECYCLE";

    const command = new QueryCommand({
      TableName: TABLE_NAMES.audit,
      KeyConditionExpression: "eventType = :type",
      ExpressionAttributeValues: {
        ":type": eventType,
      },
      ScanIndexForward: false, // Descending by timestamp
      Limit: 50,
    });

    const result = await docClient.send(command);
    const events = result.Items || [];

    return buildSuccessResponse(events, 200);
  } catch (err) {
    logError("Error al consultar auditoría", err, { requestId });
    return buildErrorResponse(err, requestId);
  }
}

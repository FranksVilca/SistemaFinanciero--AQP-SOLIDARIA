import { docClient, TABLE_NAMES, QueryCommand } from "../shared/dynamo.js";
import { buildSuccessResponse, buildErrorResponse, ApiResponse } from "../shared/response.js";
import { extractAuthClaims, enforceAuthz } from "../authz/evaluateAuthz.js";
import { logInfo, logError } from "../shared/logger.js";

export async function handler(event: {
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
  logInfo("Consultando historial de donaciones del donante", { requestId, action: "ViewMyDonations" });

  try {
    const principal = extractAuthClaims(event);
    await enforceAuthz({
      principal,
      action: "CreateDonation", // Requires DONANTE role
      resourceType: "Donation",
    });

    const donorSub = principal!.sub;

    const command = new QueryCommand({
      TableName: TABLE_NAMES.donations,
      IndexName: "donorSub-createdAt-index",
      KeyConditionExpression: "donorSub = :sub",
      ExpressionAttributeValues: {
        ":sub": donorSub,
      },
      ScanIndexForward: false, // Descending by createdAt
    });

    const result = await docClient.send(command);
    const donations = result.Items || [];

    logInfo("Historial recuperado exitosamente", {
      requestId,
      donorSub,
      count: donations.length,
    });

    return buildSuccessResponse(donations, 200);
  } catch (err) {
    logError("Error al consultar historial", err, { requestId });
    return buildErrorResponse(err, requestId);
  }
}

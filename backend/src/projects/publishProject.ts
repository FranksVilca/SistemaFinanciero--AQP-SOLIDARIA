import { withAuth } from "../authz/withAuth.js";
import { AUTHZ_ACTIONS, PROJECT_STATUS } from "../shared/constants.js";
import { docClient, TABLE_NAMES, UpdateCommand } from "../shared/dynamo.js";
import { DYNAMO_ERROR, isDynamoError } from "../shared/dynamoErrors.js";
import { ConflictError } from "../shared/errors.js";
import { logInfo } from "../shared/logger.js";
import { requirePathParameter } from "../shared/request.js";
import { buildSuccessResponse } from "../shared/response.js";

export const handler = withAuth(
  async ({ event, requestId }) => {
    const projectId = requirePathParameter(event, "projectId", "Identificador de proyecto no proporcionado");

    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAMES.projects,
          Key: { projectId },
          UpdateExpression: "SET #status = :published, updatedAt = :now",
          ConditionExpression: "attribute_exists(projectId) AND #status = :draft",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":published": PROJECT_STATUS.published,
            ":draft": PROJECT_STATUS.draft,
            ":now": new Date().toISOString(),
          },
          ReturnValues: "ALL_NEW",
        })
      );

      logInfo("Project published", { requestId, projectId });
      return buildSuccessResponse(result.Attributes);
    } catch (error) {
      if (isDynamoError(error, DYNAMO_ERROR.conditionalCheckFailed)) {
        throw new ConflictError("El proyecto no existe en estado BORRADOR o ya ha sido publicado previamente");
      }
      throw error;
    }
  },
  { action: AUTHZ_ACTIONS.publishProject, resourceType: "Project" }
);

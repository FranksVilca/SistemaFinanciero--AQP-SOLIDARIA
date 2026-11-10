import { withAuth } from "../authz/withAuth.js";
import { AUTHZ_ACTIONS, PROJECT_STATUS } from "../shared/constants.js";
import { docClient, GetCommand, TABLE_NAMES, UpdateCommand } from "../shared/dynamo.js";
import { DYNAMO_ERROR, isDynamoError } from "../shared/dynamoErrors.js";
import { ConflictError, NotFoundError } from "../shared/errors.js";
import { logInfo } from "../shared/logger.js";
import { toPublicProject } from "../shared/projectView.js";
import { requirePathParameter } from "../shared/request.js";
import { buildSuccessResponse } from "../shared/response.js";

type Project = Record<string, unknown> & { projectId: string };

/**
 * Closes a campaign: it stops taking new donations and stays visible with what it raised. Only the manager who created
 * the project may do it (the owner check of withAuth), and the session is revalidated like any sensitive action.
 *
 * The donations already registered (pending or under review) are not touched: that money is already on its way, and they
 * can still be confirmed or reviewed. A donation being registered at the very moment of the closing can still get in,
 * because the project is read before the donation is written (the same window the PUBLICADO check always had).
 */
export const handler = withAuth<Project>(
  async ({ event, requestId }) => {
    const projectId = requirePathParameter(event, "projectId", "Identificador de proyecto no proporcionado");

    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAMES.projects,
          Key: { projectId },
          UpdateExpression: "SET #status = :closed, closedAt = :now, updatedAt = :now",
          ConditionExpression: "attribute_exists(projectId) AND #status = :published",
          ExpressionAttributeNames: { "#status": "status" },
          ExpressionAttributeValues: {
            ":closed": PROJECT_STATUS.closed,
            ":published": PROJECT_STATUS.published,
            ":now": new Date().toISOString(),
          },
          ReturnValues: "ALL_NEW",
        })
      );

      logInfo("Project closed", { requestId, projectId });
      return buildSuccessResponse(toPublicProject(result.Attributes ?? {}));
    } catch (error) {
      if (isDynamoError(error, DYNAMO_ERROR.conditionalCheckFailed)) {
        throw new ConflictError("El proyecto no está PUBLICADO: solo se puede cerrar una campaña publicada y abierta");
      }
      throw error;
    }
  },
  {
    action: AUTHZ_ACTIONS.closeProject,
    resourceType: "Project",
    loadResource: async (event) => {
      const projectId = requirePathParameter(event, "projectId", "Identificador de proyecto no proporcionado");
      const { Item } = await docClient.send(new GetCommand({ TableName: TABLE_NAMES.projects, Key: { projectId } }));
      if (!Item) throw new NotFoundError("Proyecto no encontrado");
      return { resource: Item as Project, ownerSub: typeof Item.createdBy === "string" ? Item.createdBy : undefined };
    },
  }
);

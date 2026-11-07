import { withAuth } from "../authz/withAuth.js";
import { AUTHZ_ACTIONS, PROJECT_STATUS } from "../shared/constants.js";
import { docClient, GetCommand, TABLE_NAMES } from "../shared/dynamo.js";
import { NotFoundError } from "../shared/errors.js";
import { toPublicProject } from "../shared/projectView.js";
import { requirePathParameter } from "../shared/request.js";
import { buildSuccessResponse } from "../shared/response.js";

export const handler = withAuth(
  async ({ event }) => {
    const projectId = requirePathParameter(event, "projectId", "Identificador de proyecto no proporcionado");
    const { Item: project } = await docClient.send(
      new GetCommand({ TableName: TABLE_NAMES.projects, Key: { projectId } })
    );

    // A draft answers like a missing project so visitors cannot learn that it exists.
    if (!project || project.status !== PROJECT_STATUS.published) {
      throw new NotFoundError("Proyecto no encontrado o no disponible");
    }
    return buildSuccessResponse(toPublicProject(project));
  },
  { action: AUTHZ_ACTIONS.viewProject, resourceType: "Project" }
);

import { withAuth } from "../authz/withAuth.js";
import { AUTHZ_ACTIONS, CURRENCY, PROJECT_STATUS } from "../shared/constants.js";
import { docClient, GetCommand, TABLE_NAMES } from "../shared/dynamo.js";
import { NotFoundError } from "../shared/errors.js";
import { requirePathParameter } from "../shared/request.js";
import { buildSuccessResponse } from "../shared/response.js";

const MAX_PROGRESS_PERCENTAGE = 100;

export const handler = withAuth(
  async ({ event }) => {
    const projectId = requirePathParameter(event, "projectId", "Identificador de proyecto no proporcionado");
    const { Item: project } = await docClient.send(
      new GetCommand({ TableName: TABLE_NAMES.projects, Key: { projectId } })
    );

    if (!project || project.status !== PROJECT_STATUS.published) {
      throw new NotFoundError("Proyecto no encontrado o no disponible");
    }

    const goalAmountCents: number = project.goalAmountCents || 1;
    const confirmedAmountCents: number = project.confirmedAmountCents || 0;
    const progressPercentage = Math.min(
      MAX_PROGRESS_PERCENTAGE,
      Math.round((confirmedAmountCents / goalAmountCents) * 100)
    );

    return buildSuccessResponse({
      projectId,
      goalAmountCents,
      confirmedAmountCents,
      currency: CURRENCY,
      progressPercentage,
    });
  },
  { action: AUTHZ_ACTIONS.viewProjectStats, resourceType: "Project" }
);

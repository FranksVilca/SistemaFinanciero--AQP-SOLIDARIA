import { withAuth } from "../authz/withAuth.js";
import { AUTHZ_ACTIONS, CURRENCY, VISIBLE_PROJECT_STATUSES } from "../shared/constants.js";
import { docClient, GetCommand, TABLE_NAMES } from "../shared/dynamo.js";
import { NotFoundError } from "../shared/errors.js";
import { requirePathParameter } from "../shared/request.js";
import { buildSuccessResponse } from "../shared/response.js";

export const handler = withAuth(
  async ({ event }) => {
    const projectId = requirePathParameter(event, "projectId", "Identificador de proyecto no proporcionado");
    const { Item: project } = await docClient.send(
      new GetCommand({ TableName: TABLE_NAMES.projects, Key: { projectId } })
    );

    if (!project || !VISIBLE_PROJECT_STATUSES.includes(project.status)) {
      throw new NotFoundError("Proyecto no encontrado o no disponible");
    }

    const goalAmountCents: number = project.goalAmountCents || 1;
    const confirmedAmountCents: number = project.confirmedAmountCents || 0;
    // Not capped at 100: reaching the goal does not stop a campaign, and what was raised beyond it is shown.
    const progressPercentage = Math.round((confirmedAmountCents / goalAmountCents) * 100);

    return buildSuccessResponse({
      projectId,
      status: project.status,
      goalAmountCents,
      confirmedAmountCents,
      currency: CURRENCY,
      progressPercentage,
    });
  },
  { action: AUTHZ_ACTIONS.viewProjectStats, resourceType: "Project" }
);

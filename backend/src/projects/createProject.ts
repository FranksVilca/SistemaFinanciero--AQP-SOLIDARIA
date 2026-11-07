import { randomUUID } from "node:crypto";
import { withAuth } from "../authz/withAuth.js";
import { AUTHZ_ACTIONS, CURRENCY, PROJECT_STATUS } from "../shared/constants.js";
import { docClient, PutCommand, TABLE_NAMES } from "../shared/dynamo.js";
import { logInfo } from "../shared/logger.js";
import { parseJsonBody } from "../shared/request.js";
import { buildSuccessResponse } from "../shared/response.js";
import { CreateProjectSchema } from "../shared/schemas.js";

export const handler = withAuth(
  async ({ event, requestId }) => {
    const { title, description, goalAmountCents } = parseJsonBody(event, CreateProjectSchema);
    const now = new Date().toISOString();

    const project = {
      projectId: randomUUID(),
      title,
      description,
      goalAmountCents,
      confirmedAmountCents: 0,
      currency: CURRENCY,
      status: PROJECT_STATUS.draft,
      createdAt: now,
      updatedAt: now,
    };
    await docClient.send(new PutCommand({ TableName: TABLE_NAMES.projects, Item: project }));

    logInfo("Project created as draft", { requestId, projectId: project.projectId });
    return buildSuccessResponse(project, 201);
  },
  { action: AUTHZ_ACTIONS.createProject, resourceType: "Project" }
);

import { withAuth } from "../authz/withAuth.js";
import { AUTHZ_ACTIONS, PROJECT_STATUS } from "../shared/constants.js";
import { docClient, QueryCommand, TABLE_NAMES } from "../shared/dynamo.js";
import { toPublicProject } from "../shared/projectView.js";
import { buildSuccessResponse } from "../shared/response.js";

type Project = Record<string, unknown>;

/** The projects with one status, most recent first (the index sorts them by creation date). */
async function projectsWithStatus(status: string): Promise<Project[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAMES.projects,
      IndexName: "status-createdAt-index",
      KeyConditionExpression: "#status = :status",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": status },
      ScanIndexForward: false,
    })
  );
  return result.Items ?? [];
}

const createdAtOf = (project: Project): string => String(project.createdAt ?? "");

export const handler = withAuth(
  async () => {
    // Open campaigns and closed ones (a draft is never listed): two queries on the same index, merged by date.
    const [open, closed] = await Promise.all([
      projectsWithStatus(PROJECT_STATUS.published),
      projectsWithStatus(PROJECT_STATUS.closed),
    ]);
    const visible = [...open, ...closed].sort((a, b) => createdAtOf(b).localeCompare(createdAtOf(a)));

    return buildSuccessResponse(visible.map(toPublicProject));
  },
  { action: AUTHZ_ACTIONS.listProjects, resourceType: "Project" }
);

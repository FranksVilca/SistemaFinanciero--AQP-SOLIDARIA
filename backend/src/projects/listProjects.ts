import { withAuth } from "../authz/withAuth.js";
import { AUTHZ_ACTIONS, PROJECT_STATUS } from "../shared/constants.js";
import { docClient, QueryCommand, TABLE_NAMES } from "../shared/dynamo.js";
import { toPublicProject } from "../shared/projectView.js";
import { buildSuccessResponse } from "../shared/response.js";

export const handler = withAuth(
  async () => {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.projects,
        IndexName: "status-createdAt-index",
        KeyConditionExpression: "#status = :published",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":published": PROJECT_STATUS.published },
        ScanIndexForward: false,
      })
    );

    return buildSuccessResponse((result.Items ?? []).map(toPublicProject));
  },
  { action: AUTHZ_ACTIONS.listProjects, resourceType: "Project" }
);

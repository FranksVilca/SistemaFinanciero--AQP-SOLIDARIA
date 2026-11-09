import { requirePrincipal, withAuth } from "../authz/withAuth.js";
import { AUTHZ_ACTIONS } from "../shared/constants.js";
import { toDonorView } from "../shared/donationView.js";
import { docClient, QueryCommand, TABLE_NAMES } from "../shared/dynamo.js";
import { logInfo } from "../shared/logger.js";
import { buildSuccessResponse } from "../shared/response.js";

export const handler = withAuth(
  async (context) => {
    const donorSub = requirePrincipal(context).sub;
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAMES.donations,
        IndexName: "donorSub-createdAt-index",
        KeyConditionExpression: "donorSub = :sub",
        ExpressionAttributeValues: { ":sub": donorSub },
        ScanIndexForward: false,
      })
    );

    const donations = (result.Items ?? []).map(toDonorView);
    logInfo("Donor history returned", { requestId: context.requestId, count: donations.length });
    return buildSuccessResponse(donations);
  },
  { action: AUTHZ_ACTIONS.viewMyDonations, resourceType: "Donation" }
);

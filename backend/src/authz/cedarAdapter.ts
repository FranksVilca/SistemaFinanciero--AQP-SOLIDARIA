import {
  VerifiedPermissionsClient,
  IsAuthorizedCommand,
} from "@aws-sdk/client-verifiedpermissions";
import { PolicyAuthorizer, AuthzContext } from "./evaluateAuthz.js";
import { logError } from "../shared/logger.js";

export class VerifiedPermissionsAuthorizer implements PolicyAuthorizer {
  private client: VerifiedPermissionsClient;
  private policyStoreId: string;

  constructor(policyStoreId = process.env.POLICY_STORE_ID || "demo-policy-store") {
    this.client = new VerifiedPermissionsClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    this.policyStoreId = policyStoreId;
  }

  async isAuthorized(context: AuthzContext): Promise<boolean> {
    const { principal, action, resourceType, resourceOwnerSub } = context;

    // Public actions
    if (action === "ListProjects" || action === "ViewProject") {
      return true;
    }

    if (!principal?.sub) {
      return false;
    }

    try {
      // Build principal entity
      const principalEntity = {
        entityType: "FundacionAQPSolidaria::User",
        entityId: principal.sub,
      };

      // Build action entity
      const actionEntity = {
        actionType: "FundacionAQPSolidaria::Action",
        actionId: action,
      };

      // Build resource entity
      const resourceEntity = {
        entityType: `FundacionAQPSolidaria::${resourceType}`,
        entityId: resourceType.toLowerCase() + "-id",
      };

      // Entities context with parent groups and attributes
      const entitiesList: any[] = [
        {
          identifier: principalEntity,
          parents: principal.groups.map((group) => ({
            entityType: "FundacionAQPSolidaria::Group",
            entityId: group,
          })),
        },
      ];

      if (resourceType === "Donation" && resourceOwnerSub) {
        entitiesList.push({
          identifier: resourceEntity,
          attributes: {
            donorSub: {
              string: resourceOwnerSub,
            },
          },
        });
      }

      const command = new IsAuthorizedCommand({
        policyStoreId: this.policyStoreId,
        principal: principalEntity,
        action: actionEntity,
        resource: resourceEntity,
        entities: {
          entityList: entitiesList,
        },
      });

      const response = await this.client.send(command);
      return response.decision === "ALLOW";
    } catch (err) {
      logError("Error al evaluar autorización en Amazon Verified Permissions", err);
      // Fail closed under Zero Trust
      return false;
    }
  }
}

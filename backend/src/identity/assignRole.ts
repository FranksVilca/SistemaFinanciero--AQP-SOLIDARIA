import { AdminAddUserToGroupCommand } from "@aws-sdk/client-cognito-identity-provider";
import { cognitoClient } from "../shared/cognito.js";
import { SESSION_CHECK_TIMEOUT_MS, type UserRole } from "../shared/constants.js";

/** Puts a person of the pool in the group of a role. */
export type RoleAssigner = (userPoolId: string, username: string, role: UserRole) => Promise<void>;

const assignInCognito: RoleAssigner = async (userPoolId, username, role) => {
  await cognitoClient().send(
    new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: role }),
    { abortSignal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS) }
  );
};

let assigner: RoleAssigner = assignInCognito;

export const assignRole: RoleAssigner = (userPoolId, username, role) => assigner(userPoolId, username, role);

/** For tests: replaces the assigner, or restores the one that calls Cognito when called without an argument. */
export function replaceRoleAssigner(replacement?: RoleAssigner): void {
  assigner = replacement ?? assignInCognito;
}

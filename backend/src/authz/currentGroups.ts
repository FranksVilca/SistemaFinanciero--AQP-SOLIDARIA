import { AdminListGroupsForUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { cognitoClient } from "../shared/cognito.js";
import { SESSION_CHECK_TIMEOUT_MS } from "../shared/constants.js";
import { logError, logWarn } from "../shared/logger.js";
import type { AuthPrincipal } from "./claims.js";

/**
 * The groups the identity provider holds for the person right now, or undefined when they cannot be known (the caller
 * fails closed). The groups in a token are the ones from when it was issued: removing someone from a group does not
 * change a token that is already out, so a sensitive action asks again.
 */
export type GroupsLookup = (principal: AuthPrincipal) => Promise<string[] | undefined>;

const lookupInCognito: GroupsLookup = async (principal) => {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) {
    logWarn("Group check impossible: missing user pool id");
    return undefined;
  }

  try {
    // A user has a handful of groups (the roles), far below the 60 that one page returns.
    const { Groups = [] } = await cognitoClient().send(
      new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: principal.username ?? principal.sub }),
      { abortSignal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS) }
    );
    return Groups.flatMap((group) => (group.GroupName ? [group.GroupName] : []));
  } catch (error) {
    logError("Group check failed: treating the roles as not held", error);
    return undefined;
  }
};

let lookup: GroupsLookup = lookupInCognito;

export const currentGroupsOf: GroupsLookup = (principal) => lookup(principal);

/** For tests: replaces the lookup, or restores the one that asks Cognito when called without an argument. */
export function replaceGroupsLookup(replacement?: GroupsLookup): void {
  lookup = replacement ?? lookupInCognito;
}

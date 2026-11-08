import { AUTHZ_ACTIONS, PUBLIC_ACTIONS, ROLES, type AuthzAction } from "../shared/constants.js";
import type { HandlerDenialReason } from "../shared/errors.js";
import { logError } from "../shared/logger.js";
import type { AuthPrincipal } from "./claims.js";

export type ResourceType = "Project" | "Donation" | "AuditEvent";

export interface AuthzContext {
  principal?: AuthPrincipal;
  action: AuthzAction;
  resourceType: ResourceType;
  resourceOwnerSub?: string;
  /** When true the principal must own the resource; a missing owner denies access. */
  requiresOwner?: boolean;
}

export interface PolicyAuthorizer {
  isAuthorized(context: AuthzContext): Promise<boolean>;
}

export type DenialReason =
  | "UNAUTHENTICATED"
  | "ROLE"
  | "OWNER"
  | "ENGINE_ERROR"
  | "SESSION_REVOKED"
  | "SEPARATION_OF_DUTIES"
  | "ROLE_REVOKED"
  | HandlerDenialReason;

export type AuthzDecision = { allowed: true } | { allowed: false; reason: DenialReason };

const ROLE_BY_ACTION: Partial<Record<AuthzAction, string>> = {
  [AUTHZ_ACTIONS.createProject]: ROLES.manager,
  [AUTHZ_ACTIONS.publishProject]: ROLES.manager,
  [AUTHZ_ACTIONS.createDonation]: ROLES.donor,
  [AUTHZ_ACTIONS.simulateDonation]: ROLES.donor,
  [AUTHZ_ACTIONS.viewMyDonations]: ROLES.donor,
  [AUTHZ_ACTIONS.viewAudit]: ROLES.auditor,
};

const KNOWN_ROLES: readonly string[] = Object.values(ROLES);

/**
 * The auditor audits what the other roles do, so the role cannot be combined with any other: the same person would
 * audit their own actions.
 */
export function violatesSeparationOfDuties(groups: readonly string[]): boolean {
  const roles = groups.filter((group) => KNOWN_ROLES.includes(group));
  return roles.includes(ROLES.auditor) && roles.length > 1;
}

export function holdsRequiredRole(groups: readonly string[], action: AuthzAction): boolean {
  if (violatesSeparationOfDuties(groups)) return false;
  const requiredRole = ROLE_BY_ACTION[action];
  return requiredRole !== undefined && groups.includes(requiredRole);
}

function isPublicAction(action: AuthzAction): boolean {
  return PUBLIC_ACTIONS.includes(action);
}

/** Embedded policy engine: role by action, plus ownership when the resource has an owner. */
export class EmbeddedPolicyAuthorizer implements PolicyAuthorizer {
  async isAuthorized(context: AuthzContext): Promise<boolean> {
    const { principal, action, resourceOwnerSub, requiresOwner } = context;
    if (isPublicAction(action)) return true;
    if (!principal?.sub) return false;

    if (!holdsRequiredRole(principal.groups, action)) return false;

    if (requiresOwner || resourceOwnerSub !== undefined) {
      return resourceOwnerSub === principal.sub;
    }
    return true;
  }
}

export const defaultAuthorizer: PolicyAuthorizer = new EmbeddedPolicyAuthorizer();

async function explainDenial(context: AuthzContext, authorizer: PolicyAuthorizer): Promise<DenialReason> {
  if (!context.principal?.sub) return "UNAUTHENTICATED";
  if (violatesSeparationOfDuties(context.principal.groups)) return "SEPARATION_OF_DUTIES";
  const withoutOwnership = { ...context, resourceOwnerSub: undefined, requiresOwner: false };
  return (await authorizer.isAuthorized(withoutOwnership)) ? "OWNER" : "ROLE";
}

/** Decides one request. Any failure of the engine denies access (fail closed). */
export async function authorize(
  context: AuthzContext,
  authorizer: PolicyAuthorizer = defaultAuthorizer
): Promise<AuthzDecision> {
  try {
    if (await authorizer.isAuthorized(context)) return { allowed: true };
    return { allowed: false, reason: await explainDenial(context, authorizer) };
  } catch (error) {
    logError("Policy engine failure: denying access", error, { action: context.action });
    return { allowed: false, reason: "ENGINE_ERROR" };
  }
}

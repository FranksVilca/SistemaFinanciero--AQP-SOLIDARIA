import { ForbiddenError, UnauthorizedError } from "../shared/errors.js";

export type UserRole = "DONANTE" | "GESTOR" | "AUDITOR";

export interface AuthPrincipal {
  sub: string;
  email?: string;
  groups: string[];
}

export interface AuthzContext {
  principal?: AuthPrincipal;
  action:
    | "ListProjects"
    | "ViewProject"
    | "CreateProject"
    | "PublishProject"
    | "CreateDonation"
    | "SimulateDonation"
    | "ViewDonation"
    | "ViewAudit";
  resourceType: "Project" | "Donation" | "AuditEvent";
  resourceOwnerSub?: string;
}

export interface PolicyAuthorizer {
  isAuthorized(context: AuthzContext): Promise<boolean>;
}

export class EmbeddedPolicyAuthorizer implements PolicyAuthorizer {
  async isAuthorized(context: AuthzContext): Promise<boolean> {
    const { principal, action, resourceOwnerSub } = context;

    // Public actions
    if (action === "ListProjects" || action === "ViewProject") {
      return true;
    }

    if (!principal || !principal.sub) {
      return false;
    }

    const groups = principal.groups || [];

    switch (action) {
      case "CreateProject":
      case "PublishProject":
        return groups.includes("GESTOR");

      case "CreateDonation":
        return groups.includes("DONANTE");

      case "SimulateDonation":
      case "ViewDonation":
        if (!groups.includes("DONANTE")) {
          return false;
        }
        if (resourceOwnerSub && resourceOwnerSub !== principal.sub) {
          return false;
        }
        return true;

      case "ViewAudit":
        return groups.includes("AUDITOR");

      default:
        return false;
    }
  }
}

export const defaultAuthorizer: PolicyAuthorizer = new EmbeddedPolicyAuthorizer();

export function getAuthorizer(): PolicyAuthorizer {
  if (process.env.POLICY_ENGINE === "verified_permissions") {
    try {
      const { VerifiedPermissionsAuthorizer } = require("./cedarAdapter.js");
      return new VerifiedPermissionsAuthorizer();
    } catch {
      return defaultAuthorizer;
    }
  }
  return defaultAuthorizer;
}

export function extractAuthClaims(event: {
  requestContext?: {
    authorizer?: {
      jwt?: {
        claims?: Record<string, unknown>;
      };
    };
  };
}): AuthPrincipal | undefined {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims || !claims.sub) {
    return undefined;
  }

  const sub = String(claims.sub);
  const email = claims.email ? String(claims.email) : undefined;
  
  let groups: string[] = [];
  const rawGroups = claims["cognito:groups"];
  if (Array.isArray(rawGroups)) {
    groups = rawGroups.map(String);
  } else if (typeof rawGroups === "string") {
    try {
      const parsed = JSON.parse(rawGroups);
      if (Array.isArray(parsed)) {
        groups = parsed.map(String);
      } else {
        groups = [rawGroups];
      }
    } catch {
      // HTTP API flattens array claims to "[A B]"; also accept "[A, B]" and "A,B".
      groups = rawGroups.replace(/[[\]"]/g, "").split(/[\s,]+/).filter(Boolean);
    }
  }

  return { sub, email, groups };
}

export async function enforceAuthz(
  context: AuthzContext,
  authorizer: PolicyAuthorizer = defaultAuthorizer
): Promise<void> {
  const allowed = await authorizer.isAuthorized(context);
  if (!allowed) {
    if (!context.principal) {
      throw new UnauthorizedError("Identidad no provista o token inválido");
    }
    throw new ForbiddenError(
      `Acceso denegado: rol o permiso insuficiente para la acción ${context.action}`
    );
  }
}

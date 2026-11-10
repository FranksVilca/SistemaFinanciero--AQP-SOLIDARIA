import { auditSafely } from "../audit/auditSafely.js";
import { pseudonymizeActor } from "../audit/recordAuditEvent.js";
import { requirePrincipal, withAuth } from "../authz/withAuth.js";
import { AUDIT_EVENT_TYPES, AUDIT_OUTCOME, AUTHZ_ACTIONS, type UserRole } from "../shared/constants.js";
import { ConflictError, NotFoundError, PolicyDenialError, ValidationError } from "../shared/errors.js";
import { logInfo } from "../shared/logger.js";
import { parseJsonBody, requirePathParameter } from "../shared/request.js";
import { buildSuccessResponse } from "../shared/response.js";
import { ASSIGNABLE_ROLES, findIncompatibleRoles, holdsExclusiveRole, rolesAmong } from "../shared/roleRules.js";
import { ChangeUserRoleSchema, UserIdSchema, type ChangeUserRoleInput } from "../shared/schemas.js";
import { userDirectory, type DirectoryUser, type UserDirectory } from "./userDirectory.js";

const NOT_ASSIGNABLE =
  "Acceso denegado: ese rol no se gestiona desde la aplicación; se asigna con el script de operación";
const SELF_CHANGE = "Acceso denegado: no puede cambiar sus propios roles";
const PROTECTED_USER =
  "Acceso denegado: quien tiene el rol AUDITOR o ADMIN solo se modifica con el script de operación";

function readUserId(raw: string): string {
  const parsed = UserIdSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(", "));
  return parsed.data;
}

/** The rules that depend on who asks and on whom, before anything is read about the roles of the person. */
function assertMayChange(role: string, target: DirectoryUser, callerSub: string): asserts role is UserRole {
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
    throw new PolicyDenialError("ROLE_NOT_ASSIGNABLE", NOT_ASSIGNABLE);
  }
  // Four eyes: whoever manages roles never manages their own, so nobody can make themselves more than they were made.
  if (target.sub === callerSub) throw new PolicyDenialError("SELF_ROLE_CHANGE", SELF_CHANGE);
}

function assertCombinationAllowed(current: string[], role: UserRole): void {
  const conflict = findIncompatibleRoles([...current, role]);
  if (conflict) {
    throw new ConflictError(
      `No se puede dar ${role}: ${conflict[0]} y ${conflict[1]} no pueden combinarse en una misma cuenta`
    );
  }
}

/** The person to change and the groups they hold now, after every rule that depends on who they are. */
async function loadTarget(
  directory: UserDirectory,
  userId: string,
  role: string,
  callerSub: string
): Promise<{ target: DirectoryUser; current: string[]; role: UserRole }> {
  const target = await directory.getUser(userId);
  if (!target) throw new NotFoundError("Usuario no encontrado");
  assertMayChange(role, target, callerSub);
  const current = await directory.groupsOf(userId);
  if (holdsExclusiveRole(current)) throw new PolicyDenialError("PROTECTED_USER", PROTECTED_USER);
  return { target, current, role };
}

/** Whether the request changes anything. Asking for what the person already has (or lacks) is not an error. */
function isChange({ action }: ChangeUserRoleInput, current: string[], role: UserRole): boolean {
  const hasRole = current.includes(role);
  if (action === "REMOVE") return hasRole;
  if (hasRole) return false;
  assertCombinationAllowed(current, role);
  return true;
}

export const handler = withAuth(
  async (context) => {
    const { event, requestId } = context;
    const caller = requirePrincipal(context);
    const userId = readUserId(requirePathParameter(event, "userId", "Identificador de usuario no proporcionado"));
    const request = parseJsonBody(event, ChangeUserRoleSchema);

    const directory = userDirectory();
    const { target, current, role } = await loadTarget(directory, userId, request.role, caller.sub);
    const changed = isChange(request, current, role);
    if (!changed) return buildSuccessResponse({ userId, roles: rolesAmong(current), changed });

    const granting = request.action === "ADD";
    await (granting ? directory.addToGroup(userId, role) : directory.removeFromGroup(userId, role));
    await auditSafely({
      eventType: granting ? AUDIT_EVENT_TYPES.roleGranted : AUDIT_EVENT_TYPES.roleRevoked,
      requestId,
      actorSub: caller.sub,
      // The person who received or lost the role, pseudonymized like every actor: never their email or their id.
      resourceRef: `user:${pseudonymizeActor(target.sub)}`,
      action: AUTHZ_ACTIONS.changeUserRole,
      outcome: AUDIT_OUTCOME.success,
      reason: role,
    });

    const after = granting ? [...current, role] : current.filter((group) => group !== role);
    logInfo("User role changed", { requestId, action: request.action, role });
    return buildSuccessResponse({ userId, roles: rolesAmong(after), changed });
  },
  { action: AUTHZ_ACTIONS.changeUserRole, resourceType: "User" }
);

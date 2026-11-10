import { ROLES } from "../src/shared/constants.js";
import { findIncompatibleRoles, rolesAmong } from "../src/shared/roleRules.js";

/**
 * The planning of `npm run role`: what has to change in the groups of a person to get what the operator asked for,
 * under the same rules as the application (src/shared/roleRules.ts). No access to AWS here, so every rule is tested.
 */

export type RoleCommand = "add" | "remove" | "set";

export interface RoleChangePlan {
  ok: true;
  /** The roles the person holds now and the ones they will hold when the plan is applied. */
  before: string[];
  after: string[];
  toRemove: string[];
  toAdd: string[];
}

export interface RoleChangeRefusal {
  ok: false;
  error: string;
}

const KNOWN = Object.values(ROLES) as string[];

/** The roles named on the command line, in upper case, or the first name that is not a role. */
export function parseRoleNames(names: readonly string[]): { roles: string[] } | { invalid: string } {
  const roles = names.map((name) => name.trim().toUpperCase());
  const invalid = roles.find((role) => !KNOWN.includes(role));
  return invalid === undefined ? { roles: [...new Set(roles)] } : { invalid: names[roles.indexOf(invalid)] };
}

const joined = (roles: readonly string[]) => (roles.length > 0 ? roles.join(" + ") : "ningún rol");

function refuseCombination(after: readonly string[], command: RoleCommand): RoleChangeRefusal {
  const pair = findIncompatibleRoles(after);
  const hint =
    command === "add" && pair?.some((role) => role === ROLES.admin || role === ROLES.auditor)
      ? " Para dejar a la persona solo con ese rol use `set` (reemplaza los demás)."
      : "";
  return {
    ok: false,
    error: `${pair?.[0]} y ${pair?.[1]} no pueden combinarse en una misma cuenta; el resultado sería ${joined(after)}.${hint}`,
  };
}

/** Plans an `add`, a `remove` or a `set`, or says why the result would break a rule. */
export function planRoleChange(
  currentGroups: readonly string[],
  command: RoleCommand,
  requested: readonly string[]
): RoleChangePlan | RoleChangeRefusal {
  if (requested.length === 0) return { ok: false, error: "Indique al menos un rol." };

  const before: string[] = rolesAmong(currentGroups);
  const after =
    command === "set"
      ? [...requested]
      : command === "add"
        ? [...new Set([...before, ...requested])]
        : before.filter((role) => !requested.includes(role));

  if (findIncompatibleRoles(after)) return refuseCombination(after, command);

  return {
    ok: true,
    before,
    after,
    toRemove: before.filter((role) => !after.includes(role)),
    toAdd: after.filter((role) => !before.includes(role)),
  };
}

export const isNoOp = (plan: RoleChangePlan): boolean => plan.toAdd.length === 0 && plan.toRemove.length === 0;

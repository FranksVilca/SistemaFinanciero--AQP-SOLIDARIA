import { ROLES, type UserRole } from "./constants.js";

/**
 * Which roles one person may hold at the same time, and which of them an administrator may give or take away. It is
 * the only place where these rules live: the authorization engine, the administration API and the operator script all
 * read it.
 *
 *            DONANTE  GESTOR  REVISOR  AUDITOR  ADMIN
 *  DONANTE      -       yes      yes      no       no
 *  GESTOR      yes       -       no       no       no
 *  REVISOR     yes      no        -       no       no
 *  AUDITOR      no      no       no        -       no
 *  ADMIN        no      no       no       no        -
 */

/** Every role the system knows. A group of the identity provider that is not here grants nothing. */
export const KNOWN_ROLES: readonly string[] = Object.values(ROLES);

/**
 * The auditor audits what the others do, and the administrator decides who may do it: neither can act on the platform
 * without auditing or granting itself, so each is held alone.
 */
export const EXCLUSIVE_ROLES: readonly UserRole[] = [ROLES.auditor, ROLES.admin];

/** The only roles an administrator gives and takes away in the application; the rest go through the operator script. */
export const ASSIGNABLE_ROLES: readonly UserRole[] = [ROLES.donor, ROLES.manager, ROLES.reviewer];

/**
 * A manager creates the projects and a reviewer decides on the donations held for them: one person doing both would
 * approve their own work, and the per-project check of the review only covers the projects they created themselves.
 */
const INCOMPATIBLE_PAIRS: ReadonlyArray<readonly [UserRole, UserRole]> = [[ROLES.manager, ROLES.reviewer]];

const isKnownRole = (group: string): group is UserRole => KNOWN_ROLES.includes(group);

/** The roles among the groups of a person (groups that are not roles are ignored), without repetitions. */
export function rolesAmong(groups: readonly string[]): UserRole[] {
  return [...new Set(groups.filter(isKnownRole))];
}

function conflict(first: UserRole, second: UserRole): boolean {
  if (first === second) return false;
  if (EXCLUSIVE_ROLES.includes(first) || EXCLUSIVE_ROLES.includes(second)) return true;
  return INCOMPATIBLE_PAIRS.some(
    ([left, right]) => (left === first && right === second) || (left === second && right === first)
  );
}

/** The first pair of roles that cannot be held together, or undefined when the combination is allowed. */
export function findIncompatibleRoles(groups: readonly string[]): [UserRole, UserRole] | undefined {
  const roles = rolesAmong(groups);
  for (const [index, first] of roles.entries()) {
    const second = roles.slice(index + 1).find((candidate) => conflict(first, candidate));
    if (second) return [first, second];
  }
  return undefined;
}

/** True when the groups combine roles that must not be held together. Every protected action is then refused. */
export const violatesSeparationOfDuties = (groups: readonly string[]): boolean =>
  findIncompatibleRoles(groups) !== undefined;

/** Holds a role that only the operator script changes: the administrator may neither give nor take anything from them. */
export const holdsExclusiveRole = (groups: readonly string[]): boolean =>
  rolesAmong(groups).some((role) => EXCLUSIVE_ROLES.includes(role));

/** The roles an administrator could still give to someone who holds these groups, keeping every rule. */
export function addableRoles(groups: readonly string[]): UserRole[] {
  if (holdsExclusiveRole(groups)) return [];
  return ASSIGNABLE_ROLES.filter(
    (role) => !groups.includes(role) && findIncompatibleRoles([...groups, role]) === undefined
  );
}

/** The roles an administrator could take away from someone who holds these groups. */
export function removableRoles(groups: readonly string[]): UserRole[] {
  if (holdsExclusiveRole(groups)) return [];
  return ASSIGNABLE_ROLES.filter((role) => groups.includes(role));
}

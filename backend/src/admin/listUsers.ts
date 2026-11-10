import { withAuth } from "../authz/withAuth.js";
import { AUTHZ_ACTIONS } from "../shared/constants.js";
import { ValidationError } from "../shared/errors.js";
import { logInfo } from "../shared/logger.js";
import { buildSuccessResponse } from "../shared/response.js";
import { addableRoles, holdsExclusiveRole, removableRoles, rolesAmong } from "../shared/roleRules.js";
import { userDirectory, type DirectoryUser } from "./userDirectory.js";

const DEFAULT_LIMIT = 20;
// Every user of the page costs one call to read their groups, all in parallel: a small page keeps it far from the
// request quotas of the identity provider and from the timeout of the function.
const MAX_LIMIT = 25;
const EMAIL_PREFIX = /^[A-Za-z0-9._%+@-]{1,64}$/;
// What Cognito hands back as a pagination token: opaque, so only its alphabet and size are checked.
const PAGE_TOKEN = /^[A-Za-z0-9_\-=.+/]{1,2048}$/;

function readLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const limit = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(limit >= 1 && limit <= MAX_LIMIT)) {
    throw new ValidationError(`El parámetro limit debe ser un entero entre 1 y ${MAX_LIMIT}`);
  }
  return limit;
}

function readMatching(raw: string | undefined, pattern: RegExp, message: string): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (!pattern.test(raw)) throw new ValidationError(message);
  return raw;
}

/** What the administrator sees of a person, and what the rules still let them do with it. */
function toView(user: DirectoryUser, groups: string[], callerSub: string | undefined) {
  const isSelf = user.sub === callerSub;
  const isProtected = holdsExclusiveRole(groups);
  // Nobody changes their own roles, and whoever holds AUDITOR or ADMIN is only changed with the operator script.
  const canChange = !isSelf && !isProtected;
  return {
    userId: user.username,
    ...(user.email && { email: user.email }),
    roles: rolesAmong(groups),
    isSelf,
    isProtected,
    addable: canChange ? addableRoles(groups) : [],
    removable: canChange ? removableRoles(groups) : [],
  };
}

export const handler = withAuth(
  async ({ event, requestId, principal }) => {
    const query = event.queryStringParameters ?? {};
    const limit = readLimit(query.limit);
    const emailPrefix = readMatching(query.email, EMAIL_PREFIX, "El parámetro email contiene caracteres no válidos");
    const paginationToken = readMatching(query.nextToken, PAGE_TOKEN, "El parámetro nextToken es inválido");

    const directory = userDirectory();
    const page = await directory.listUsers({ limit, paginationToken, emailPrefix });
    const groups = await Promise.all(page.users.map((user) => directory.groupsOf(user.username)));
    const items = page.users.map((user, index) => toView(user, groups[index], principal?.sub));

    logInfo("User list returned", { requestId, count: items.length });
    return buildSuccessResponse({ items, ...(page.nextToken && { nextToken: page.nextToken }) });
  },
  { action: AUTHZ_ACTIONS.listUsers, resourceType: "User" }
);

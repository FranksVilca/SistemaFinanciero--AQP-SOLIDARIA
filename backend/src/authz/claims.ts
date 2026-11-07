import type { ApiEvent } from "../shared/apiEvent.js";

export interface AuthPrincipal {
  sub: string;
  email?: string;
  groups: string[];
}

/**
 * Parses the `cognito:groups` claim. The HTTP API JWT authorizer may deliver it as an array, as a JSON
 * string (`["A","B"]`) or as a bracketed list (`[A B]`). Anything else yields no groups, which denies access.
 */
export function parseGroupsClaim(rawGroups: unknown): string[] {
  if (Array.isArray(rawGroups)) return rawGroups.map(String);
  if (typeof rawGroups !== "string") return [];

  const trimmed = rawGroups.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Not JSON: fall through to the bracketed-list format.
    }
    return trimmed
      .slice(1, -1)
      .split(/[\s,]+/)
      .filter(Boolean);
  }
  return trimmed.split(/[\s,]+/).filter(Boolean);
}

export function extractAuthClaims(event: ApiEvent): AuthPrincipal | undefined {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims?.sub) return undefined;

  return {
    sub: String(claims.sub),
    email: claims.email ? String(claims.email) : undefined,
    groups: parseGroupsClaim(claims["cognito:groups"]),
  };
}

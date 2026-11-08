import type { ApiEvent } from "../shared/apiEvent.js";

export interface AuthPrincipal {
  sub: string;
  /** Name of the user in the pool: what the administrative calls of the identity provider ask for. */
  username?: string;
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

/** Cognito marks access tokens with `token_use: "access"` and ID tokens with `"id"`. */
export const ACCESS_TOKEN_USE = "access";

/**
 * Builds the principal from the claims verified by the gateway. Only access tokens are accepted: an ID token
 * (or a claim set without `token_use`) yields no principal, so a protected action answers 401. The gateway
 * already rejects ID tokens through the scope check; this is the second, independent layer.
 */
export function extractAuthClaims(event: ApiEvent): AuthPrincipal | undefined {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims?.sub || claims.token_use !== ACCESS_TOKEN_USE) return undefined;

  return {
    sub: String(claims.sub),
    username: claims.username ? String(claims.username) : undefined,
    email: claims.email ? String(claims.email) : undefined,
    groups: parseGroupsClaim(claims["cognito:groups"]),
  };
}

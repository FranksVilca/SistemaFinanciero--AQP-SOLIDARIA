import { randomUUID } from "node:crypto";

export type TestRole = "DONANTE" | "GESTOR" | "AUDITOR" | "GESTOR_FAKE";

export interface TestIdentity {
  sub: string;
  groups: string[];
}

export interface TestEvent {
  headers?: Record<string, string | undefined>;
  body?: string;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  requestContext: {
    requestId: string;
    authorizer?: { jwt: { claims: Record<string, unknown> } };
  };
}

export interface EventOptions {
  identity?: TestIdentity;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  /** Cognito token type carried by the claims; protected actions only accept "access". */
  tokenUse?: string;
}

export function identityFor(role: TestRole, sub: string = `${role.toLowerCase()}-${randomUUID()}`): TestIdentity {
  return { sub, groups: [role] };
}

export function buildEvent(options: EventOptions = {}): TestEvent {
  const { identity, body, rawBody, headers, pathParameters, queryStringParameters, tokenUse = "access" } = options;
  const claims = identity
    ? { sub: identity.sub, token_use: tokenUse, "cognito:groups": JSON.stringify(identity.groups) }
    : undefined;

  return {
    headers: { authorization: "Bearer test-access-token", ...headers },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    pathParameters,
    queryStringParameters,
    requestContext: {
      requestId: `req-${randomUUID()}`,
      authorizer: claims ? { jwt: { claims } } : undefined,
    },
  };
}

export function parseBody<T = Record<string, unknown>>(response: { body: string }): T {
  return JSON.parse(response.body) as T;
}

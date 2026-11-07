/** The subset of the API Gateway HTTP API (payload v2) event that the handlers rely on. */
export interface ApiEvent {
  headers?: Record<string, string | undefined>;
  body?: string;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  requestContext?: {
    requestId?: string;
    authorizer?: {
      jwt?: {
        claims?: Record<string, unknown>;
      };
    };
  };
}

/** Reads a header regardless of the casing used by the client. */
export function readHeader(event: ApiEvent, name: string): string | undefined {
  const wanted = name.toLowerCase();
  const found = Object.keys(event.headers ?? {}).find((key) => key.toLowerCase() === wanted);
  return found ? event.headers?.[found] : undefined;
}

import { AppError } from "./errors.js";

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// CORS headers are not set here: the HTTP API CorsConfiguration (infra/template.yaml)
// restricts allowed origins and API Gateway overrides any CORS header sent by the integration.
const DEFAULT_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};

export function buildSuccessResponse<T>(
  data: T,
  statusCode = 200,
  extraHeaders: Record<string, string> = {}
): ApiResponse {
  return {
    statusCode,
    headers: { ...DEFAULT_HEADERS, ...extraHeaders },
    body: JSON.stringify(data),
  };
}

export function buildErrorResponse(
  error: unknown,
  requestId = "req-unknown",
  extraHeaders: Record<string, string> = {}
): ApiResponse {
  let statusCode = 500;
  let code = "INTERNAL_SERVER_ERROR";
  let message = "Ha ocurrido un error interno";

  if (error instanceof AppError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
  }
  // Any other error (e.g. AWS SDK) keeps the generic message: its details may expose
  // table names or expressions. Handlers log the full error with logError before calling this.

  return {
    statusCode,
    headers: { ...DEFAULT_HEADERS, ...extraHeaders },
    body: JSON.stringify({
      code,
      message,
      requestId,
    }),
  };
}

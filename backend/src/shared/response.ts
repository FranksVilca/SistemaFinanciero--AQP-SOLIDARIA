import { AppError } from "./errors.js";

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// CORS is enforced by the API Gateway configuration, never by the handlers.
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
  let errorHeaders: Record<string, string> = {};

  if (error instanceof AppError) {
    statusCode = error.statusCode;
    code = error.code;
    message = error.message;
    errorHeaders = error.headers;
  }

  return {
    statusCode,
    headers: { ...DEFAULT_HEADERS, ...errorHeaders, ...extraHeaders },
    body: JSON.stringify({
      code,
      message,
      requestId,
    }),
  };
}

import { AppError } from "./errors.js";

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const DEFAULT_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,Idempotency-Key",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
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
  } else if (error instanceof Error) {
    message = error.message;
  }

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

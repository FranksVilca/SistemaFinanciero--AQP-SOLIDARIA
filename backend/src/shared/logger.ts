export interface LogContext {
  requestId?: string;
  action?: string;
  actorRef?: string;
  resourceRef?: string;
  durationMs?: number;
  statusCode?: number;
  [key: string]: unknown;
}

const REDACTED_KEYS = new Set([
  "authorization",
  "password",
  "token",
  "accesstoken",
  "idtoken",
  "refreshtoken",
  "secret",
  "cardnumber",
  "cvv",
]);

function maskSensitiveData(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map(maskSensitiveData);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (REDACTED_KEYS.has(lowerKey)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object") {
      sanitized[key] = maskSensitiveData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function logInfo(message: string, context: LogContext = {}): void {
  const logEntry = {
    level: "INFO",
    timestamp: new Date().toISOString(),
    message,
    context: maskSensitiveData(context),
  };
  console.log(JSON.stringify(logEntry));
}

export function logWarn(message: string, context: LogContext = {}): void {
  const logEntry = {
    level: "WARN",
    timestamp: new Date().toISOString(),
    message,
    context: maskSensitiveData(context),
  };
  console.warn(JSON.stringify(logEntry));
}

export function logError(
  message: string,
  error?: unknown,
  context: LogContext = {}
): void {
  const logEntry = {
    level: "ERROR",
    timestamp: new Date().toISOString(),
    message,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
    context: maskSensitiveData(context),
  };
  console.error(JSON.stringify(logEntry));
}

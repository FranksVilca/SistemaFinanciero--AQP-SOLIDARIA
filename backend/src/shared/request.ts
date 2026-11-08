import type { ZodType } from "zod";
import type { ApiEvent } from "./apiEvent.js";
import { NotFoundError, ValidationError } from "./errors.js";

/** Parses and validates the JSON body once, so no handler repeats this logic. */
export function parseJsonBody<T>(event: ApiEvent, schema: ZodType<T>, fixedMessage?: string): T {
  if (!event.body) throw new ValidationError("Cuerpo de solicitud requerido");

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    throw new ValidationError("Formato JSON inválido");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(fixedMessage ?? result.error.issues.map((issue) => issue.message).join(", "));
  }
  return result.data;
}

export function requirePathParameter(event: ApiEvent, name: string, missingMessage: string): string {
  const value = event.pathParameters?.[name];
  if (!value) throw new NotFoundError(missingMessage);
  return value;
}

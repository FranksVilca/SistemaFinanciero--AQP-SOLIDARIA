import type { ApiEvent } from "../shared/apiEvent.js";
import { NO_RESOURCE_REF } from "../shared/constants.js";

const RESOURCE_ID_FIELDS = [
  { field: "projectId", prefix: "project" },
  { field: "donationId", prefix: "donation" },
] as const;

// Identifiers are UUIDs. A value from the request body is attacker-controlled, so it only reaches the audit trail when
// it has exactly that shape.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readObject(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function firstReference(sources: Array<Record<string, unknown>>, mustBeUuid: boolean): string | undefined {
  for (const { field, prefix } of RESOURCE_ID_FIELDS) {
    for (const source of sources) {
      const id = source[field];
      if (typeof id === "string" && id && (!mustBeUuid || UUID_PATTERN.test(id))) return `${prefix}:${id}`;
    }
  }
  return undefined;
}

/**
 * Reference of the affected resource: from the request path, from the created resource in the response, or, for a
 * request that names its resource in the body (a donation names its project), from the body.
 */
export function resolveResourceRef(event: ApiEvent, responseBody?: string): string {
  const fromPathOrResponse = firstReference([event.pathParameters ?? {}, readObject(responseBody)], false);
  return fromPathOrResponse ?? firstReference([readObject(event.body)], true) ?? NO_RESOURCE_REF;
}

import type { ApiEvent } from "../shared/apiEvent.js";
import { NO_RESOURCE_REF } from "../shared/constants.js";

const RESOURCE_ID_FIELDS = [
  { field: "projectId", prefix: "project" },
  { field: "donationId", prefix: "donation" },
] as const;

function readObject(responseBody: string | undefined): Record<string, unknown> {
  if (!responseBody) return {};
  try {
    const parsed: unknown = JSON.parse(responseBody);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Reference of the affected resource, taken from the request path or from the created resource in the response. */
export function resolveResourceRef(event: ApiEvent, responseBody?: string): string {
  const created = readObject(responseBody);
  for (const { field, prefix } of RESOURCE_ID_FIELDS) {
    const id = event.pathParameters?.[field] ?? created[field];
    if (typeof id === "string" && id) return `${prefix}:${id}`;
  }
  return NO_RESOURCE_REF;
}

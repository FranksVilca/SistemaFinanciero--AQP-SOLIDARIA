import type { QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import { withAuth } from "../authz/withAuth.js";
import { AUDIT_QUERY_MAX_DAYS, AUDIT_QUERY_MAX_EVENTS, AUTHZ_ACTIONS } from "../shared/constants.js";
import { docClient, QueryCommand, TABLE_NAMES } from "../shared/dynamo.js";
import { ValidationError } from "../shared/errors.js";
import { buildSuccessResponse } from "../shared/response.js";

const MS_PER_DAY = 86_400_000;
// "~" sorts after every character that can follow a timestamp in the sort key ("#" and hex digits).
const SORT_KEY_UPPER_BOUND_SUFFIX = "~";

type AuditItem = Record<string, unknown>;

interface AuditQuery {
  fromIso: string;
  toIso: string;
  eventType?: string;
}

function parseInstant(value: string | undefined, fallback: Date, parameterName: string): Date {
  if (value === undefined) return fallback;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime()))
    throw new ValidationError(`Parámetro ${parameterName} inválido (use fecha ISO-8601)`);
  return instant;
}

function resolveRange(from: string | undefined, to: string | undefined): { from: Date; to: Date } {
  const upperBound = parseInstant(to, new Date(), "to");
  const lowerBound = parseInstant(from, new Date(upperBound.getTime() - AUDIT_QUERY_MAX_DAYS * MS_PER_DAY), "from");
  if (lowerBound > upperBound) throw new ValidationError("El parámetro from no puede ser posterior a to");
  return { from: lowerBound, to: upperBound };
}

/** UTC days covered by the range, newest first, capped at AUDIT_QUERY_MAX_DAYS. */
function daysNewestFirst(from: Date, to: Date): string[] {
  const days: string[] = [];
  const lastDay = from.toISOString().slice(0, 10);
  for (
    let cursor = new Date(to);
    days.length < AUDIT_QUERY_MAX_DAYS;
    cursor = new Date(cursor.getTime() - MS_PER_DAY)
  ) {
    const day = cursor.toISOString().slice(0, 10);
    days.push(day);
    if (day <= lastDay) break;
  }
  return days;
}

function buildDayQuery(day: string, query: AuditQuery): QueryCommandInput {
  const filterByType = query.eventType !== undefined;
  return {
    TableName: TABLE_NAMES.audit,
    KeyConditionExpression: "auditDay = :day AND #sortKey BETWEEN :from AND :to",
    ...(filterByType && { FilterExpression: "eventType = :eventType" }),
    ExpressionAttributeNames: { "#sortKey": "timestamp#eventId" },
    ExpressionAttributeValues: {
      ":day": day,
      ":from": query.fromIso,
      ":to": `${query.toIso}${SORT_KEY_UPPER_BOUND_SUFFIX}`,
      ...(filterByType && { ":eventType": query.eventType }),
    },
    ScanIndexForward: false,
  };
}

async function collectDay(day: string, query: AuditQuery, remaining: number): Promise<AuditItem[]> {
  const items: AuditItem[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(new QueryCommand({ ...buildDayQuery(day, query), ExclusiveStartKey: startKey }));
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey && items.length < remaining);
  return items.slice(0, remaining);
}

export const handler = withAuth(
  async ({ event }) => {
    const range = resolveRange(event.queryStringParameters?.from, event.queryStringParameters?.to);
    const query: AuditQuery = {
      fromIso: range.from.toISOString(),
      toIso: range.to.toISOString(),
      eventType: event.queryStringParameters?.eventType,
    };

    const events: AuditItem[] = [];
    for (const day of daysNewestFirst(range.from, range.to)) {
      if (events.length >= AUDIT_QUERY_MAX_EVENTS) break;
      events.push(...(await collectDay(day, query, AUDIT_QUERY_MAX_EVENTS - events.length)));
    }
    return buildSuccessResponse(events);
  },
  { action: AUTHZ_ACTIONS.viewAudit, resourceType: "AuditEvent" }
);

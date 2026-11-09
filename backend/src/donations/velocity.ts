import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { DONATION_MAX_CENTS } from "../shared/constants.js";
import { docClient, GetCommand, TABLE_NAMES } from "../shared/dynamo.js";

/**
 * Anti-abuse velocity controls of donation creation: a per-donor limit per minute and an hourly review of the amount
 * and of donations close to the maximum (structuring). The counters live in the idempotency table, which already
 * expires items through its TTL attribute (expiresAt).
 */
export interface VelocityConfig {
  maxPerMinute: number;
  reviewThresholdCents: number;
  structuringCount: number;
}

export const DEFAULT_VELOCITY_CONFIG: VelocityConfig = {
  maxPerMinute: 5,
  reviewThresholdCents: 500_000,
  structuringCount: 3,
};

/** A donation of at least this share of the maximum counts towards the structuring pattern. */
const NEAR_MAX_RATIO = 0.9;
export const NEAR_MAX_CENTS = Math.ceil(DONATION_MAX_CENTS * NEAR_MAX_RATIO);

const SECONDS_PER_HOUR = 3_600;
const MS_PER_HOUR = SECONDS_PER_HOUR * 1_000;
const MINUTE_KEY_LENGTH = "yyyyMMddHHmm".length;
const HOUR_KEY_LENGTH = "yyyyMMddHH".length;

export type VelocityReason = "HOURLY_AMOUNT" | "STRUCTURING";

export interface HourlyWindow {
  totalCents: number;
  nearMaxCount: number;
}

/** The hourly window as stored; `version` is absent until the first donation of the hour. */
export interface StoredHourlyWindow extends HourlyWindow {
  version?: number;
}

export interface Assessment extends HourlyWindow {
  reasons: VelocityReason[];
}

export interface VelocityWindows {
  minutePk: string;
  hourPk: string;
  /** Epoch seconds one hour after the current hour ends: both counters are useless by then. */
  expiresAt: number;
}

function positiveIntegerOr(value: string | undefined, fallback: number): number {
  if (value === undefined || !/^\d+$/.test(value.trim())) return fallback;
  const parsed = Number(value);
  return parsed > 0 ? parsed : fallback;
}

/** Thresholds from the function environment; a missing or malformed value keeps its safe default. */
export function readVelocityConfig(env: Record<string, string | undefined> = process.env): VelocityConfig {
  return {
    maxPerMinute: positiveIntegerOr(env.VELOCITY_MAX_PER_MINUTE, DEFAULT_VELOCITY_CONFIG.maxPerMinute),
    reviewThresholdCents: positiveIntegerOr(
      env.VELOCITY_REVIEW_THRESHOLD_CENTS,
      DEFAULT_VELOCITY_CONFIG.reviewThresholdCents
    ),
    structuringCount: positiveIntegerOr(env.VELOCITY_STRUCTURING_COUNT, DEFAULT_VELOCITY_CONFIG.structuringCount),
  };
}

/** Fixed UTC windows: the counters of a donor for the current minute and the current hour. */
export function velocityWindowsOf(donorSub: string, now: Date): VelocityWindows {
  const compact = now.toISOString().replace(/[-:T]/g, "");
  const hourEnd = Math.floor(now.getTime() / MS_PER_HOUR) * MS_PER_HOUR + MS_PER_HOUR;
  return {
    minutePk: `velocity#${donorSub}#minute#${compact.slice(0, MINUTE_KEY_LENGTH)}`,
    hourPk: `velocity#${donorSub}#hour#${compact.slice(0, HOUR_KEY_LENGTH)}`,
    expiresAt: hourEnd / 1_000 + SECONDS_PER_HOUR,
  };
}

/** The hourly window after adding this donation, and why it must be reviewed (empty when it must not). */
export function assessDonation(current: HourlyWindow, amountCents: number, config: VelocityConfig): Assessment {
  const totalCents = current.totalCents + amountCents;
  const nearMaxCount = current.nearMaxCount + (amountCents >= NEAR_MAX_CENTS ? 1 : 0);
  const reasons: VelocityReason[] = [];
  if (totalCents > config.reviewThresholdCents) reasons.push("HOURLY_AMOUNT");
  if (nearMaxCount >= config.structuringCount) reasons.push("STRUCTURING");
  return { totalCents, nearMaxCount, reasons };
}

type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/** Strongly consistent read: the hourly decision must see every donation already committed. */
export async function readHourlyWindow(hourPk: string): Promise<StoredHourlyWindow> {
  const { Item } = await docClient.send(
    new GetCommand({ TableName: TABLE_NAMES.idempotency, Key: { pk: hourPk }, ConsistentRead: true })
  );
  if (!Item) return { totalCents: 0, nearMaxCount: 0 };
  return {
    totalCents: Number(Item.totalCents),
    nearMaxCount: Number(Item.nearMaxCount),
    version: Number(Item.windowVersion),
  };
}

/** Position of each item in the donation transaction; CancellationReasons come back in the same order. */
export const TRANSACTION_ITEM = { idempotency: 0, donation: 1, minuteCounter: 2, hourlyWindow: 3 } as const;

export type CancellationOutcome = "replay" | "rateLimited" | "contention" | "unexpected";

const CONDITION_FAILED = "ConditionalCheckFailed";
const CONFLICT = "TransactionConflict";
const NO_FAILURE = "None";
const EXPECTED_CODES = new Set([NO_FAILURE, CONDITION_FAILED, CONFLICT]);

/**
 * What a cancelled donation transaction means, from its reason codes. Only a stale hourly window or a conflict with a
 * concurrent transaction is retried; any other code (ValidationError, ThrottlingError, capacity errors) and a set
 * without a failing item are unexpected and must not be retried or disguised.
 */
export function classifyCancellation(codes: string[]): CancellationOutcome {
  if (codes[TRANSACTION_ITEM.idempotency] === CONDITION_FAILED) return "replay";
  if (codes[TRANSACTION_ITEM.minuteCounter] === CONDITION_FAILED) return "rateLimited";
  if (!codes.every((code) => EXPECTED_CODES.has(code))) return "unexpected";
  if (codes[TRANSACTION_ITEM.hourlyWindow] === CONDITION_FAILED || codes.includes(CONFLICT)) return "contention";
  return "unexpected";
}

/**
 * The two counter writes that join the transaction of a new donation. The minute counter is an atomic ADD guarded by
 * the limit; the hourly window is written with optimistic concurrency on the version that was read, so two
 * concurrent donations can never both be assessed against the same total.
 */
export function velocityTransactItems(
  windows: VelocityWindows,
  read: StoredHourlyWindow,
  assessment: Assessment,
  config: VelocityConfig
): TransactItem[] {
  const isFirstOfHour = read.version === undefined;
  return [
    {
      Update: {
        TableName: TABLE_NAMES.idempotency,
        Key: { pk: windows.minutePk },
        UpdateExpression: "ADD donationCount :one SET expiresAt = :expiresAt",
        ConditionExpression: "attribute_not_exists(donationCount) OR donationCount < :limit",
        ExpressionAttributeValues: { ":one": 1, ":limit": config.maxPerMinute, ":expiresAt": windows.expiresAt },
      },
    },
    {
      Update: {
        TableName: TABLE_NAMES.idempotency,
        Key: { pk: windows.hourPk },
        UpdateExpression:
          "SET totalCents = :totalCents, nearMaxCount = :nearMaxCount, windowVersion = :nextVersion, expiresAt = :expiresAt",
        ConditionExpression: isFirstOfHour ? "attribute_not_exists(pk)" : "windowVersion = :expectedVersion",
        ExpressionAttributeValues: {
          ":totalCents": assessment.totalCents,
          ":nearMaxCount": assessment.nearMaxCount,
          ":nextVersion": (read.version ?? 0) + 1,
          ":expiresAt": windows.expiresAt,
          ...(!isFirstOfHour && { ":expectedVersion": read.version }),
        },
      },
    },
  ];
}

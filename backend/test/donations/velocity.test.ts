import { describe, expect, it } from "vitest";
import {
  assessDonation,
  DEFAULT_VELOCITY_CONFIG,
  readVelocityConfig,
  velocityWindowsOf,
} from "../../src/donations/velocity.js";
import { TooManyRequestsError } from "../../src/shared/errors.js";
import { buildErrorResponse } from "../../src/shared/response.js";

const EMPTY_WINDOW = { totalCents: 0, nearMaxCount: 0 };

describe("velocity configuration", () => {
  it("uses the documented defaults when nothing is configured", () => {
    expect(readVelocityConfig({})).toEqual({ maxPerMinute: 5, reviewThresholdCents: 500_000, structuringCount: 3 });
    expect(DEFAULT_VELOCITY_CONFIG).toEqual(readVelocityConfig({}));
  });

  it("reads positive integers from the environment", () => {
    const config = readVelocityConfig({
      VELOCITY_MAX_PER_MINUTE: "7",
      VELOCITY_REVIEW_THRESHOLD_CENTS: "250000",
      VELOCITY_STRUCTURING_COUNT: "4",
    });

    expect(config).toEqual({ maxPerMinute: 7, reviewThresholdCents: 250_000, structuringCount: 4 });
  });

  it("falls back to the default for values that are not positive integers", () => {
    const config = readVelocityConfig({
      VELOCITY_MAX_PER_MINUTE: "0",
      VELOCITY_REVIEW_THRESHOLD_CENTS: "abc",
      VELOCITY_STRUCTURING_COUNT: "2.5",
    });

    expect(config).toEqual(DEFAULT_VELOCITY_CONFIG);
  });
});

describe("velocity windows", () => {
  it("keys the minute and the hour of a donor in UTC, with a TTL after the window ends", () => {
    const windows = velocityWindowsOf("donor-1", new Date("2026-11-09T13:07:42.000Z"));

    expect(windows.minutePk).toBe("velocity#donor-1#minute#202611091307");
    expect(windows.hourPk).toBe("velocity#donor-1#hour#2026110913");
    expect(windows.expiresAt).toBe(Date.parse("2026-11-09T15:00:00.000Z") / 1000);
  });
});

describe("hourly assessment", () => {
  it("keeps a donation that stays within the hourly threshold", () => {
    const assessment = assessDonation({ totalCents: 400_000, nearMaxCount: 0 }, 50_000, DEFAULT_VELOCITY_CONFIG);

    expect(assessment).toEqual({ totalCents: 450_000, nearMaxCount: 0, reasons: [] });
  });

  it("flags the donation whose hourly total exceeds the threshold", () => {
    const assessment = assessDonation({ totalCents: 450_000, nearMaxCount: 0 }, 50_001, DEFAULT_VELOCITY_CONFIG);

    expect(assessment.totalCents).toBe(500_001);
    expect(assessment.reasons).toEqual(["HOURLY_AMOUNT"]);
  });

  it("does not flag a total that only reaches the threshold", () => {
    expect(assessDonation({ totalCents: 450_000, nearMaxCount: 0 }, 50_000, DEFAULT_VELOCITY_CONFIG).reasons).toEqual(
      []
    );
  });

  it("counts donations of at least 90% of the maximum and flags structuring when the count is reached", () => {
    const second = assessDonation({ totalCents: 90_000, nearMaxCount: 1 }, 90_000, DEFAULT_VELOCITY_CONFIG);
    const third = assessDonation({ totalCents: 180_000, nearMaxCount: 2 }, 95_000, DEFAULT_VELOCITY_CONFIG);
    const below = assessDonation(EMPTY_WINDOW, 89_999, DEFAULT_VELOCITY_CONFIG);

    expect(second).toEqual({ totalCents: 180_000, nearMaxCount: 2, reasons: [] });
    expect(third).toEqual({ totalCents: 275_000, nearMaxCount: 3, reasons: ["STRUCTURING"] });
    expect(below.nearMaxCount).toBe(0);
  });
});

describe("too many requests", () => {
  it("maps to HTTP 429 with a domain code and the Spanish message", () => {
    const response = buildErrorResponse(new TooManyRequestsError(), "req-1");

    expect(response.statusCode).toBe(429);
    expect(JSON.parse(response.body)).toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "Demasiadas donaciones en poco tiempo; intente nuevamente en un minuto",
    });
  });
});

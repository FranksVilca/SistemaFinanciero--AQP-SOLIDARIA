import { describe, it, expect } from "vitest";
import { CreateDonationSchema } from "../src/shared/schemas.js";

describe("User Story 4 - Donation Validation (HU-05, T04)", () => {
  const validProjectId = "11111111-1111-1111-1111-111111111111";

  it("T04: should reject amountCents <= 0", () => {
    const resultZero = CreateDonationSchema.safeParse({
      projectId: validProjectId,
      amountCents: 0,
    });
    expect(resultZero.success).toBe(false);

    const resultNegative = CreateDonationSchema.safeParse({
      projectId: validProjectId,
      amountCents: -500,
    });
    expect(resultNegative.success).toBe(false);
  });

  it("T04: should reject amountCents > 100000 (S/ 1,000.00)", () => {
    const resultOver = CreateDonationSchema.safeParse({
      projectId: validProjectId,
      amountCents: 100001,
    });
    expect(resultOver.success).toBe(false);
  });

  it("T04: should reject non-integer amountCents", () => {
    const resultFloat = CreateDonationSchema.safeParse({
      projectId: validProjectId,
      amountCents: 50.75,
    });
    expect(resultFloat.success).toBe(false);
  });

  it("should accept valid amountCents within range [100, 100000]", () => {
    const resultMin = CreateDonationSchema.safeParse({
      projectId: validProjectId,
      amountCents: 100,
    });
    expect(resultMin.success).toBe(true);

    const resultMax = CreateDonationSchema.safeParse({
      projectId: validProjectId,
      amountCents: 100000,
    });
    expect(resultMax.success).toBe(true);
  });
});

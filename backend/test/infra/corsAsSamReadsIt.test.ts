import { describe, expect, it } from "vitest";
import { rawTemplate, type Json, type JsonObject } from "./helpers/loadTemplate.js";

/**
 * The other infrastructure tests read the template after its conditions are resolved for a stage. SAM does not: it
 * receives the template as written and translates it, and it only understands plain lists and maps where it expects
 * them. A condition around a whole list made it write the CORS of the API wrongly; API Gateway ignored it and the
 * deployed API answered no preflight request, which a resolved template could never show. This reads the template the
 * way SAM receives it. infra/scripts/check_sam_cors.py goes further and runs the translator itself.
 */

const INTRINSIC = /^(Fn::|Ref$|Condition$)/;

const isIntrinsic = (value: Json): boolean =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).some((key) => INTRINSIC.test(key));

const cors = (rawTemplate().Resources as Record<string, JsonObject>).HttpApi.Properties as JsonObject;
const corsConfiguration = cors.CorsConfiguration as JsonObject;

describe("the CORS of the API, as SAM receives it", () => {
  it("declares each setting as a plain list: an intrinsic function that is the whole list is not understood", () => {
    for (const setting of ["AllowOrigins", "AllowHeaders", "AllowMethods"]) {
      const value = corsConfiguration[setting];

      expect(Array.isArray(value), `${setting} must be a list`).toBe(true);
      expect(isIntrinsic(value), `${setting} must not be an intrinsic function`).toBe(false);
    }
  });

  it("allows the CloudFront domain, and localhost only through a condition on its own element", () => {
    const origins = corsConfiguration.AllowOrigins as Json[];
    const text = JSON.stringify(origins);

    expect(origins.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain("CloudFrontDistribution");
    expect(text).not.toContain('"*"');
    // localhost must be removable in production, so it sits inside an Fn::If that falls back to AWS::NoValue.
    expect(origins.filter((origin) => JSON.stringify(origin).includes("http://localhost:3000"))).toEqual([
      { "Fn::If": ["IsAcademicStage", "http://localhost:3000", { Ref: "AWS::NoValue" }] },
    ]);
  });

  it("allows the headers and methods the SPA needs, and nothing else", () => {
    expect(corsConfiguration.AllowHeaders).toEqual(["Content-Type", "Authorization", "Idempotency-Key"]);
    expect(corsConfiguration.AllowMethods).toEqual(["GET", "POST", "PATCH", "OPTIONS"]);
  });
});

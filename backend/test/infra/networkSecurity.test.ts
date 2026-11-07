import { describe, expect, it } from "vitest";
import { STAGES, loadTemplate, propertiesOf, resourcesOfType, type JsonObject } from "./helpers/loadTemplate.js";

const HSTS_MINIMUM_SECONDS = 15_552_000; // 180 days
const textOf = (value: unknown): string => JSON.stringify(value);

interface PolicyStatement {
  Effect: string;
  Principal: JsonObject | string;
  Action: string | string[];
  Resource: unknown;
  Condition?: JsonObject;
}

const statementsOf = (policy: JsonObject): PolicyStatement[] =>
  (propertiesOf(policy).PolicyDocument as JsonObject).Statement as unknown as PolicyStatement[];

describe.each(STAGES)("communication security in stage %s (NIST principle 2)", (stage) => {
  const template = loadTemplate(stage);
  const distribution = propertiesOf(resourcesOfType(template, "AWS::CloudFront::Distribution")[0][1]);
  const behavior = (distribution.DistributionConfig as JsonObject).DefaultCacheBehavior as JsonObject;
  const headers = propertiesOf(resourcesOfType(template, "AWS::CloudFront::ResponseHeadersPolicy")[0][1])
    .ResponseHeadersPolicyConfig as JsonObject;
  const securityHeaders = headers.SecurityHeadersConfig as JsonObject;

  it("sends every viewer to HTTPS", () => {
    expect(behavior.ViewerProtocolPolicy).toBe("redirect-to-https");
  });

  it("sets strict transport security for at least 180 days", () => {
    const hsts = securityHeaders.StrictTransportSecurity as JsonObject;
    expect(hsts.AccessControlMaxAgeSec as number).toBeGreaterThanOrEqual(HSTS_MINIMUM_SECONDS);
    expect(hsts.Override).toBe(true);
  });

  it("forbids framing, sniffing and script sources other than the site itself", () => {
    expect((securityHeaders.FrameOptions as JsonObject).FrameOption).toBe("DENY");
    expect((securityHeaders.ContentTypeOptions as JsonObject).Override).toBe(true);

    const policyValue = (securityHeaders.ContentSecurityPolicy as JsonObject).ContentSecurityPolicy;
    // The policy is an Fn::Sub because it names the Cognito domain.
    const csp = typeof policyValue === "string" ? policyValue : String((policyValue as JsonObject)["Fn::Sub"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|\*\s*;/);
  });

  it("keeps the frontend bucket private and readable only by this CloudFront distribution", () => {
    const bucket = resourcesOfType(template, "AWS::S3::Bucket").find(([name]) => name === "FrontendBucket")!;
    expect(propertiesOf(bucket[1]).PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });

    const policy = resourcesOfType(template, "AWS::S3::BucketPolicy").find(([name]) => name === "FrontendBucketPolicy");
    expect(policy, "FrontendBucketPolicy is missing: CloudFront could not read the site").toBeDefined();

    const allow = statementsOf(policy![1]).find((statement) => statement.Effect === "Allow")!;
    expect(textOf(allow.Principal)).toContain("cloudfront.amazonaws.com");
    expect(allow.Action).toBe("s3:GetObject");
    expect(textOf(allow.Condition)).toContain("AWS:SourceArn");
    expect(textOf(allow.Condition)).toContain("CloudFrontDistribution");
  });

  it.each(["FrontendBucketPolicy", "CloudTrailLogBucketPolicy"])(
    "%s rejects requests that are not encrypted in transit",
    (name) => {
      const policy = resourcesOfType(template, "AWS::S3::BucketPolicy").find(([logicalId]) => logicalId === name)!;
      const deny = statementsOf(policy[1]).find((statement) => statement.Effect === "Deny")!;

      expect(textOf(deny.Condition)).toContain("aws:SecureTransport");
    }
  );

  it("signs the requests of CloudFront to S3 (origin access control)", () => {
    const [, control] = resourcesOfType(template, "AWS::CloudFront::OriginAccessControl")[0];
    expect(propertiesOf(control).OriginAccessControlConfig).toMatchObject({
      SigningBehavior: "always",
      SigningProtocol: "sigv4",
    });
  });
});

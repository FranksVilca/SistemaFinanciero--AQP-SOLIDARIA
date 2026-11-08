import { describe, expect, it } from "vitest";
import {
  STAGES,
  loadTemplate,
  propertiesOf,
  rawParameters,
  resourcesOfType,
  type JsonObject,
} from "./helpers/loadTemplate.js";

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

/** CSP host-source matching for the https sources used here: an exact origin or a wildcard subdomain. */
function allowedByHostSources(sources: string[], url: string): boolean {
  const { host, protocol } = new URL(url);
  return sources.some((source) => {
    if (source === "'self'") return false;
    const match = /^(\w+):\/\/(\*\.)?([^/]+)$/.exec(source);
    if (!match || `${match[1]}:` !== protocol) return false;
    return match[2] ? host.endsWith(`.${match[3]}`) : host === match[3];
  });
}

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

  it("lets the SPA reach everything it needs: discovery, token, revocation and the API (connect-src)", () => {
    const policyValue = (securityHeaders.ContentSecurityPolicy as JsonObject).ContentSecurityPolicy;
    const rawPolicy = typeof policyValue === "string" ? policyValue : String((policyValue as JsonObject)["Fn::Sub"]);
    const parameters = rawParameters();
    const policy = rawPolicy
      .replace(/\$\{CognitoDomainPrefix\}/g, String(parameters.CognitoDomainPrefix.Default))
      .replace(/\$\{AWS::Region\}/g, "us-east-1");
    const connectSources = /connect-src ([^;]+);/.exec(policy)![1].split(/\s+/);

    // Hosts the SPA calls (frontend/src/auth/authService.ts and frontend/src/services/apiClient.ts).
    const requests = [
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example/.well-known/openid-configuration",
      `https://${parameters.CognitoDomainPrefix.Default}.auth.us-east-1.amazoncognito.com/oauth2/token`,
      `https://${parameters.CognitoDomainPrefix.Default}.auth.us-east-1.amazoncognito.com/oauth2/revoke`,
      "https://abc123def4.execute-api.us-east-1.amazonaws.com/academic/v1/projects",
    ];
    for (const request of requests) expect(allowedByHostSources(connectSources, request), request).toBe(true);
    expect(allowedByHostSources(connectSources, "https://evil.example.com/collect")).toBe(false);
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

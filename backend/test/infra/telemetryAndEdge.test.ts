import { describe, expect, it } from "vitest";
import {
  STAGES,
  eventsOf,
  lambdaFunctions,
  loadTemplate,
  propertiesOf,
  resourcesOfType,
  type JsonObject,
} from "./helpers/loadTemplate.js";

const LOG_RETENTION_DAYS = 14;
const PUBLIC_ROUTES = ["GET /v1/projects", "GET /v1/projects/{projectId}", "GET /v1/projects/{projectId}/stats"];
const LOCAL_ORIGIN = "http://localhost:3000";

const textOf = (value: unknown): string => JSON.stringify(value);

describe.each(STAGES)("telemetry and edge configuration in stage %s", (stage) => {
  const template = loadTemplate(stage);
  const apiProperties = propertiesOf(Object.values(resourcesOfType(template, "AWS::Serverless::HttpApi"))[0][1]);
  const clientProperties = propertiesOf(resourcesOfType(template, "AWS::Cognito::UserPoolClient")[0][1]);

  it("keeps every log group for at most 14 days", () => {
    const logGroups = resourcesOfType(template, "AWS::Logs::LogGroup");
    expect(logGroups.length).toBeGreaterThanOrEqual(2); // functions and API access logs
    for (const [, group] of logGroups) {
      expect(propertiesOf(group).RetentionInDays).toBeLessThanOrEqual(LOG_RETENTION_DAYS);
    }
  });

  it("sends every function to the shared log group in JSON format", () => {
    const logging = (template.globals.Function as JsonObject).LoggingConfig as JsonObject;
    expect(logging.LogFormat).toBe("JSON");
    expect(textOf(logging.LogGroup)).toContain("FunctionLogGroup");
    for (const [, definition] of lambdaFunctions(template)) {
      expect(propertiesOf(definition).LoggingConfig ?? logging).toBe(logging);
    }
  });

  it("writes access logs of the API", () => {
    expect(textOf(apiProperties.AccessLogSettings)).toContain("ApiAccessLogGroup");
  });

  it("defines a CloudTrail trail with a private log bucket", () => {
    const trails = resourcesOfType(template, "AWS::CloudTrail::Trail");
    expect(trails).toHaveLength(1);
    expect(propertiesOf(trails[0][1]).IsLogging).toBe(true);

    const bucket = propertiesOf(resourcesOfType(template, "AWS::S3::Bucket").find(([name]) => name === "CloudTrailLogBucket")![1]);
    expect(bucket.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(textOf(bucket.LifecycleConfiguration)).toContain("ExpirationInDays");
    expect(resourcesOfType(template, "AWS::S3::BucketPolicy").some(([name]) => name === "CloudTrailLogBucketPolicy")).toBe(true);
  });

  it("can skip the trail when the account already has one", () => {
    const withoutTrail = loadTemplate(stage, { EnableCloudTrail: "false" });
    expect(resourcesOfType(withoutTrail, "AWS::CloudTrail::Trail")).toHaveLength(0);
  });

  it("restricts CORS to the CloudFront domain, with localhost only in the academic stage", () => {
    const origins = (apiProperties.CorsConfiguration as JsonObject).AllowOrigins as unknown[];
    expect(textOf(origins)).not.toContain('"*"');
    expect(textOf(origins)).toContain("CloudFrontDistribution");
    expect(textOf(origins).includes(LOCAL_ORIGIN)).toBe(stage === "academic");
  });

  it("points Cognito callback and logout URLs to CloudFront, with localhost only in the academic stage", () => {
    for (const urls of [clientProperties.CallbackURLs, clientProperties.LogoutURLs]) {
      expect(textOf(urls)).toContain("CloudFrontDistribution");
      expect(textOf(urls).includes(LOCAL_ORIGIN)).toBe(stage === "academic");
    }
  });

  it("throttles every public route individually", () => {
    const routeSettings = (apiProperties.RouteSettings ?? {}) as Record<string, JsonObject>;
    for (const route of PUBLIC_ROUTES) {
      expect(routeSettings[route], route).toBeDefined();
      expect(routeSettings[route].ThrottlingRateLimit).toBeGreaterThan(0);
      expect(routeSettings[route].ThrottlingBurstLimit).toBeGreaterThan(0);
    }
    expect(apiProperties.DefaultRouteSettings).toBeDefined();
  });

  it("protects every non-public route with a scope and publishes exactly the public routes without authorizer", () => {
    const noAuthorizerRoutes = lambdaFunctions(template)
      .flatMap(([, definition]) => eventsOf(definition))
      .filter(([, event]) => textOf(propertiesOf(event).Auth).includes("NONE"))
      .map(([, event]) => `${propertiesOf(event).Method} ${propertiesOf(event).Path}`);

    expect(noAuthorizerRoutes.sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  it("allows the Cognito domain in the content security policy", () => {
    const policy = propertiesOf(resourcesOfType(template, "AWS::CloudFront::ResponseHeadersPolicy")[0][1]);
    expect(textOf(policy)).toContain("amazoncognito.com");
  });
});

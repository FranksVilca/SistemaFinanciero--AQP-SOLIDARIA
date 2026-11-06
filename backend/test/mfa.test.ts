import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parse, type CollectionTag, type ScalarTag } from "yaml";

// Static validation of infra/template.yaml (CA-11.1 / HU-11, T14).
// This checks the declared IaC; deploy-time behavior (real TOTP challenge) must be verified against AWS.

type Resource = { Type: string; Properties?: Record<string, unknown>; Condition?: string };
type Template = { Resources: Record<string, Resource>; Outputs?: Record<string, unknown> };

const INTRINSICS = [
  "Ref", "Sub", "GetAtt", "Equals", "If", "Not", "And", "Or",
  "Join", "Select", "Split", "FindInMap", "ImportValue", "GetAZs", "Base64", "Condition",
];

// Map CloudFormation short-form tags (!Ref X) to their long form ({ Ref: X }).
const cfnTags: (ScalarTag | CollectionTag)[] = INTRINSICS.flatMap((name) => {
  const key = name === "Ref" || name === "Condition" ? name : `Fn::${name}`;
  const resolve = (value: unknown) =>
    name === "GetAtt" && typeof value === "string" ? { [key]: value.split(".") } : { [key]: value };
  return [
    { tag: `!${name}`, resolve: (str: string) => resolve(str) } as ScalarTag,
    { tag: `!${name}`, collection: "seq", resolve: (seq) => resolve(seq.toJSON()) } as CollectionTag,
    { tag: `!${name}`, collection: "map", resolve: (map) => resolve(map.toJSON()) } as CollectionTag,
  ];
});

const templatePath = fileURLToPath(new URL("../../infra/template.yaml", import.meta.url));
const template = parse(readFileSync(templatePath, "utf8"), { customTags: cfnTags }) as Template;
const resources = template.Resources;

const ofType = (type: string) =>
  Object.entries(resources).filter(([, r]) => r.Type === type);

const refOf = (value: unknown): string | undefined =>
  value && typeof value === "object" && "Ref" in value ? String((value as { Ref: unknown }).Ref) : undefined;

const groupPool = (groupName: string): string | undefined => {
  const entry = ofType("AWS::Cognito::UserPoolGroup").find(
    ([, r]) => r.Properties?.GroupName === groupName
  );
  return entry ? refOf(entry[1].Properties?.UserPoolId) : undefined;
};

const STAFF_POOL = "StaffUserPool";
const DONOR_POOL = "CognitoUserPool";
const STAFF_CLIENT = "StaffUserPoolClient";
const DONOR_CLIENT = "CognitoUserPoolClient";
const STAFF_AUTHORIZER = "StaffJwtAuthorizer";
const DONOR_AUTHORIZER = "CognitoJwtAuthorizer";

const httpApiAuth = () =>
  resources.HttpApi.Properties?.Auth as {
    DefaultAuthorizer?: string;
    Authorizers: Record<string, { JwtConfiguration: { Issuer: unknown; Audience: unknown[] } }>;
  };

const routeAuthorizer = (functionName: string): string | undefined => {
  const events = resources[functionName]?.Properties?.Events as Record<
    string,
    { Properties: { Auth?: { Authorizer?: string } } }
  >;
  const [event] = Object.values(events);
  return event.Properties.Auth?.Authorizer ?? httpApiAuth().DefaultAuthorizer;
};

describe("T14 / CA-11.1 - MFA TOTP mandatory for privileged roles (template validation)", () => {
  it("staff pool enforces MFA ON with TOTP only and admin-only sign-up", () => {
    const staff = resources[STAFF_POOL];
    expect(staff?.Type).toBe("AWS::Cognito::UserPool");
    expect(staff.Properties?.MfaConfiguration).toBe("ON");
    expect(staff.Properties?.EnabledMfas).toEqual(["SOFTWARE_TOKEN_MFA"]);
    expect(staff.Properties?.AdminCreateUserConfig).toMatchObject({ AllowAdminCreateUserOnly: true });
  });

  it("donor pool keeps MFA OPTIONAL with TOTP only", () => {
    const donor = resources[DONOR_POOL];
    expect(donor.Properties?.MfaConfiguration).toBe("OPTIONAL");
    expect(donor.Properties?.EnabledMfas).toEqual(["SOFTWARE_TOKEN_MFA"]);
  });

  it("no user pool enables SMS MFA", () => {
    for (const [, pool] of ofType("AWS::Cognito::UserPool")) {
      expect(pool.Properties?.EnabledMfas).not.toContain("SMS_MFA");
      expect(pool.Properties?.SmsConfiguration).toBeUndefined();
    }
  });

  it("GESTOR and AUDITOR belong to the staff pool, DONANTE to the donor pool", () => {
    expect(groupPool("GESTOR")).toBe(STAFF_POOL);
    expect(groupPool("AUDITOR")).toBe(STAFF_POOL);
    expect(groupPool("DONANTE")).toBe(DONOR_POOL);
    const groupNames = ofType("AWS::Cognito::UserPoolGroup").map(([, r]) => r.Properties?.GroupName);
    expect(groupNames.filter((n) => n === "GESTOR" || n === "AUDITOR")).toHaveLength(2);
  });

  it("staff client is a public PKCE code-flow client limited to staff scopes", () => {
    const client = resources[STAFF_CLIENT];
    expect(client?.Type).toBe("AWS::Cognito::UserPoolClient");
    expect(refOf(client.Properties?.UserPoolId)).toBe(STAFF_POOL);
    expect(client.Properties?.GenerateSecret).toBe(false);
    expect(client.Properties?.AllowedOAuthFlows).toEqual(["code"]);
    expect(client.Properties?.EnableTokenRevocation).toBe(true);
    expect(client.Properties?.AccessTokenValidity).toBe(15);
    expect(client.Properties?.IdTokenValidity).toBe(15);
    const scopes = client.Properties?.AllowedOAuthScopes as string[];
    expect(scopes).toEqual(expect.arrayContaining(["api/projects.write", "api/audit.read"]));
    expect(scopes).not.toContain("api/donations.write");
    expect(scopes).not.toContain("api/donations.read");
  });

  it("donor client does not allow staff scopes", () => {
    const scopes = resources[DONOR_CLIENT].Properties?.AllowedOAuthScopes as string[];
    expect(scopes).not.toContain("api/projects.write");
    expect(scopes).not.toContain("api/audit.read");
    expect(scopes).toEqual(expect.arrayContaining(["api/donations.write", "api/donations.read"]));
  });

  it("staff authorizer trusts only the staff pool and staff client", () => {
    const { Authorizers } = httpApiAuth();
    const staff = Authorizers[STAFF_AUTHORIZER].JwtConfiguration;
    expect(JSON.stringify(staff.Issuer)).toContain(`\${${STAFF_POOL}}`);
    expect(staff.Audience.map(refOf)).toEqual([STAFF_CLIENT]);
    const donor = Authorizers[DONOR_AUTHORIZER].JwtConfiguration;
    expect(JSON.stringify(donor.Issuer)).toContain(`\${${DONOR_POOL}}`);
    expect(donor.Audience.map(refOf)).toEqual([DONOR_CLIENT]);
  });

  it("GESTOR/AUDITOR routes use the staff authorizer, donor routes the donor authorizer", () => {
    for (const fn of ["CreateProjectFunction", "PublishProjectFunction", "GetAuditEventsFunction"]) {
      expect(routeAuthorizer(fn), fn).toBe(STAFF_AUTHORIZER);
    }
    for (const fn of ["CreateDonationFunction", "SimulateDonationFunction", "GetMyDonationsFunction"]) {
      expect(routeAuthorizer(fn), fn).toBe(DONOR_AUTHORIZER);
    }
    for (const fn of ["ListProjectsFunction", "GetProjectFunction", "GetProjectStatsFunction"]) {
      expect(routeAuthorizer(fn), fn).toBe("NONE");
    }
  });

  it("exposes staff pool and client ids as outputs", () => {
    expect(refOf((template.Outputs?.StaffUserPoolId as { Value: unknown })?.Value)).toBe(STAFF_POOL);
    expect(refOf((template.Outputs?.StaffUserPoolClientId as { Value: unknown })?.Value)).toBe(STAFF_CLIENT);
  });
});

describe("Cognito Hosted UI domains (CA-03.1)", () => {
  const domainFor = (pool: string) =>
    ofType("AWS::Cognito::UserPoolDomain").find(([, r]) => refOf(r.Properties?.UserPoolId) === pool);

  it.each([
    [DONOR_POOL, DONOR_CLIENT],
    [STAFF_POOL, STAFF_CLIENT],
  ])("%s has its own Hosted UI domain and %s uses the Cognito IdP", (pool, client) => {
    const domain = domainFor(pool);
    expect(domain, `${pool} domain`).toBeDefined();
    expect(JSON.stringify(domain?.[1].Properties?.Domain)).toContain("${CognitoDomainPrefix}");
    expect(resources[client].Properties?.SupportedIdentityProviders).toEqual(["COGNITO"]);
  });

  it.each([DONOR_CLIENT, STAFF_CLIENT])("%s allows the chained Hosted UI logout continuation route", (client) => {
    const logoutUrls = resources[client].Properties?.LogoutURLs as string[];
    expect(logoutUrls.some((url) => url.endsWith("/auth/logout/continue"))).toBe(true);
  });

  it("donor and staff domains are distinct", () => {
    const [donor, staff] = [domainFor(DONOR_POOL), domainFor(STAFF_POOL)];
    expect(JSON.stringify(donor?.[1].Properties?.Domain)).not.toBe(
      JSON.stringify(staff?.[1].Properties?.Domain)
    );
  });

  it("exposes Hosted UI base URLs as outputs", () => {
    expect(template.Outputs?.HostedUiDomain).toBeDefined();
    expect(template.Outputs?.StaffHostedUiDomain).toBeDefined();
  });

  it("CSP allows the SPA to reach the Cognito token and revoke endpoints", () => {
    const policy = resources.SecurityHeadersPolicy.Properties as {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: { ContentSecurityPolicy: { ContentSecurityPolicy: string } };
      };
    };
    const csp = policy.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
    const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src")) ?? "";
    expect(connectSrc).toContain("https://*.amazoncognito.com");
  });
});

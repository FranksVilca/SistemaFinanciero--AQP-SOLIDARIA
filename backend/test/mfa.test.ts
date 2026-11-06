import { describe, it, expect } from "vitest";
import { template, resources, ofType, refOf } from "./support/cfnTemplate.js";

// Static validation of infra/template.yaml (CA-11.1 / HU-11, T14).
// This checks the declared IaC; deploy-time behavior (real TOTP challenge) must be verified against AWS.

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

  it.each([
    [DONOR_CLIENT, "/auth/callback"],
    [STAFF_CLIENT, "/auth/staff/callback"],
  ])("%s registers the CloudFront origin for callback and logout, not only localhost", (client, callbackPath) => {
    const props = resources[client].Properties as { CallbackURLs: unknown[]; LogoutURLs: unknown[] };
    const viaCloudFront = (urls: unknown[]) =>
      urls.map((url) => JSON.stringify(url)).filter((url) => url.includes("${CloudFrontDistribution.DomainName}"));
    expect(viaCloudFront(props.CallbackURLs).some((url) => url.includes(callbackPath))).toBe(true);
    const logout = viaCloudFront(props.LogoutURLs);
    expect(logout.some((url) => url.includes("/auth/logout/continue"))).toBe(true);
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

describe("HTTP API CORS is restricted to known origins", () => {
  const allowOrigins = () =>
    (resources.HttpApi.Properties?.CorsConfiguration as { AllowOrigins: unknown[] }).AllowOrigins;

  it("does not allow the wildcard origin", () => {
    expect(allowOrigins()).not.toContain("*");
    expect(allowOrigins().map((o) => JSON.stringify(o)).some((o) => o.includes("*"))).toBe(false);
  });

  it("allows the CloudFront origin and localhost for local development only", () => {
    expect(allowOrigins().map((o) => JSON.stringify(o))).toEqual(
      expect.arrayContaining([JSON.stringify({ "Fn::Sub": "https://${CloudFrontDistribution.DomainName}" })])
    );
    expect(allowOrigins()).toContain("http://localhost:3000");
    expect(allowOrigins()).toHaveLength(2);
  });
});

describe("Audit trail is append-only (CA-08.3 / CA-10.2)", () => {
  type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
  const AUDIT_WRITERS = ["CreateProjectFunction", "PublishProjectFunction"];
  const AUDIT_READER = "GetAuditEventsFunction";
  const functions = ofType("AWS::Serverless::Function");

  const policiesOf = (fn: string) => (resources[fn].Properties?.Policies ?? []) as Record<string, unknown>[];
  const touchesAudit = (value: unknown) => JSON.stringify(value).includes('"AuditTable');
  const auditActions = (fn: string): string[] =>
    policiesOf(fn)
      .flatMap((policy) => (policy.Statement ?? []) as Statement[])
      .filter((statement) => touchesAudit(statement.Resource))
      .flatMap((statement) => [statement.Action].flat());

  it("no function uses a SAM policy template (CRUD/Write/Read) on the audit table", () => {
    for (const [name] of functions) {
      const templates = policiesOf(name).filter((policy) => !("Statement" in policy));
      expect(templates.filter(touchesAudit), name).toEqual([]);
    }
  });

  it("writers can only PutItem on the audit table", () => {
    for (const fn of AUDIT_WRITERS) {
      expect(auditActions(fn), fn).toEqual(["dynamodb:PutItem"]);
    }
  });

  it("the audit reader can only Query the audit table", () => {
    expect(auditActions(AUDIT_READER)).toEqual(["dynamodb:Query"]);
  });

  it("no function can update or delete audit events", () => {
    for (const [name] of functions) {
      const actions = auditActions(name).join(",");
      expect(actions, name).not.toMatch(/Update|Delete|BatchWrite|\*/);
      const writeTemplates = policiesOf(name)
        .filter((policy) => !("Statement" in policy) && touchesAudit(policy))
        .filter((policy) => Object.keys(policy).some((key) => /Crud|Write/.test(key)));
      expect(writeTemplates, name).toEqual([]);
    }
  });

  it("functions that do not read or write audit events get no audit permission", () => {
    for (const [name] of functions.filter(([fn]) => ![...AUDIT_WRITERS, AUDIT_READER].includes(fn))) {
      expect(touchesAudit(policiesOf(name)), name).toBe(false);
    }
  });

  it("the audit table is protected against deletion", () => {
    expect(resources.AuditTable.Properties?.DeletionProtectionEnabled).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { STAGES, loadTemplate, lambdaFunctions, eventsOf, propertiesOf, resourcesOfType } from "./helpers/loadTemplate.js";

const MAX_ACCESS_TOKEN_MINUTES = 15;

describe.each(STAGES)("identity configuration in stage %s", (stage) => {
  const template = loadTemplate(stage);
  const [, userPool] = resourcesOfType(template, "AWS::Cognito::UserPool")[0];
  const [, userPoolClient] = resourcesOfType(template, "AWS::Cognito::UserPoolClient")[0];

  it("requires multi-factor authentication for every user", () => {
    expect(propertiesOf(userPool).MfaConfiguration).toBe("ON");
  });

  it("offers only an authenticator app as the second factor, never SMS", () => {
    expect(propertiesOf(userPool).EnabledMfas).toEqual(["SOFTWARE_TOKEN_MFA"]);
    expect(JSON.stringify(userPool)).not.toContain("SmsConfiguration");
  });

  it("defines the Cognito domain used by the hosted sign-in page", () => {
    const domains = resourcesOfType(template, "AWS::Cognito::UserPoolDomain");
    expect(domains).toHaveLength(1);
    expect(propertiesOf(domains[0][1]).Domain).toEqual({ Ref: "CognitoDomainPrefix" });
  });

  it("limits access and ID tokens to 15 minutes", () => {
    const client = propertiesOf(userPoolClient);
    expect(client.AccessTokenValidity).toBeLessThanOrEqual(MAX_ACCESS_TOKEN_MINUTES);
    expect(client.IdTokenValidity).toBeLessThanOrEqual(MAX_ACCESS_TOKEN_MINUTES);
    expect((client.TokenValidityUnits as Record<string, string>).AccessToken).toBe("minutes");
  });

  it("protects every non-public route with scopes of the access token", () => {
    const protectedRoutes = lambdaFunctions(template)
      .flatMap(([, definition]) => eventsOf(definition))
      .filter(([, event]) => event.Type === "HttpApi" && JSON.stringify(event).includes("NONE") === false);

    expect(protectedRoutes.length).toBeGreaterThan(0);
    for (const [, event] of protectedRoutes) {
      const auth = propertiesOf(event).Auth as { AuthorizationScopes?: string[] };
      expect(auth.AuthorizationScopes?.length).toBeGreaterThan(0);
    }
  });
});

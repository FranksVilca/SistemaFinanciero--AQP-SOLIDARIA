import { describe, it, expect } from "vitest";
import { resources, ofType } from "./support/cfnTemplate.js";

// T13 / CA-03.4 - static part. API Gateway JWT authorizers validate signature, issuer, audience
// and exp, but do NOT check Cognito revocation: a revoked access token is still accepted until it
// expires. This test only bounds that exposure window in the IaC; it does not claim the API
// rejects revoked tokens. The post-deploy procedure is in docs/threat-model.md (T13).

const MAX_MINUTES = 15;
const UNIT_MINUTES: Record<string, number> = { seconds: 1 / 60, minutes: 1, hours: 60, days: 1440 };

type ClientProps = {
  EnableTokenRevocation?: boolean;
  AccessTokenValidity?: number;
  IdTokenValidity?: number;
  TokenValidityUnits?: { AccessToken?: string; IdToken?: string };
};

// Cognito defaults to hours when TokenValidityUnits is omitted.
const minutesOf = (value: number | undefined, unit: string | undefined) =>
  value === undefined ? Infinity : value * UNIT_MINUTES[unit ?? "hours"];

const clients = ofType("AWS::Cognito::UserPoolClient").map(([name]) => name);

describe("T13 / CA-03.4 - short-lived tokens and revocation enabled (template)", () => {
  it("covers both the donor and the staff client", () => {
    expect([...clients].sort()).toEqual(["CognitoUserPoolClient", "StaffUserPoolClient"]);
  });

  it.each(clients)("%s issues access and ID tokens valid for at most 15 minutes", (client) => {
    const props = resources[client].Properties as ClientProps;
    const units = props.TokenValidityUnits ?? {};
    expect(minutesOf(props.AccessTokenValidity, units.AccessToken), client).toBeLessThanOrEqual(MAX_MINUTES);
    expect(minutesOf(props.IdTokenValidity, units.IdToken), client).toBeLessThanOrEqual(MAX_MINUTES);
  });

  it.each(clients)("%s enables refresh token revocation", (client) => {
    expect((resources[client].Properties as ClientProps).EnableTokenRevocation, client).toBe(true);
  });
});

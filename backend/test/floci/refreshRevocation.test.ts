import { randomUUID } from "node:crypto";
import {
  CreateGroupCommand,
  CreateResourceServerCommand,
  CreateUserPoolClientCommand,
  CreateUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { beforeAll, describe, expect, it } from "vitest";
import { revocationEndpointOf } from "../../../frontend/src/auth/revocation.js";
import { FLOCI_ENV } from "./flociEnv.js";
import { cognito, createUserInGroup, hostedSignIn, type HostedTokens, type PoolRef } from "./helpers/cognitoUsers.js";

/**
 * The mitigation for a stolen token (H9): signing out revokes the refresh token, and with it the access and ID tokens
 * minted from it. The SPA derives the revocation endpoint from the discovery document with the same function that
 * is imported here, so the URL it calls is the one that is exercised.
 */

const REDIRECT_URI = "http://localhost:3000/auth/callback";
const SCOPES = ["openid", "api/donations.read"];
const runId = randomUUID().slice(0, 8);
const username = `donor-${runId}@aqpsolidaria.pe`;
const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };

let pool: PoolRef;
let tokens: HostedTokens;

async function tokenEndpointFromDiscovery(): Promise<string> {
  const response = await fetch(`${FLOCI_ENV.FLOCI_ENDPOINT}/${pool.userPoolId}/.well-known/openid-configuration`);
  return String(((await response.json()) as { token_endpoint: string }).token_endpoint);
}

const refresh = (token: string) =>
  fetch(`${FLOCI_ENV.FLOCI_ENDPOINT}/cognito-idp/oauth2/token`, {
    method: "POST",
    headers: FORM_HEADERS,
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: pool.clientId, refresh_token: token }),
  });

const userInfo = (accessToken: string) =>
  fetch(`${FLOCI_ENV.FLOCI_ENDPOINT}/cognito-idp/oauth2/userInfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

beforeAll(async () => {
  const created = await cognito.send(
    new CreateUserPoolCommand({ PoolName: `revoke-${runId}`, UsernameAttributes: ["email"] })
  );
  const userPoolId = created.UserPool!.Id!;
  await cognito.send(
    new CreateResourceServerCommand({
      UserPoolId: userPoolId,
      Identifier: "api",
      Name: "api",
      Scopes: [{ ScopeName: "donations.read", ScopeDescription: "Read own donations" }],
    })
  );
  const client = await cognito.send(
    new CreateUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientName: "spa",
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: SCOPES,
      CallbackURLs: [REDIRECT_URI],
      SupportedIdentityProviders: ["COGNITO"],
    })
  );
  pool = { userPoolId, clientId: client.UserPoolClient!.ClientId! };
  await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: "DONANTE" }));
  await createUserInGroup(pool, username, "DONANTE");
  tokens = await hostedSignIn(pool, username, SCOPES, REDIRECT_URI);
});

describe("refresh token revocation at sign-out", () => {
  it("derives the revocation endpoint next to the token endpoint, not under the issuer", async () => {
    const tokenEndpoint = await tokenEndpointFromDiscovery();

    expect(revocationEndpointOf(tokenEndpoint)).toBe(tokenEndpoint.replace(/\/token$/, "/revoke"));
    expect(revocationEndpointOf(tokenEndpoint)).not.toContain(pool.userPoolId);
    expect(() => revocationEndpointOf("https://example.test/oauth2/other")).toThrow();
  });

  it("makes the refresh token, the access token and a new refresh unusable once revoked", async () => {
    expect((await userInfo(tokens.accessToken)).status).toBe(200);
    expect((await refresh(tokens.refreshToken)).status).toBe(200);

    // The discovery document advertises the https address of the emulator; the tests reach it over plain http.
    const revocationUrl = revocationEndpointOf(await tokenEndpointFromDiscovery()).replace(
      /^https:\/\/localhost:4566/,
      FLOCI_ENV.FLOCI_ENDPOINT
    );
    const revoked = await fetch(revocationUrl, {
      method: "POST",
      headers: FORM_HEADERS,
      body: new URLSearchParams({ token: tokens.refreshToken, client_id: pool.clientId }),
    });

    expect(revoked.status).toBe(200);
    const afterRevocation = await refresh(tokens.refreshToken);
    expect(afterRevocation.status).toBe(400);
    expect(((await afterRevocation.json()) as { error: string }).error).toBe("invalid_grant");
    expect((await userInfo(tokens.accessToken)).status).toBe(401);
  });
});

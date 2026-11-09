import { randomUUID } from "node:crypto";
import {
  CreateGroupCommand,
  CreateUserPoolClientCommand,
  CreateUserPoolCommand,
  SetUserPoolMfaConfigCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { StackResourceSummary } from "@aws-sdk/client-cloudformation";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cognito, createUserInGroup, hostedSignIn, obtainTokens, type PoolRef } from "./helpers/cognitoUsers.js";
import {
  STAGE,
  allowPasswordLogin,
  applyTemplateScopesToRoutes,
  invokeBaseUrl,
  pointAuthorizerAtEmulatorIssuer,
  routesOfTemplate,
  scopesByRouteKey,
  shortenAccessTokenLifetime,
  signInSettings,
  type Route,
} from "./helpers/gateway.js";
import { deleteStack, deployStack, physicalIdOf } from "./helpers/stack.js";
import { jwtPayload } from "./helpers/totp.js";

/**
 * The JWT authorizer of API Gateway (the PEP), deployed from infra/template.yaml into Floci and called over
 * HTTP with tokens issued by the emulated Cognito of the same stack.
 *
 * This suite needs no Docker socket, so the Lambdas do not run: a request that the authorizer accepts reaches the
 * integration and fails there with a 5xx. The authorizer's verdict is therefore the difference between 401/403
 * (rejected) and anything else (accepted). The full path with the Lambdas running is in e2e/fullStack.test.ts.
 */

const STACK = "zta-authorizer";
const REJECTED = [401, 403];
const runId = randomUUID().slice(0, 8);

let baseUrl: string;
let accessToken: string;
let idToken: string;
let tokenOfAnotherPool: string;
let stackPool: PoolRef;
let donorUsername: string;

const call = async (route: Route, token?: string): Promise<number> => {
  const response = await fetch(`${baseUrl}${route.path}`, {
    method: route.method,
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: route.method === "GET" ? undefined : "{}",
  });
  return response.status;
};

const base64Url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A second user pool: tokens of the same shape, but a different issuer and signing key. */
async function createUserOfAnotherPool(): Promise<string> {
  const other = await cognito.send(
    new CreateUserPoolCommand({ PoolName: `other-${runId}`, MfaConfiguration: "ON", UsernameAttributes: ["email"] })
  );
  const userPoolId = other.UserPool!.Id!;
  await cognito.send(
    new SetUserPoolMfaConfigCommand({
      UserPoolId: userPoolId,
      MfaConfiguration: "ON",
      SoftwareTokenMfaConfiguration: { Enabled: true },
    })
  );
  const client = await cognito.send(new CreateUserPoolClientCommand({ UserPoolId: userPoolId, ClientName: "other" }));
  const otherPool: PoolRef = { userPoolId, clientId: client.UserPoolClient!.ClientId! };
  await allowPasswordLogin(otherPool);
  await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: "DONANTE" }));
  const username = `other-${runId}@aqpsolidaria.pe`;
  await createUserInGroup(otherPool, username, "DONANTE");
  return (await obtainTokens(otherPool, username)).AccessToken!;
}

describe("API Gateway JWT authorizer (T02, T11)", () => {
  let resources: StackResourceSummary[];
  const protectedRoutes = routesOfTemplate().filter((route) => route.isProtected);
  const publicRoutes = routesOfTemplate().filter((route) => !route.isProtected);

  beforeAll(async () => {
    resources = await deployStack(STACK, { StageName: STAGE, CognitoDomainPrefix: `zta-authorizer-${runId}` });
    const apiId = physicalIdOf(resources, "AWS::ApiGatewayV2::Api");
    baseUrl = invokeBaseUrl(apiId);

    // A user of the stack's own pool, with its authenticator enrolled.
    stackPool = {
      userPoolId: physicalIdOf(resources, "AWS::Cognito::UserPool"),
      clientId: physicalIdOf(resources, "AWS::Cognito::UserPoolClient"),
    };
    await allowPasswordLogin(stackPool);
    donorUsername = `donor-${runId}@aqpsolidaria.pe`;
    await createUserInGroup(stackPool, donorUsername, "DONANTE");
    const tokens = await obtainTokens(stackPool, donorUsername);
    accessToken = tokens.AccessToken!;
    idToken = tokens.IdToken!;
    await pointAuthorizerAtEmulatorIssuer(apiId, accessToken);

    tokenOfAnotherPool = await createUserOfAnotherPool();
  });
  afterAll(() => deleteStack(STACK));

  it("exposes eight protected routes and three public ones, as the template declares", () => {
    expect(protectedRoutes).toHaveLength(8);
    expect(publicRoutes).toHaveLength(3);
  });

  it("issues access tokens and ID tokens that differ in their type", () => {
    expect(jwtPayload(accessToken).token_use).toBe("access");
    expect(jwtPayload(idToken).token_use).toBe("id");
  });

  it("rejects every protected route without a token with 401 (T02)", async () => {
    for (const route of protectedRoutes) {
      expect(await call(route), `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("rejects a forged token that is not even a JWT", async () => {
    for (const route of protectedRoutes) {
      expect(await call(route, "aaa.bbb.ccc"), `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("rejects a token whose payload was altered after it was signed", async () => {
    const [header, , signature] = accessToken.split(".");
    const forgedPayload = base64Url({ ...jwtPayload(accessToken), "cognito:groups": ["GESTOR", "AUDITOR"] });

    for (const route of protectedRoutes) {
      expect(await call(route, `${header}.${forgedPayload}.${signature}`), `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("rejects a token issued by a different user pool", async () => {
    for (const route of protectedRoutes) {
      expect(await call(route, tokenOfAnotherPool), `${route.method} ${route.path}`).toBe(401);
    }
  });

  it("accepts a genuine access token: the request gets past the authorizer", async () => {
    for (const route of protectedRoutes) {
      expect(REJECTED, `${route.method} ${route.path}`).not.toContain(await call(route, accessToken));
    }
  });

  it("lets the public routes through without a token", async () => {
    for (const route of publicRoutes) {
      expect(REJECTED, `${route.method} ${route.path}`).not.toContain(await call(route));
    }
  });

  describe("route scopes declared by the template", () => {
    let scopedAccessToken: string;

    beforeAll(async () => {
      await applyTemplateScopesToRoutes(physicalIdOf(resources, "AWS::ApiGatewayV2::Api"));
      // Signing in through the hosted login, as the SPA does, yields a token that carries the api/* scopes.
      const { scopes, redirectUri } = signInSettings();
      scopedAccessToken = (await hostedSignIn(stackPool, donorUsername, scopes, redirectUri)).accessToken;
    });

    it("accepts a token that carries the scopes of the routes (the happy path)", async () => {
      expect(String(jwtPayload(scopedAccessToken).scope)).toContain("api/donations.write");
      for (const route of protectedRoutes) {
        expect(REJECTED, `${route.method} ${route.path}`).not.toContain(await call(route, scopedAccessToken));
      }
    });

    it("declares a scope on every protected route and none on the public ones", () => {
      const declared = scopesByRouteKey();
      expect(Object.keys(declared)).toHaveLength(protectedRoutes.length);
      for (const scopes of Object.values(declared)) expect(scopes.length).toBeGreaterThan(0);
    });

    it("rejects an ID token with 403 on every protected route: it carries no scope", async () => {
      for (const route of protectedRoutes) {
        expect(await call(route, idToken), `${route.method} ${route.path}`).toBe(403);
      }
    });

    it("rejects an access token that lacks the scope of the route", async () => {
      // The emulator's sign-in API grants only aws.cognito.signin.user.admin, never the api/* scopes.
      for (const route of protectedRoutes) {
        expect(await call(route, accessToken), `${route.method} ${route.path}`).toBe(403);
      }
    });

    it("still lets the public routes through without a token", async () => {
      for (const route of publicRoutes) {
        expect(REJECTED, `${route.method} ${route.path}`).not.toContain(await call(route));
      }
    });

    it("rejects a token once its lifetime is over (expired token)", async () => {
      const lifetimeSeconds = 3;
      await shortenAccessTokenLifetime(stackPool, lifetimeSeconds);
      const { scopes, redirectUri } = signInSettings();
      const shortLived = (await hostedSignIn(stackPool, donorUsername, scopes, redirectUri)).accessToken;
      const route = protectedRoutes.find((candidate) => candidate.path === "/v1/donations/me")!;
      const claims = jwtPayload(shortLived);
      expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(lifetimeSeconds);

      expect(REJECTED, "just issued").not.toContain(await call(route, shortLived));

      await new Promise((resolveWait) => setTimeout(resolveWait, (lifetimeSeconds + 1) * 1000));
      expect(await call(route, shortLived), "after it expired").toBe(401);
    });
  });
});

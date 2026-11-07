import { randomUUID } from "node:crypto";
import {
  CreateUserPoolClientCommand,
  CreateUserPoolCommand,
  SetUserPoolMfaConfigCommand,
  UpdateUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { StackResourceSummary } from "@aws-sdk/client-cloudformation";
import {
  ApiGatewayV2Client,
  GetAuthorizersCommand,
  GetRoutesCommand,
  UpdateAuthorizerCommand,
  UpdateRouteCommand,
} from "@aws-sdk/client-apigatewayv2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  eventsOf,
  lambdaFunctions,
  loadTemplate,
  propertiesOf,
  type JsonObject,
} from "../infra/helpers/loadTemplate.js";
import { FLOCI_ENV } from "./flociEnv.js";
import { cognito, createUserInGroup, obtainTokens, type PoolRef } from "./helpers/cognitoUsers.js";
import { deleteStack, deployStack, physicalIdOf } from "./helpers/stack.js";
import { jwtPayload } from "./helpers/totp.js";

/**
 * The JWT authorizer of API Gateway (the PEP), deployed from infra/template.yaml into Floci and called over
 * HTTP with tokens issued by the emulated Cognito of the same stack.
 *
 * Floci cannot run the Lambdas (it would need the Docker socket), so a request that the authorizer accepts
 * reaches the integration and fails there with a 5xx. The authorizer's verdict is therefore the difference
 * between 401/403 (rejected) and anything else (accepted). It does not enforce the route scopes, so the
 * rejection of an ID token by the scope check, and a token that has expired, still need a real account; the
 * backend rejects ID tokens by itself (see idToken.test.ts).
 */

const STACK = "zta-authorizer";
const STAGE = "academic";
const REJECTED = [401, 403];
const runId = randomUUID().slice(0, 8);

interface Route {
  method: string;
  path: string;
  isProtected: boolean;
}

function routesOfTemplate(): Route[] {
  return lambdaFunctions(loadTemplate("academic")).flatMap(([, definition]) =>
    eventsOf(definition).map(([, event]) => {
      const properties = propertiesOf(event);
      const auth = (properties.Auth ?? {}) as JsonObject;
      return {
        method: String(properties.Method),
        path: String(properties.Path).replace(/\{\w+\}/g, "example"),
        isProtected: auth.Authorizer !== "NONE",
      };
    })
  );
}

let baseUrl: string;
let accessToken: string;
let idToken: string;
let tokenOfAnotherPool: string;

const call = async (route: Route, token?: string): Promise<number> => {
  const response = await fetch(`${baseUrl}${route.path}`, {
    method: route.method,
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: route.method === "GET" ? undefined : "{}",
  });
  return response.status;
};

const base64Url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/**
 * Floci signs its tokens with the issuer http://localhost:4566/<pool>, while the template gives the authorizer the
 * real AWS issuer (https://cognito-idp.<region>.amazonaws.com/<pool>). Only the issuer of the deployed authorizer is
 * pointed at the emulator; its type, audience and identity source stay exactly as the template declares them.
 */
async function pointAuthorizerAtEmulatorIssuer(apiId: string, tokenOfStackPool: string): Promise<void> {
  const gateway = new ApiGatewayV2Client({
    region: FLOCI_ENV.AWS_REGION,
    endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
    credentials: { accessKeyId: FLOCI_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: FLOCI_ENV.AWS_SECRET_ACCESS_KEY },
  });
  const { Items = [] } = await gateway.send(new GetAuthorizersCommand({ ApiId: apiId }));
  const authorizer = Items[0];
  await gateway.send(
    new UpdateAuthorizerCommand({
      ApiId: apiId,
      AuthorizerId: authorizer.AuthorizerId,
      JwtConfiguration: {
        Audience: authorizer.JwtConfiguration!.Audience,
        Issuer: String(jwtPayload(tokenOfStackPool).iss),
      },
    })
  );
}

/** Scopes that infra/template.yaml requires per route, keyed like the routes of the API ("POST /v1/donations"). */
function scopesByRouteKey(): Record<string, string[]> {
  const scopes: Record<string, string[]> = {};
  for (const [, definition] of lambdaFunctions(loadTemplate("academic"))) {
    for (const [, event] of eventsOf(definition)) {
      const properties = propertiesOf(event);
      const declared = ((properties.Auth ?? {}) as JsonObject).AuthorizationScopes as string[] | undefined;
      if (declared) scopes[`${properties.Method} ${properties.Path}`] = declared;
    }
  }
  return scopes;
}

/**
 * Floci does not copy the AuthorizationScopes of the SAM routes into the routes it creates (they come out empty),
 * although it does enforce them once they are set. The scopes that the template declares are applied here, so the
 * scope check that rejects ID tokens in real API Gateway can be exercised.
 */
async function applyTemplateScopesToRoutes(apiId: string): Promise<void> {
  const gateway = new ApiGatewayV2Client({
    region: FLOCI_ENV.AWS_REGION,
    endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
    credentials: { accessKeyId: FLOCI_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: FLOCI_ENV.AWS_SECRET_ACCESS_KEY },
  });
  const declared = scopesByRouteKey();
  const { Items = [] } = await gateway.send(new GetRoutesCommand({ ApiId: apiId }));
  for (const route of Items.filter((candidate) => candidate.RouteKey && candidate.RouteKey in declared)) {
    await gateway.send(
      new UpdateRouteCommand({ ApiId: apiId, RouteId: route.RouteId, AuthorizationScopes: declared[route.RouteKey!] })
    );
  }
}

async function allowPasswordLogin(pool: PoolRef): Promise<void> {
  await cognito.send(
    new UpdateUserPoolClientCommand({
      UserPoolId: pool.userPoolId,
      ClientId: pool.clientId,
      ExplicitAuthFlows: ["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
    })
  );
}

describe("API Gateway JWT authorizer (T02, T11)", () => {
  let resources: StackResourceSummary[];
  const protectedRoutes = routesOfTemplate().filter((route) => route.isProtected);
  const publicRoutes = routesOfTemplate().filter((route) => !route.isProtected);

  beforeAll(async () => {
    resources = await deployStack(STACK, { StageName: STAGE, CognitoDomainPrefix: `zta-authorizer-${runId}` });
    baseUrl = `${FLOCI_ENV.FLOCI_ENDPOINT}/restapis/${physicalIdOf(resources, "AWS::ApiGatewayV2::Api")}/${STAGE}/_user_request_`;

    // A user of the stack's own pool, with its authenticator enrolled.
    const pool: PoolRef = {
      userPoolId: physicalIdOf(resources, "AWS::Cognito::UserPool"),
      clientId: physicalIdOf(resources, "AWS::Cognito::UserPoolClient"),
    };
    await allowPasswordLogin(pool);
    const username = `donor-${runId}@aqpsolidaria.pe`;
    await createUserInGroup(pool, username, "DONANTE");
    const tokens = await obtainTokens(pool, username);
    accessToken = tokens.AccessToken!;
    idToken = tokens.IdToken!;
    await pointAuthorizerAtEmulatorIssuer(physicalIdOf(resources, "AWS::ApiGatewayV2::Api"), accessToken);

    // A user of a different pool: same shape of token, different issuer and signing key.
    const other = await cognito.send(
      new CreateUserPoolCommand({ PoolName: `other-${runId}`, MfaConfiguration: "ON", UsernameAttributes: ["email"] })
    );
    await cognito.send(
      new SetUserPoolMfaConfigCommand({
        UserPoolId: other.UserPool!.Id!,
        MfaConfiguration: "ON",
        SoftwareTokenMfaConfiguration: { Enabled: true },
      })
    );
    const otherClient = await cognito.send(
      new CreateUserPoolClientCommand({ UserPoolId: other.UserPool!.Id!, ClientName: "other" })
    );
    const otherPool: PoolRef = { userPoolId: other.UserPool!.Id!, clientId: otherClient.UserPoolClient!.ClientId! };
    await allowPasswordLogin(otherPool);
    await cognito.send(new CreateUserPoolClientCommand({ UserPoolId: otherPool.userPoolId, ClientName: "unused" }));
    const { CreateGroupCommand } = await import("@aws-sdk/client-cognito-identity-provider");
    await cognito.send(new CreateGroupCommand({ UserPoolId: otherPool.userPoolId, GroupName: "DONANTE" }));
    const otherUser = `other-${runId}@aqpsolidaria.pe`;
    await createUserInGroup(otherPool, otherUser, "DONANTE");
    tokenOfAnotherPool = (await obtainTokens(otherPool, otherUser)).AccessToken!;
  });
  afterAll(() => deleteStack(STACK));

  it("exposes six protected routes and three public ones, as the template declares", () => {
    expect(protectedRoutes).toHaveLength(6);
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
    beforeAll(async () => {
      await applyTemplateScopesToRoutes(physicalIdOf(resources, "AWS::ApiGatewayV2::Api"));
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
  });
});

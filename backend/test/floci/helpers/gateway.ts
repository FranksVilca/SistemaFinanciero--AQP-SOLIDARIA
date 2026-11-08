import {
  ApiGatewayV2Client,
  GetAuthorizersCommand,
  GetRoutesCommand,
  UpdateAuthorizerCommand,
  UpdateRouteCommand,
} from "@aws-sdk/client-apigatewayv2";
import {
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
  type UpdateUserPoolClientCommandInput,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  eventsOf,
  lambdaFunctions,
  loadTemplate,
  propertiesOf,
  resourcesOfType,
  type JsonObject,
} from "../../infra/helpers/loadTemplate.js";
import { FLOCI_ENV } from "../flociEnv.js";
import { cognito, type PoolRef } from "./cognitoUsers.js";
import { jwtPayload } from "./totp.js";

export const STAGE = "academic";

export interface Route {
  method: string;
  /** Path as the template declares it, for example /v1/projects/{projectId}. */
  templatePath: string;
  /** Path with the parameters replaced by a sample value. */
  path: string;
  isProtected: boolean;
}

const gateway = new ApiGatewayV2Client({
  region: FLOCI_ENV.AWS_REGION,
  endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
  credentials: { accessKeyId: FLOCI_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: FLOCI_ENV.AWS_SECRET_ACCESS_KEY },
});

export function routesOfTemplate(): Route[] {
  return lambdaFunctions(loadTemplate("academic")).flatMap(([, definition]) =>
    eventsOf(definition).map(([, event]) => {
      const properties = propertiesOf(event);
      const auth = (properties.Auth ?? {}) as JsonObject;
      return {
        method: String(properties.Method),
        templatePath: String(properties.Path),
        path: String(properties.Path).replace(/\{\w+\}/g, "example"),
        isProtected: auth.Authorizer !== "NONE",
      };
    })
  );
}

/** URL under which Floci serves the HTTP API of a stack. */
export const invokeBaseUrl = (apiId: string): string =>
  `${FLOCI_ENV.FLOCI_ENDPOINT}/restapis/${apiId}/${STAGE}/_user_request_`;

/**
 * Floci signs its tokens with the issuer https://localhost:4566/<pool>, while the template gives the authorizer the
 * real AWS issuer (https://cognito-idp.<region>.amazonaws.com/<pool>). Only the issuer of the deployed authorizer is
 * pointed at the emulator; its type, audience and identity source stay exactly as the template declares them.
 */
export async function pointAuthorizerAtEmulatorIssuer(apiId: string, tokenOfStackPool: string): Promise<void> {
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
export function scopesByRouteKey(): Record<string, string[]> {
  const scopes: Record<string, string[]> = {};
  for (const route of lambdaFunctions(loadTemplate("academic")).flatMap(([, definition]) => eventsOf(definition))) {
    const properties = propertiesOf(route[1]);
    const declared = ((properties.Auth ?? {}) as JsonObject).AuthorizationScopes as string[] | undefined;
    if (declared) scopes[`${properties.Method} ${properties.Path}`] = declared;
  }
  return scopes;
}

/**
 * Floci does not copy the AuthorizationScopes of the SAM routes into the routes it creates (they come out empty),
 * although it does enforce them once they are set. The scopes that the template declares are applied here, so the
 * scope check that rejects ID tokens in real API Gateway can be exercised.
 */
export async function applyTemplateScopesToRoutes(apiId: string): Promise<void> {
  const declared = scopesByRouteKey();
  const { Items = [] } = await gateway.send(new GetRoutesCommand({ ApiId: apiId }));
  for (const route of Items.filter((candidate) => candidate.RouteKey && candidate.RouteKey in declared)) {
    await gateway.send(
      new UpdateRouteCommand({ ApiId: apiId, RouteId: route.RouteId, AuthorizationScopes: declared[route.RouteKey!] })
    );
  }
}

const KEPT_CLIENT_SETTINGS = [
  "ClientName",
  "AccessTokenValidity",
  "IdTokenValidity",
  "RefreshTokenValidity",
  "TokenValidityUnits",
  "ExplicitAuthFlows",
  "SupportedIdentityProviders",
  "CallbackURLs",
  "LogoutURLs",
  "DefaultRedirectURI",
  "AllowedOAuthFlows",
  "AllowedOAuthScopes",
  "AllowedOAuthFlowsUserPoolClient",
  "PreventUserExistenceErrors",
  "EnableTokenRevocation",
] as const;

/**
 * UpdateUserPoolClient resets whatever is not sent, so every update starts from the settings the client has now and
 * changes only what the test needs.
 */
async function updateClient(
  pool: PoolRef,
  change: (current: UpdateUserPoolClientCommandInput) => Partial<UpdateUserPoolClientCommandInput>
): Promise<void> {
  const { UserPoolClient: client } = await cognito.send(
    new DescribeUserPoolClientCommand({ UserPoolId: pool.userPoolId, ClientId: pool.clientId })
  );
  const current = Object.fromEntries(
    KEPT_CLIENT_SETTINGS.map((setting) => [setting, client?.[setting]])
  ) as unknown as UpdateUserPoolClientCommandInput;
  await cognito.send(
    new UpdateUserPoolClientCommand({
      ...current,
      ...change(current),
      UserPoolId: pool.userPoolId,
      ClientId: pool.clientId,
    })
  );
}

/** The client of the stack"s pool only allows the hosted sign-in; the tests also sign in through the admin API. */
export async function allowPasswordLogin(pool: PoolRef): Promise<void> {
  await updateClient(pool, (current) => ({
    ExplicitAuthFlows: [...new Set([...(current.ExplicitAuthFlows ?? []), "ALLOW_ADMIN_USER_PASSWORD_AUTH"])],
  }));
}

/** Gives the access tokens of the pool"s client a lifetime of a few seconds (the emulator must allow it, see docker-compose.yml). */
export async function shortenAccessTokenLifetime(pool: PoolRef, seconds: number): Promise<void> {
  await updateClient(pool, (current) => ({
    AccessTokenValidity: seconds,
    TokenValidityUnits: { ...current.TokenValidityUnits, AccessToken: "seconds" },
  }));
}

/** What the SPA asks for when it signs in: the OAuth scopes the client may request and its local callback URL. */
export function signInSettings(): { scopes: string[]; redirectUri: string } {
  const client = propertiesOf(resourcesOfType(loadTemplate("academic"), "AWS::Cognito::UserPoolClient")[0][1]);
  const redirectUri = (client.CallbackURLs as unknown[]).find(
    (url): url is string => typeof url === "string" && url.startsWith("http://localhost")
  );
  if (!redirectUri) throw new Error("The academic stage declares no localhost callback URL");
  return { scopes: client.AllowedOAuthScopes as string[], redirectUri };
}

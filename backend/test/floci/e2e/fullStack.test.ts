import { randomUUID } from "node:crypto";
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { StackResourceSummary } from "@aws-sdk/client-cloudformation";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FLOCI_ENV } from "../flociEnv.js";
import { cognito, createUserInGroup, hostedSignIn, obtainTokens, type PoolRef } from "../helpers/cognitoUsers.js";
import {
  STAGE,
  allowPasswordLogin,
  applyTemplateScopesToRoutes,
  invokeBaseUrl,
  pointAuthorizerAtEmulatorIssuer,
  signInSettings,
} from "../helpers/gateway.js";
import { prepareFunctions } from "../helpers/functions.js";
import { packageFunctions } from "../helpers/packageFunctions.js";
import { countOf, deleteStack, deployStack, physicalIdOf } from "../helpers/stack.js";
import { jwtPayload } from "../helpers/totp.js";

/**
 * The whole path with nothing mocked: HTTP request → API Gateway JWT authorizer with the scopes of each route → the
 * real Lambda code running in a Docker container with its own IAM role (the inline policy that infra/template.yaml
 * gives it) → DynamoDB → audit table, with users and tokens from the emulated Cognito. Everything is deployed from
 * infra/template.yaml, and users sign in through the hosted login as the SPA does, so their tokens carry the api/*
 * scopes.
 *
 * Needs a Floci that can reach the Docker socket (docker-compose.lambda.yml): `npm run test:floci:e2e`.
 */

const STACK = "zta-e2e";
const runId = randomUUID().slice(0, 8);
const DONATION_CENTS = 6_000;
interface ApiResult<T = Record<string, unknown>> {
  status: number;
  body: T;
}

let baseUrl: string;
let userPoolId: string;
const scoped: Record<string, { access: string; id: string; sub: string }> = {};

async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<ApiResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(options.token && { Authorization: `Bearer ${options.token}` }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON (for example the plain text of a gateway rejection): keep the raw text.
  }
  return { status: response.status, body: body as T };
}

async function signUp(pool: PoolRef, label: string, group: string): Promise<string> {
  const username = `${label}-${runId}@aqpsolidaria.pe`;
  await createUserInGroup(pool, username, group);
  const { scopes, redirectUri } = signInSettings();
  const signedIn = await hostedSignIn(pool, username, scopes, redirectUri);
  scoped[label] = {
    access: signedIn.accessToken,
    id: signedIn.idToken,
    sub: String(jwtPayload(signedIn.accessToken).sub),
  };
  return username;
}

describe("full stack: gateway, authorizer, Lambda with its IAM role, DynamoDB and audit", () => {
  let resources: StackResourceSummary[];
  let apiId: string;
  let projectId: string;
  let donationId: string;
  let adminSignInIdToken: string;
  const idempotencyKey = randomUUID();

  beforeAll(async () => {
    const code = await packageFunctions();
    resources = await deployStack(STACK, { StageName: STAGE, CognitoDomainPrefix: `zta-e2e-${runId}` });
    apiId = physicalIdOf(resources, "AWS::ApiGatewayV2::Api");
    userPoolId = physicalIdOf(resources, "AWS::Cognito::UserPool");
    baseUrl = invokeBaseUrl(apiId);
    await prepareFunctions(resources, code);

    const pool: PoolRef = { userPoolId, clientId: physicalIdOf(resources, "AWS::Cognito::UserPoolClient") };
    await allowPasswordLogin(pool);
    const donorUsername = await signUp(pool, "donor", "DONANTE");
    await signUp(pool, "otherdonor", "DONANTE");
    await signUp(pool, "manager", "GESTOR");
    await signUp(pool, "auditor", "AUDITOR");
    await pointAuthorizerAtEmulatorIssuer(apiId, scoped.donor.access);
    // The admin sign-in API issues tokens without api/* scopes, useful as "a valid token that lacks the scope".
    adminSignInIdToken = (await obtainTokens(pool, donorUsername)).IdToken!;
  });
  afterAll(() => deleteStack(STACK));

  describe("before the route scopes are applied: the backend is the second layer", () => {
    it("deploys the eleven API functions, the registration trigger and the review expiry job", async () => {
      // 9 original API functions + 2 of the review flow (list and decide) + the Cognito trigger + the daily expiry job.
      expect(countOf(resources, "AWS::Lambda::Function")).toBe(13);

      const list = await api<unknown[]>("GET", "/v1/projects");
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);
    });

    it("rejects an ID token in the backend even though the gateway let it through", async () => {
      const response = await api("GET", "/v1/donations/me", { token: adminSignInIdToken });

      expect(response.status).toBe(401);
    });
  });

  describe("with the route scopes declared by the template", () => {
    beforeAll(async () => {
      await applyTemplateScopesToRoutes(apiId);
    });

    it("answers 401 at the gateway without a token", async () => {
      expect((await api("POST", "/v1/donations", { body: {} })).status).toBe(401);
      expect((await api("GET", "/v1/audit")).status).toBe(401);
    });

    it("answers 403 at the gateway to an ID token and to an access token without the route scope", async () => {
      expect((await api("GET", "/v1/donations/me", { token: scoped.donor.id })).status).toBe(403);
      expect((await api("GET", "/v1/donations/me", { token: adminSignInIdToken })).status).toBe(403);
    });

    it("lets a manager create and publish a project, and refuses a donor (403)", async () => {
      const project = {
        title: "Agua para Chivay",
        description: "Instalar un sistema de agua potable",
        goalAmountCents: 100_000,
      };

      expect((await api("POST", "/v1/projects", { token: scoped.donor.access, body: project })).status).toBe(403);

      const created = await api("POST", "/v1/projects", { token: scoped.manager.access, body: project });
      expect(created.status).toBe(201);
      projectId = String(created.body.projectId);

      const published = await api("PATCH", `/v1/projects/${projectId}/publish`, { token: scoped.manager.access });
      expect(published.status).toBe(200);
      expect(published.body.status).toBe("PUBLICADO");
    });

    it("shows the published project to everyone, without any donor identity", async () => {
      const list = await api<Array<Record<string, unknown>>>("GET", "/v1/projects");

      expect(list.status).toBe(200);
      expect(list.body.map((item) => item.projectId)).toEqual([projectId]);
      expect(JSON.stringify(list.body)).not.toContain("donorSub");
    });

    it("creates a donation once per idempotency key (201, replay, 409, 400)", async () => {
      const send = (amountCents: number, key: string = idempotencyKey) =>
        api("POST", "/v1/donations", {
          token: scoped.donor.access,
          headers: key ? { "Idempotency-Key": key } : {},
          body: { projectId, amountCents },
        });

      const first = await send(DONATION_CENTS);
      expect(first.status).toBe(201);
      donationId = String(first.body.donationId);

      const replay = await send(DONATION_CENTS);
      expect(replay.status).toBe(201);
      expect(replay.body.donationId).toBe(donationId);

      expect((await send(DONATION_CENTS + 100)).status).toBe(409);
      expect((await send(-1, randomUUID())).status).toBe(400);
      expect((await send(DONATION_CENTS, "")).status).toBe(400);
    });

    it("protects a donation from another donor (403) and lets its owner confirm it once", async () => {
      const confirm = (token: string) =>
        api("POST", `/v1/donations/${donationId}/simulate`, { token, body: { action: "CONFIRMAR" } });

      expect((await confirm(scoped.otherdonor.access)).status).toBe(403);
      expect((await confirm(scoped.manager.access)).status).toBe(403);

      const confirmed = await confirm(scoped.donor.access);
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe("CONFIRMADA_SIMULADA");
      expect((await confirm(scoped.donor.access)).status).toBe(409);

      const stats = await api("GET", `/v1/projects/${projectId}/stats`);
      expect(stats.body.confirmedAmountCents).toBe(DONATION_CENTS);
    });

    it("returns each donor only their own history", async () => {
      const mine = await api<Array<Record<string, unknown>>>("GET", "/v1/donations/me", { token: scoped.donor.access });
      const others = await api<Array<Record<string, unknown>>>("GET", "/v1/donations/me", {
        token: scoped.otherdonor.access,
      });

      expect(mine.body.map((item) => item.donationId)).toEqual([donationId]);
      expect(others.body).toEqual([]);
    });

    it("gives the auditor a pseudonymized trail of successes and denials, and nobody else", async () => {
      const trail = await api<Array<Record<string, unknown>>>("GET", "/v1/audit", { token: scoped.auditor.access });

      expect(trail.status).toBe(200);
      const events = trail.body.map((event) => `${event.eventType}:${event.outcome}`);
      expect(events).toEqual(
        expect.arrayContaining([
          "PROJECT_CREATED:SUCCESS",
          "PROJECT_PUBLISHED:SUCCESS",
          "DONATION_CREATED:SUCCESS",
          "DONATION_TRANSITIONED:SUCCESS",
          "AUTHZ_DECISION:DENIED",
        ])
      );
      for (const user of Object.values(scoped)) expect(JSON.stringify(trail.body)).not.toContain(user.sub);

      expect((await api("GET", "/v1/audit", { token: scoped.donor.access })).status).toBe(403);
      expect((await api("GET", "/v1/audit", { token: scoped.manager.access })).status).toBe(403);
    });

    it("makes a newly registered user a donor through the Cognito trigger, and records it", async () => {
      const username = `newcomer-${runId}@aqpsolidaria.pe`;
      await cognito.send(
        new AdminCreateUserCommand({ UserPoolId: userPoolId, Username: username, MessageAction: "SUPPRESS" })
      );
      const functionName = resources.find(
        (resource) => resource.LogicalResourceId === "AddDonorToGroupFunction"
      )!.PhysicalResourceId!;
      // What Cognito sends when a registration is confirmed.
      const event = {
        triggerSource: "PostConfirmation_ConfirmSignUp",
        userPoolId,
        userName: username,
        request: { userAttributes: { sub: randomUUID() } },
      };

      const lambda = new LambdaClient({
        region: FLOCI_ENV.AWS_REGION,
        endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
        credentials: { accessKeyId: FLOCI_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: FLOCI_ENV.AWS_SECRET_ACCESS_KEY },
      });
      const result = await lambda.send(
        new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify(event)) })
      );

      expect(result.FunctionError).toBeUndefined();
      const { Groups = [] } = await cognito.send(
        new AdminListGroupsForUserCommand({ UserPoolId: userPoolId, Username: username })
      );
      expect(Groups.map((group) => group.GroupName)).toEqual(["DONANTE"]);
      const trail = await api<Array<Record<string, unknown>>>("GET", "/v1/audit", { token: scoped.auditor.access });
      expect(trail.body.map((item) => `${item.eventType}:${item.outcome}`)).toContain("ROLE_ASSIGNED:SUCCESS");
    });

    it("rejects a sensitive action once the role was removed, although the token still carries it", async () => {
      const identity = { UserPoolId: userPoolId, Username: `auditor-${runId}@aqpsolidaria.pe`, GroupName: "AUDITOR" };
      expect((await api("GET", "/v1/audit", { token: scoped.auditor.access })).status).toBe(200);

      await cognito.send(new AdminRemoveUserFromGroupCommand(identity));
      try {
        // The same access token, whose groups claim still says AUDITOR: the function asks Cognito for the current ones.
        expect((await api("GET", "/v1/audit", { token: scoped.auditor.access })).status).toBe(403);
      } finally {
        await cognito.send(new AdminAddUserToGroupCommand(identity));
      }

      expect((await api("GET", "/v1/audit", { token: scoped.auditor.access })).status).toBe(200);
    });

    it("rejects a sensitive action once the session was revoked, although the token has not expired (T13)", async () => {
      expect((await api("GET", "/v1/audit", { token: scoped.auditor.access })).status).toBe(200);

      await cognito.send(
        new AdminUserGlobalSignOutCommand({ UserPoolId: userPoolId, Username: `auditor-${runId}@aqpsolidaria.pe` })
      );

      expect((await api("GET", "/v1/audit", { token: scoped.auditor.access })).status).toBe(401);
    });
  });
});

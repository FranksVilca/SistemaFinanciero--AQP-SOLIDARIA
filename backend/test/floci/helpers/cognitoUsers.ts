import { createHash, randomBytes } from "node:crypto";
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminSetUserPasswordCommand,
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  VerifySoftwareTokenCommand,
  type AuthenticationResultType,
} from "@aws-sdk/client-cognito-identity-provider";
import { FLOCI_ENV } from "../flociEnv.js";
import { jwtPayload, totpCode } from "./totp.js";

export const PASSWORD = "Passw0rd!x";

export interface PoolRef {
  userPoolId: string;
  clientId: string;
}

export const cognito = new CognitoIdentityProviderClient({
  region: FLOCI_ENV.AWS_REGION,
  endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
  credentials: { accessKeyId: FLOCI_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: FLOCI_ENV.AWS_SECRET_ACCESS_KEY },
});

/** Creates a confirmed user with a permanent password and puts it in the group. */
export async function createUserInGroup(pool: PoolRef, username: string, group: string): Promise<void> {
  await cognito.send(
    new AdminCreateUserCommand({ UserPoolId: pool.userPoolId, Username: username, MessageAction: "SUPPRESS" })
  );
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: pool.userPoolId,
      Username: username,
      Password: PASSWORD,
      Permanent: true,
    })
  );
  await cognito.send(
    new AdminAddUserToGroupCommand({ UserPoolId: pool.userPoolId, Username: username, GroupName: group })
  );
}

export const login = (pool: PoolRef, username: string) =>
  cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: pool.userPoolId,
      ClientId: pool.clientId,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: username, PASSWORD: PASSWORD },
    })
  );

/** Enrolls an authenticator app for the user and returns the tokens issued when the enrollment completes. */
export async function enrollAuthenticator(
  pool: PoolRef,
  username: string
): Promise<{ secret: string; tokens: AuthenticationResultType }> {
  const setup = await login(pool, username);
  const association = await cognito.send(new AssociateSoftwareTokenCommand({ Session: setup.Session }));
  const verification = await cognito.send(
    new VerifySoftwareTokenCommand({ Session: association.Session, UserCode: totpCode(association.SecretCode!) })
  );
  const completed = await cognito.send(
    new AdminRespondToAuthChallengeCommand({
      UserPoolId: pool.userPoolId,
      ClientId: pool.clientId,
      ChallengeName: "MFA_SETUP",
      Session: verification.Session,
      ChallengeResponses: { USERNAME: setup.ChallengeParameters!.USERNAME },
    })
  );
  return { secret: association.SecretCode!, tokens: completed.AuthenticationResult! };
}

/** The claims that the HTTP API authorizer would pass to the Lambda for a verified token. */
export function gatewayClaims(token: string): Record<string, unknown> {
  const payload = jwtPayload(token);
  const groups = payload["cognito:groups"] as string[] | undefined;
  // API Gateway delivers array claims as a bracketed string such as "[DONANTE GESTOR]".
  return { ...payload, ...(groups && { "cognito:groups": `[${groups.join(" ")}]` }) };
}

/**
 * Tokens for a user: straight from the login when the pool does not require a second factor (the user pool that
 * Floci creates from a CloudFormation stack does not enable the authenticator app), otherwise through enrollment.
 */
export async function obtainTokens(pool: PoolRef, username: string): Promise<AuthenticationResultType> {
  const first = await login(pool, username);
  if (first.AuthenticationResult) return first.AuthenticationResult;
  return (await enrollAuthenticator(pool, username)).tokens;
}

export interface HostedTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

const FORM_HEADERS = { "Content-Type": "application/x-www-form-urlencoded" };

function cookiesOf(response: Response): string[] {
  return (response.headers.getSetCookie?.() ?? []).map((cookie) => cookie.split(";")[0]);
}

/**
 * Signs a user in through the hosted login the way the SPA does: authorization code with PKCE, a login form with its
 * CSRF token, then the code exchange. Unlike the admin sign-in API, the access token carries the OAuth scopes that were
 * requested (for example api/donations.write), which is what the scopes of the API routes check.
 */
export async function hostedSignIn(
  pool: PoolRef,
  username: string,
  scopes: string[],
  redirectUri: string
): Promise<HostedTokens> {
  const oauth = `${FLOCI_ENV.FLOCI_ENDPOINT}/cognito-idp`;
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URLSearchParams({
    client_id: pool.clientId,
    response_type: "code",
    scope: scopes.join(" "),
    redirect_uri: redirectUri,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: randomBytes(8).toString("hex"),
  });

  const started = await fetch(`${oauth}/oauth2/authorize?${authorize}`, { redirect: "manual" });
  const location = started.headers.get("location");
  if (!location) {
    const detail = (await started.text()).replace(/s+/g, " ").slice(0, 300);
    throw new Error(`The authorization request of ${username} was refused (HTTP ${started.status}): ${detail}`);
  }
  const loginUrl = new URL(location, FLOCI_ENV.FLOCI_ENDPOINT);
  const cookies = cookiesOf(started);
  const page = await fetch(loginUrl, { headers: { cookie: cookies.join("; ") } });
  const hiddenFields = Object.fromEntries(
    [...(await page.text()).matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((match) => [
      match[1],
      match[2],
    ])
  );

  const submitted = await fetch(`${oauth}/login`, {
    method: "POST",
    headers: { ...FORM_HEADERS, cookie: [...cookies, ...cookiesOf(page)].join("; ") },
    body: new URLSearchParams({ ...hiddenFields, username, password: PASSWORD }),
    redirect: "manual",
  });
  const code = new URL(submitted.headers.get("location") ?? "", redirectUri).searchParams.get("code");
  if (!code) {
    const detail = (await submitted.text()).replace(/s+/g, " ").slice(0, 300);
    throw new Error(
      `Hosted sign-in of ${username} returned no authorization code (HTTP ${submitted.status}): ${detail}`
    );
  }

  const exchanged = await fetch(`${oauth}/oauth2/token`, {
    method: "POST",
    headers: FORM_HEADERS,
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: pool.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const body = (await exchanged.json()) as Record<string, string>;
  return { accessToken: body.access_token, idToken: body.id_token, refreshToken: body.refresh_token };
}

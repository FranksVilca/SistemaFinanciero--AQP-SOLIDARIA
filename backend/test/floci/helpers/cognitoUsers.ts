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

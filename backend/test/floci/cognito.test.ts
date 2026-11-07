import { randomUUID } from "node:crypto";
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminSetUserPasswordCommand,
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  CreateGroupCommand,
  CreateUserPoolClientCommand,
  CreateUserPoolCommand,
  SetUserPoolMfaConfigCommand,
  VerifySoftwareTokenCommand,
  type AuthenticationResultType,
} from "@aws-sdk/client-cognito-identity-provider";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { handler as getMyDonations } from "../../src/donations/getMyDonations.js";
import { loadTemplate, propertiesOf, resourcesOfType } from "../infra/helpers/loadTemplate.js";
import { buildEvent } from "../integration/helpers/events.js";
import { clearAllTables, seedProject } from "../integration/helpers/seed.js";
import { FLOCI_ENV } from "./flociEnv.js";
import { jwtPayload, totpCode } from "./helpers/totp.js";

/**
 * T11 and T14 against an emulated Cognito. The user pool is built from the MFA settings of
 * infra/template.yaml; the claims of the tokens it issues are then given to the real handlers, the way the
 * HTTP API hands the verified claims of a JWT to a Lambda. What the emulator cannot do is run the JWT
 * authorizer of API Gateway: that rejection (and the scopes check) still needs a real account.
 */

const PASSWORD = "Passw0rd!x";
const ROLES = ["DONANTE", "GESTOR", "AUDITOR"] as const;
type Role = (typeof ROLES)[number];

const cognito = new CognitoIdentityProviderClient({
  region: FLOCI_ENV.AWS_REGION,
  endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
  credentials: { accessKeyId: FLOCI_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: FLOCI_ENV.AWS_SECRET_ACCESS_KEY },
});

let userPoolId: string;
let clientId: string;

const usernameOf = (role: Role) => `${role.toLowerCase()}-${runId}@aqpsolidaria.pe`;
const runId = randomUUID().slice(0, 8);

const login = (role: Role) =>
  cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: { USERNAME: usernameOf(role), PASSWORD: PASSWORD },
    })
  );

/** Enrolls an authenticator app for the user and returns the tokens issued when the enrollment completes. */
async function enrollAuthenticator(role: Role): Promise<{ secret: string; tokens: AuthenticationResultType }> {
  const setup = await login(role);
  const association = await cognito.send(new AssociateSoftwareTokenCommand({ Session: setup.Session }));
  const verification = await cognito.send(
    new VerifySoftwareTokenCommand({ Session: association.Session, UserCode: totpCode(association.SecretCode!) })
  );
  const completed = await cognito.send(
    new AdminRespondToAuthChallengeCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      ChallengeName: "MFA_SETUP",
      Session: verification.Session,
      ChallengeResponses: { USERNAME: setup.ChallengeParameters!.USERNAME },
    })
  );
  return { secret: association.SecretCode!, tokens: completed.AuthenticationResult! };
}

/** The claims that the HTTP API authorizer would pass to the Lambda for a verified token. */
function gatewayClaims(token: string): Record<string, unknown> {
  const payload = jwtPayload(token);
  const groups = payload["cognito:groups"] as string[] | undefined;
  // API Gateway delivers array claims as a bracketed string such as "[DONANTE GESTOR]".
  return { ...payload, ...(groups && { "cognito:groups": `[${groups.join(" ")}]` }) };
}

const eventWithClaims = (claims: Record<string, unknown>, extra: Parameters<typeof buildEvent>[0] = {}) => ({
  ...buildEvent(extra),
  requestContext: { requestId: `req-${randomUUID()}`, authorizer: { jwt: { claims } } },
});

beforeAll(async () => {
  const template = loadTemplate("academic");
  const pool = propertiesOf(resourcesOfType(template, "AWS::Cognito::UserPool")[0][1]);

  const created = await cognito.send(
    new CreateUserPoolCommand({
      PoolName: `zta-${runId}`,
      MfaConfiguration: pool.MfaConfiguration as "ON",
      UsernameAttributes: ["email"],
    })
  );
  userPoolId = created.UserPool!.Id!;
  await cognito.send(
    new SetUserPoolMfaConfigCommand({
      UserPoolId: userPoolId,
      MfaConfiguration: pool.MfaConfiguration as "ON",
      SoftwareTokenMfaConfiguration: { Enabled: (pool.EnabledMfas as string[]).includes("SOFTWARE_TOKEN_MFA") },
    })
  );
  const client = await cognito.send(
    new CreateUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientName: "spa",
      ExplicitAuthFlows: ["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
    })
  );
  clientId = client.UserPoolClient!.ClientId!;

  for (const role of ROLES) {
    await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: role }));
    await cognito.send(
      new AdminCreateUserCommand({ UserPoolId: userPoolId, Username: usernameOf(role), MessageAction: "SUPPRESS" })
    );
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: usernameOf(role),
        Password: PASSWORD,
        Permanent: true,
      })
    );
    await cognito.send(
      new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: usernameOf(role), GroupName: role })
    );
  }
});

describe("mandatory second factor (T14)", () => {
  it.each(ROLES)("a %s without a second factor receives no tokens, only the enrollment challenge", async (role) => {
    const response = await login(role);

    expect(response.AuthenticationResult).toBeUndefined();
    expect(response.ChallengeName).toBe("MFA_SETUP");
    expect(JSON.parse(response.ChallengeParameters!.MFAS_CAN_SETUP)).toEqual(["SOFTWARE_TOKEN_MFA"]);
  });

  it("issues tokens only after the authenticator app is enrolled, and then asks for its code at every login", async () => {
    const { tokens } = await enrollAuthenticator("AUDITOR");
    expect(tokens.AccessToken).toBeTruthy();

    const nextLogin = await login("AUDITOR");
    expect(nextLogin.AuthenticationResult).toBeUndefined();
    expect(nextLogin.ChallengeName).toBe("SOFTWARE_TOKEN_MFA");
  });
});

describe("token types (T11)", () => {
  let donorTokens: AuthenticationResultType;
  let managerTokens: AuthenticationResultType;

  beforeAll(async () => {
    donorTokens = (await enrollAuthenticator("DONANTE")).tokens;
    managerTokens = (await enrollAuthenticator("GESTOR")).tokens;
  });
  beforeEach(clearAllTables);

  it("tells an access token from an ID token", () => {
    expect(jwtPayload(donorTokens.AccessToken!).token_use).toBe("access");
    expect(jwtPayload(donorTokens.IdToken!).token_use).toBe("id");
    expect(jwtPayload(donorTokens.AccessToken!)["cognito:groups"]).toEqual(["DONANTE"]);
  });

  it("accepts the claims of an access token", async () => {
    const response = await getMyDonations(eventWithClaims(gatewayClaims(donorTokens.AccessToken!)));

    expect(response.statusCode).toBe(200);
  });

  it("rejects the claims of an ID token with 401 on the same route", async () => {
    const response = await getMyDonations(eventWithClaims(gatewayClaims(donorTokens.IdToken!)));

    expect(response.statusCode).toBe(401);
  });

  it("rejects the ID token of a donor who tries to donate, even though the group is right", async () => {
    const project = await seedProject();
    const donation = {
      headers: { "Idempotency-Key": randomUUID() },
      body: { projectId: String(project.projectId), amountCents: 5_000 },
    };

    const withAccessToken = await createDonation(eventWithClaims(gatewayClaims(donorTokens.AccessToken!), donation));
    const withIdToken = await createDonation(
      eventWithClaims(gatewayClaims(donorTokens.IdToken!), {
        ...donation,
        headers: { "Idempotency-Key": randomUUID() },
      })
    );

    expect(withAccessToken.statusCode).toBe(201);
    expect(withIdToken.statusCode).toBe(401);
  });

  it("denies a manager's valid access token on a donor route with 403", async () => {
    const response = await getMyDonations(eventWithClaims(gatewayClaims(managerTokens.AccessToken!)));

    expect(response.statusCode).toBe(403);
  });
});

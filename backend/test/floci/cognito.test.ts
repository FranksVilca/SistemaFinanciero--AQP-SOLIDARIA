import { randomUUID } from "node:crypto";
import {
  CreateGroupCommand,
  CreateUserPoolClientCommand,
  CreateUserPoolCommand,
  SetUserPoolMfaConfigCommand,
  type AuthenticationResultType,
} from "@aws-sdk/client-cognito-identity-provider";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handler as createDonation } from "../../src/donations/createDonation.js";
import { handler as getMyDonations } from "../../src/donations/getMyDonations.js";
import { loadTemplate, propertiesOf, resourcesOfType } from "../infra/helpers/loadTemplate.js";
import { buildEvent } from "../integration/helpers/events.js";
import { clearAllTables, seedProject } from "../integration/helpers/seed.js";
import {
  cognito,
  createUserInGroup,
  enrollAuthenticator,
  gatewayClaims,
  login,
  type PoolRef,
} from "./helpers/cognitoUsers.js";
import { jwtPayload } from "./helpers/totp.js";

/**
 * T11 and T14 against an emulated Cognito. The user pool is built from the MFA settings of
 * infra/template.yaml; the claims of the tokens it issues are then given to the real handlers, the way the
 * HTTP API hands the verified claims of a JWT to a Lambda. The authorizer of API Gateway itself is exercised
 * in apiAuthorizer.test.ts.
 */

const ROLES = ["DONANTE", "GESTOR", "AUDITOR"] as const;
type Role = (typeof ROLES)[number];

const runId = randomUUID().slice(0, 8);
const usernameOf = (role: Role) => `${role.toLowerCase()}-${runId}@aqpsolidaria.pe`;

let pool: PoolRef;

const loginAs = (role: Role) => login(pool, usernameOf(role));
const enrollAs = (role: Role) => enrollAuthenticator(pool, usernameOf(role));

const eventWithClaims = (claims: Record<string, unknown>, extra: Parameters<typeof buildEvent>[0] = {}) => ({
  ...buildEvent(extra),
  requestContext: { requestId: `req-${randomUUID()}`, authorizer: { jwt: { claims } } },
});

beforeAll(async () => {
  const template = loadTemplate("academic");
  const templatePool = propertiesOf(resourcesOfType(template, "AWS::Cognito::UserPool")[0][1]);

  const created = await cognito.send(
    new CreateUserPoolCommand({
      PoolName: `zta-${runId}`,
      MfaConfiguration: templatePool.MfaConfiguration as "ON",
      UsernameAttributes: ["email"],
    })
  );
  const userPoolId = created.UserPool!.Id!;
  await cognito.send(
    new SetUserPoolMfaConfigCommand({
      UserPoolId: userPoolId,
      MfaConfiguration: templatePool.MfaConfiguration as "ON",
      SoftwareTokenMfaConfiguration: { Enabled: (templatePool.EnabledMfas as string[]).includes("SOFTWARE_TOKEN_MFA") },
    })
  );
  const client = await cognito.send(
    new CreateUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientName: "spa",
      ExplicitAuthFlows: ["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
    })
  );
  pool = { userPoolId, clientId: client.UserPoolClient!.ClientId! };

  for (const role of ROLES) {
    await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: role }));
    await createUserInGroup(pool, usernameOf(role), role);
  }
});

describe("mandatory second factor (T14)", () => {
  it.each(ROLES)("a %s without a second factor receives no tokens, only the enrollment challenge", async (role) => {
    const response = await loginAs(role);

    expect(response.AuthenticationResult).toBeUndefined();
    expect(response.ChallengeName).toBe("MFA_SETUP");
    expect(JSON.parse(response.ChallengeParameters!.MFAS_CAN_SETUP)).toEqual(["SOFTWARE_TOKEN_MFA"]);
  });

  it("issues tokens only after the authenticator app is enrolled, and then asks for its code at every login", async () => {
    const { tokens } = await enrollAs("AUDITOR");
    expect(tokens.AccessToken).toBeTruthy();

    const nextLogin = await loginAs("AUDITOR");
    expect(nextLogin.AuthenticationResult).toBeUndefined();
    expect(nextLogin.ChallengeName).toBe("SOFTWARE_TOKEN_MFA");
  });
});

describe("token types (T11)", () => {
  let donorTokens: AuthenticationResultType;
  let managerTokens: AuthenticationResultType;

  beforeAll(async () => {
    donorTokens = (await enrollAs("DONANTE")).tokens;
    managerTokens = (await enrollAs("GESTOR")).tokens;
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

import { ListStacksCommand } from "@aws-sdk/client-cloudformation";
import { AdminAddUserToGroupCommand } from "@aws-sdk/client-cognito-identity-provider";
import { cognito, createUserInGroup, hostedSignIn, type PoolRef } from "./cognitoUsers.js";
import { prepareFunctions } from "./functions.js";
import {
  STAGE,
  applyTemplateCorsToApi,
  applyTemplateScopesToRoutes,
  invokeBaseUrl,
  pointAuthorizerAtEmulatorIssuer,
  signInSettings,
} from "./gateway.js";
import { packageFunctions } from "./packageFunctions.js";
import { cloudFormation, deployStack, physicalIdOf } from "./stack.js";
import { jwtPayload } from "./totp.js";

export const LOCAL_STACK_NAME = "aqp-local";

export const DEMO_PASSWORD = "Passw0rd!x";

export const DEMO_USERS = [
  { email: "donante@aqpsolidaria.pe", groups: ["DONANTE"], role: "Donante (dona a un proyecto y ve su historial)" },
  { email: "gestor@aqpsolidaria.pe", groups: ["GESTOR"], role: "Gestor (crea y publica proyectos)" },
  { email: "auditor@aqpsolidaria.pe", groups: ["AUDITOR"], role: "Auditor (consulta la auditoría)" },
  { email: "revisor@aqpsolidaria.pe", groups: ["REVISOR"], role: "Revisor (aprueba o rechaza donaciones en revisión)" },
  // Alone: ADMIN is not combined with any other role (src/shared/roleRules.ts).
  { email: "admin@aqpsolidaria.pe", groups: ["ADMIN"], role: "Administrador (da y quita roles a las personas)" },
  // The combinations that are allowed, to try the conflicts that are decided per donation.
  {
    email: "donante.revisor@aqpsolidaria.pe",
    groups: ["DONANTE", "REVISOR"],
    role: "Donante y revisor (no ve en la cola sus propias donaciones retenidas)",
  },
  {
    email: "donante.gestor@aqpsolidaria.pe",
    groups: ["DONANTE", "GESTOR"],
    role: "Donante y gestor (no puede donar a un proyecto que creó)",
  },
  // A combination that cannot exist, created straight in the pool to see the refusal: every protected action is a 403.
  {
    email: "invalido@aqpsolidaria.pe",
    groups: ["GESTOR", "REVISOR"],
    role: "INVÁLIDO a propósito: gestor y revisor a la vez (todo da 403 SEPARATION_OF_DUTIES)",
  },
  {
    email: "invalido.auditor@aqpsolidaria.pe",
    groups: ["DONANTE", "AUDITOR"],
    role: "INVÁLIDO a propósito: donante y auditor a la vez (todo da 403 SEPARATION_OF_DUTIES)",
  },
] as const;

const DEMO_PROJECTS = [
  {
    title: "Agua potable para Chivay",
    description: "Instalar un sistema de agua potable en la comunidad.",
    goalAmountCents: 100_000,
  },
  {
    title: "Útiles escolares en Yanahuara",
    description: "Comprar útiles escolares para 200 niños.",
    goalAmountCents: 50_000,
  },
  {
    title: "Botiquín para el centro de salud",
    description: "Equipar el botiquín del centro de salud rural.",
    goalAmountCents: 80_000,
  },
];

export interface LocalStack {
  /** Invoke URL of the HTTP API, without the /v1 prefix. */
  baseUrl: string;
  pool: PoolRef;
  /** Issuer the emulated Cognito signs its tokens with; the SPA uses it as its OIDC authority. */
  authority: string;
}

async function seedDemoProjects(baseUrl: string, managerToken: string): Promise<void> {
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${managerToken}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  for (const project of DEMO_PROJECTS) {
    const created = (await (await call("POST", "/v1/projects", project)).json()) as { projectId: string };
    await call("PATCH", `/v1/projects/${created.projectId}/publish`);
  }
}

/**
 * The template names its resources (log groups, tables), so two stacks cannot live in the same account, in the emulator
 * or in AWS. Fails early with the way out instead of a rollback that says "already exists".
 */
async function assertNoOtherStack(stackName: string): Promise<void> {
  const { StackSummaries = [] } = await cloudFormation.send(new ListStacksCommand({}));
  const others = StackSummaries.filter(
    (stack) => stack.StackStatus !== "DELETE_COMPLETE" && stack.StackName !== stackName
  ).map((stack) => stack.StackName);
  if (others.length > 0)
    throw new Error(
      `Another stack is deployed in the emulator (${others.join(", ")}): it uses the same resource names. Stop it first with "npm run local:stop".`
    );
}

/**
 * Deploys infra/template.yaml into the emulator, puts the real code in the functions, creates the demo users, applies
 * the scopes of the template to the routes and publishes the demo projects. Everything a browser needs to use the SPA.
 */
export async function bootLocalStack(stackName: string, domainPrefix: string): Promise<LocalStack> {
  await assertNoOtherStack(stackName);
  const code = await packageFunctions();
  const resources = await deployStack(stackName, { StageName: STAGE, CognitoDomainPrefix: domainPrefix });
  const apiId = physicalIdOf(resources, "AWS::ApiGatewayV2::Api");
  const baseUrl = invokeBaseUrl(apiId);
  await prepareFunctions(resources, code);

  const pool: PoolRef = {
    userPoolId: physicalIdOf(resources, "AWS::Cognito::UserPool"),
    clientId: physicalIdOf(resources, "AWS::Cognito::UserPoolClient"),
  };
  for (const user of DEMO_USERS) {
    const [first, ...others] = user.groups;
    await createUserInGroup(pool, user.email, first);
    for (const group of others) {
      await cognito.send(
        new AdminAddUserToGroupCommand({ UserPoolId: pool.userPoolId, Username: user.email, GroupName: group })
      );
    }
  }

  const { scopes, redirectUri } = signInSettings();
  const manager = await hostedSignIn(pool, "gestor@aqpsolidaria.pe", scopes, redirectUri);
  await pointAuthorizerAtEmulatorIssuer(apiId, manager.accessToken);
  await applyTemplateScopesToRoutes(apiId);
  await applyTemplateCorsToApi(apiId);
  await seedDemoProjects(baseUrl, manager.accessToken);

  return { baseUrl, pool, authority: String(jwtPayload(manager.accessToken).iss) };
}

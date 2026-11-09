import { ListStacksCommand } from "@aws-sdk/client-cloudformation";
import { createUserInGroup, hostedSignIn, type PoolRef } from "./cognitoUsers.js";
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
  { email: "donante@aqpsolidaria.pe", group: "DONANTE", role: "Donante (dona a un proyecto y ve su historial)" },
  { email: "gestor@aqpsolidaria.pe", group: "GESTOR", role: "Gestor (crea y publica proyectos)" },
  { email: "auditor@aqpsolidaria.pe", group: "AUDITOR", role: "Auditor (consulta la auditoría)" },
  { email: "revisor@aqpsolidaria.pe", group: "REVISOR", role: "Revisor (aprueba o rechaza donaciones en revisión)" },
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
  for (const user of DEMO_USERS) await createUserInGroup(pool, user.email, user.group);

  const { scopes, redirectUri } = signInSettings();
  const manager = await hostedSignIn(pool, "gestor@aqpsolidaria.pe", scopes, redirectUri);
  await pointAuthorizerAtEmulatorIssuer(apiId, manager.accessToken);
  await applyTemplateScopesToRoutes(apiId);
  await applyTemplateCorsToApi(apiId);
  await seedDemoProjects(baseUrl, manager.accessToken);

  return { baseUrl, pool, authority: String(jwtPayload(manager.accessToken).iss) };
}

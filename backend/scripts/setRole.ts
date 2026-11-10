/**
 * Manages who holds which role, from the command line. It does what the administration screen of the application
 * cannot (the AUDITOR and ADMIN roles, and the first administrator), under the same rules.
 *
 *   npm run role -- list [--email ana@]
 *   npm run role -- show  ana@correo.com
 *   npm run role -- add    ana@correo.com REVISOR
 *   npm run role -- remove ana@correo.com DONANTE
 *   npm run role -- set    ana@correo.com ADMIN        (leaves exactly these roles, taking the others away)
 *
 * Options: --profile <perfil de AWS>  --stack <stack, aqp-solidaria-academic por defecto>  --pool <id del user pool>
 *          --region <región>  --dry-run (solo muestra el plan)  --yes (no pregunta)
 *
 * It needs AWS credentials with access to the user pool (an `aws login` session or an AWS_PROFILE). Every change is
 * also written to the audit trail of the application, as an operator action, so the auditor sees it.
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { CloudFormationClient, DescribeStacksCommand, type Stack } from "@aws-sdk/client-cloudformation";
import {
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { isNoOp, parseRoleNames, planRoleChange, type RoleChangePlan, type RoleCommand } from "./roleCommands.js";

const DEFAULT_STACK = "aqp-solidaria-academic";
const EMAIL = /^[A-Za-z0-9._%+@-]{1,254}$/;
const USAGE = `Uso:
  npm run role -- list [--email <prefijo>]
  npm run role -- show   <email>
  npm run role -- add    <email> <ROL> [<ROL>...]
  npm run role -- remove <email> <ROL> [<ROL>...]
  npm run role -- set    <email> <ROL> [<ROL>...]   (deja exactamente esos roles)

Roles: DONANTE, GESTOR, REVISOR, AUDITOR, ADMIN. AUDITOR y ADMIN van solos; GESTOR y REVISOR no se combinan.
Opciones: --profile <perfil>  --stack <stack>  --pool <id>  --region <región>  --dry-run  --yes`;

interface Target {
  client: CognitoIdentityProviderClient;
  userPoolId: string;
  stage: string;
}

interface Flags {
  yes: boolean;
  dryRun: boolean;
}

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

const attributeOf = (user: UserType, name: string) => user.Attributes?.find((a) => a.Name === name)?.Value;
const outputOf = (stack: Stack, key: string) => stack.Outputs?.find((o) => o.OutputKey === key)?.OutputValue;
const parameterOf = (stack: Stack, key: string) =>
  stack.Parameters?.find((p) => p.ParameterKey === key)?.ParameterValue;

/** The user pool and the stage of the deployment: given, or read from the outputs of the CloudFormation stack. */
async function resolveTarget(values: { stack?: string; pool?: string; region?: string }): Promise<Target> {
  const region = values.region ?? process.env.AWS_REGION ?? "us-east-1";
  process.env.AWS_REGION = region;
  const stackName = values.stack ?? DEFAULT_STACK;
  const { Stacks = [] } = await new CloudFormationClient({ region }).send(
    new DescribeStacksCommand({ StackName: stackName })
  );
  const userPoolId = values.pool ?? outputOf(Stacks[0], "UserPoolId");
  if (!userPoolId) fail(`No encontré el user pool: ni --pool ni la salida UserPoolId del stack ${stackName}.`);
  return {
    client: new CognitoIdentityProviderClient({ region }),
    userPoolId,
    stage: parameterOf(Stacks[0], "StageName") ?? "academic",
  };
}

async function groupsOf(target: Target, username: string): Promise<string[]> {
  const { Groups = [] } = await target.client.send(
    new AdminListGroupsForUserCommand({ UserPoolId: target.userPoolId, Username: username })
  );
  return Groups.flatMap((group) => (group.GroupName ? [group.GroupName] : []));
}

async function findUser(target: Target, email: string): Promise<UserType> {
  if (!EMAIL.test(email)) fail(`El correo "${email}" contiene caracteres no válidos.`);
  const { Users = [] } = await target.client.send(
    new ListUsersCommand({ UserPoolId: target.userPoolId, Filter: `email = "${email}"`, Limit: 2 })
  );
  if (Users.length === 0) fail(`No existe un usuario con el correo ${email}.`);
  if (Users.length > 1) fail(`Hay más de un usuario con el correo ${email}; revise el pool.`);
  return Users[0];
}

async function userRow(target: Target, user: UserType): Promise<string> {
  const roles = await groupsOf(target, user.Username ?? "");
  const name = attributeOf(user, "email") ?? user.Username ?? "?";
  return `${name.padEnd(40)} ${roles.join(" + ") || "(sin roles)"}`;
}

async function listUsers(target: Target, emailPrefix: string | undefined): Promise<void> {
  if (emailPrefix && !EMAIL.test(emailPrefix)) fail("El prefijo de correo contiene caracteres no válidos.");
  const filter = emailPrefix ? { Filter: `email ^= "${emailPrefix}"` } : {};
  const rows: string[] = [];
  let token: string | undefined;
  do {
    const page = await target.client.send(
      new ListUsersCommand({ UserPoolId: target.userPoolId, PaginationToken: token, ...filter })
    );
    for (const user of page.Users ?? []) rows.push(await userRow(target, user));
    token = page.PaginationToken;
  } while (token);
  console.log(rows.length > 0 ? rows.join("\n") : "No hay usuarios.");
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${question} [s/N] `)).trim().toLowerCase().startsWith("s");
  } finally {
    rl.close();
  }
}

/** The change is already made: a trace that fails is reported loudly, but it does not undo what happened. */
async function recordInAuditTrail(target: Target, userSub: string, plan: RoleChangePlan): Promise<boolean> {
  process.env.AUDIT_TABLE = `aqp-audit-${target.stage}`;
  const { recordAuditEvent, pseudonymizeActor } = await import("../src/audit/recordAuditEvent.js");
  const { AUDIT_OUTCOME, OPERATOR_ACTIONS } = await import("../src/shared/constants.js");
  const changes = [
    ...plan.toRemove.map((role) => ({ eventType: "ROLE_REVOKED" as const, role })),
    ...plan.toAdd.map((role) => ({ eventType: "ROLE_GRANTED" as const, role })),
  ];
  try {
    for (const { eventType, role } of changes) {
      await recordAuditEvent({
        eventType,
        requestId: `operator-${Date.now()}`,
        operator: true,
        resourceRef: `user:${pseudonymizeActor(userSub)}`,
        action: OPERATOR_ACTIONS.changeRole,
        outcome: AUDIT_OUTCOME.success,
        reason: role,
      });
    }
    return true;
  } catch (error) {
    console.error(`\nAviso: el cambio se aplicó pero no pude registrarlo en la auditoría: ${String(error)}`);
    return false;
  }
}

function printPlan(email: string, plan: RoleChangePlan): void {
  console.log(`\nUsuario: ${email}`);
  console.log(`  Roles ahora:   ${plan.before.join(" + ") || "(ninguno)"}`);
  console.log(`  Roles después: ${plan.after.join(" + ") || "(ninguno)"}`);
  if (plan.toRemove.length > 0) console.log(`  Se quita: ${plan.toRemove.join(", ")}`);
  if (plan.toAdd.length > 0) console.log(`  Se añade: ${plan.toAdd.join(", ")}`);
}

/** Taking away first: the person never holds, even for a moment, a combination that is not allowed. */
async function applyPlan(target: Target, username: string, plan: RoleChangePlan): Promise<void> {
  const base = { UserPoolId: target.userPoolId, Username: username };
  for (const role of plan.toRemove) {
    await target.client.send(new AdminRemoveUserFromGroupCommand({ ...base, GroupName: role }));
  }
  for (const role of plan.toAdd) {
    await target.client.send(new AdminAddUserToGroupCommand({ ...base, GroupName: role }));
  }
}

/** Plans the change for the person with that email, or stops saying why it cannot be done. */
async function planFor(target: Target, command: RoleCommand, email: string, roleNames: string[]) {
  const parsed = parseRoleNames(roleNames);
  if ("invalid" in parsed) fail(`"${parsed.invalid}" no es un rol. Roles: DONANTE, GESTOR, REVISOR, AUDITOR, ADMIN.`);
  const user = await findUser(target, email);
  const username = user.Username ?? "";
  const plan = planRoleChange(await groupsOf(target, username), command, parsed.roles);
  if (!plan.ok) fail(plan.error);
  return { user, username, plan };
}

async function changeRoles(
  target: Target,
  command: RoleCommand,
  email: string,
  roleNames: string[],
  flags: Flags
): Promise<void> {
  const { user, username, plan } = await planFor(target, command, email, roleNames);
  printPlan(email, plan);
  if (isNoOp(plan)) return console.log("\nNo hay nada que cambiar.");
  if (flags.dryRun) return console.log("\n--dry-run: no se cambió nada.");
  if (!flags.yes && !(await confirm("\n¿Aplicar el cambio?"))) return console.log("Cancelado.");

  await applyPlan(target, username, plan);
  const recorded = await recordInAuditTrail(target, attributeOf(user, "sub") ?? username, plan);
  console.log(
    `\nListo. ${email} ahora tiene: ${(await groupsOf(target, username)).join(" + ") || "(ninguno)"}.` +
      "\nLa persona debe cerrar sesión y volver a entrar para que su token lleve los roles nuevos."
  );
  if (!recorded) process.exitCode = 2;
}

async function showUser(target: Target, email: string | undefined): Promise<void> {
  if (!email) fail(`Indique el correo.\n\n${USAGE}`);
  const roles = await groupsOf(target, (await findUser(target, email)).Username ?? "");
  console.log(`${email}: ${roles.join(" + ") || "(sin roles)"}`);
}

function parseCli() {
  return parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: "string" },
      stack: { type: "string" },
      pool: { type: "string" },
      region: { type: "string" },
      email: { type: "string" },
      yes: { type: "boolean", short: "y", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
}

async function main(): Promise<void> {
  const { values, positionals } = parseCli();
  const [command, email, ...roleNames] = positionals;
  if (values.help || !command) return console.log(USAGE);
  if (values.profile) process.env.AWS_PROFILE = values.profile;

  const target = await resolveTarget(values);
  if (command === "list") return listUsers(target, values.email);
  if (command === "show") return showUser(target, email);
  if (command !== "add" && command !== "remove" && command !== "set")
    fail(`Comando desconocido "${command}".\n\n${USAGE}`);
  if (!email) fail(`Indique el correo y los roles.\n\n${USAGE}`);
  return changeRoles(target, command, email, roleNames, { yes: values.yes, dryRun: values["dry-run"] });
}

main().catch((error: unknown) => {
  const name = (error as { name?: string })?.name;
  const hint = /Expired|Credential|Token/i.test(`${name} ${String(error)}`)
    ? "\nLa sesión de AWS venció o no hay credenciales: ejecute `aws login --profile <perfil>` y reintente."
    : "";
  console.error(`\nError: ${String(error)}${hint}`);
  process.exit(1);
});

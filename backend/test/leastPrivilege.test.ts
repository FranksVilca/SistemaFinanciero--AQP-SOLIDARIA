import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { template, ofType, refOf } from "./support/cfnTemplate.js";

// T10 / CA-NF03.1 - least privilege, static part.
// A real AccessDenied needs the deployed roles (see evidence/test-run-report.md, T10, for the
// `aws iam simulate-principal-policy` command). Here we check the declared IaC and that every
// DynamoDB call in each handler is covered by its own function policy.

type Statement = { Effect: string; Action: string | string[]; Resource: unknown };
type Policy = Record<string, unknown>;

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));
const DYNAMO_MODULE = resolve(SRC_DIR, "shared/dynamo.ts");

const WRITE_ACTIONS = [
  "dynamodb:PutItem",
  "dynamodb:UpdateItem",
  "dynamodb:DeleteItem",
  "dynamodb:BatchWriteItem",
  "dynamodb:TransactWriteItems",
  "dynamodb:PartiQLInsert",
  "dynamodb:PartiQLUpdate",
  "dynamodb:PartiQLDelete",
];

// Actions granted by the SAM policy templates (AWS SAM policy_templates.json).
const SAM_POLICY_TEMPLATES: Record<string, string[]> = {
  DynamoDBReadPolicy: ["GetItem", "Scan", "Query", "BatchGetItem", "DescribeTable"],
  DynamoDBCrudPolicy: [
    "GetItem", "DeleteItem", "PutItem", "Scan", "Query", "UpdateItem",
    "BatchWriteItem", "BatchGetItem", "DescribeTable", "ConditionCheckItem",
  ],
  DynamoDBWritePolicy: ["PutItem", "UpdateItem", "BatchWriteItem"],
};

// Document-client command class -> IAM action. Transactions are authorized per item action.
const COMMAND_ACTIONS: Record<string, string> = {
  GetCommand: "GetItem",
  PutCommand: "PutItem",
  UpdateCommand: "UpdateItem",
  DeleteCommand: "DeleteItem",
  QueryCommand: "Query",
  ScanCommand: "Scan",
  BatchGetCommand: "BatchGetItem",
  BatchWriteCommand: "BatchWriteItem",
};
const TRANSACT_ITEM_ACTIONS: Record<string, string> = {
  Get: "GetItem",
  Put: "PutItem",
  Update: "UpdateItem",
  Delete: "DeleteItem",
  ConditionCheck: "ConditionCheckItem",
};

const READ_ONLY_FUNCTIONS = [
  "ListProjectsFunction",
  "GetProjectFunction",
  "GetProjectStatsFunction",
  "GetMyDonationsFunction",
  "GetAuditEventsFunction",
];

const functions = ofType("AWS::Serverless::Function");
const policiesOf = (fn: string): Policy[] =>
  (template.Resources[fn].Properties?.Policies ?? []) as Policy[];
const isStatementPolicy = (policy: Policy) => "Statement" in policy;

// TABLE_NAMES key -> env var (shared/dynamo.ts) -> table logical id (template Globals).
function tableKeyToLogicalId(): Record<string, string> {
  const source = readFileSync(DYNAMO_MODULE, "utf8");
  const envVars = template.Globals?.Function?.Environment?.Variables ?? {};
  const mapping: Record<string, string> = {};
  for (const [, key, envVar] of source.matchAll(/(\w+):\s*process\.env\.(\w+)/g)) {
    const logicalId = refOf(envVars[envVar]);
    if (logicalId) mapping[key] = logicalId;
  }
  return mapping;
}

type Access = { action: string; table: string; index: boolean };

// Collects source files reachable from the handler through relative imports (shared/dynamo excluded).
function reachableSources(entry: string, seen = new Set<string>()): string[] {
  if (seen.has(entry) || entry === DYNAMO_MODULE) return [];
  seen.add(entry);
  const source = readFileSync(entry, "utf8");
  const imports = [...source.matchAll(/from\s+"(\.{1,2}\/[^"]+)\.js"/g)].map(([, rel]) =>
    resolve(dirname(entry), `${rel}.ts`)
  );
  return [entry, ...imports.flatMap((file) => reachableSources(file, seen))];
}

// Attributes every `TableName: TABLE_NAMES.x` to the closest preceding command or transact item.
function dynamoAccesses(file: string, tables: Record<string, string>): Access[] {
  const source = readFileSync(file, "utf8");
  const tableNameCount = [...source.matchAll(/TableName:/g)].length;
  const tableRefs = [...source.matchAll(/TableName:\s*TABLE_NAMES\.(\w+)/g)];
  expect(tableRefs.length, `${file}: every TableName must use TABLE_NAMES`).toBe(tableNameCount);

  const contexts = [
    ...[...source.matchAll(/new\s+(\w+Command)\s*\(/g)].map((m) => ({
      at: m.index!,
      action: COMMAND_ACTIONS[m[1]],
      name: m[1],
    })),
    ...[...source.matchAll(/\b(Get|Put|Update|Delete|ConditionCheck):\s*\{/g)].map((m) => ({
      at: m.index!,
      action: TRANSACT_ITEM_ACTIONS[m[1]],
      name: m[1],
    })),
  ].sort((a, b) => a.at - b.at);

  return tableRefs.map((ref) => {
    const context = contexts.filter((c) => c.at < ref.index!).at(-1);
    expect(context?.action, `${file}: unmapped DynamoDB call before ${ref[0]}`).toBeDefined();
    const table = tables[ref[1]];
    expect(table, `${file}: TABLE_NAMES.${ref[1]} has no template table`).toBeDefined();
    const block = source.slice(ref.index!, source.indexOf("}", ref.index!));
    return { action: context!.action, table, index: /IndexName:/.test(block) };
  });
}

function handlerAccesses(fn: string): Access[] {
  const handler = String(template.Resources[fn].Properties?.Handler);
  const entry = resolve(SRC_DIR, `${handler.replace(/\.handler$/, "")}.ts`);
  const tables = tableKeyToLogicalId();
  return reachableSources(entry).flatMap((file) => dynamoAccesses(file, tables));
}

// Resources a policy references: "Table" (table ARN) or "Table/index" (index ARNs).
function statementResources(resource: unknown): string[] {
  return [resource].flat().map((value) => {
    const getAtt = (value as { "Fn::GetAtt"?: string[] })?.["Fn::GetAtt"];
    if (getAtt && getAtt[1] === "Arn") return getAtt[0];
    const sub = (value as { "Fn::Sub"?: string })?.["Fn::Sub"];
    const match = typeof sub === "string" ? sub.match(/^\$\{(\w+)\.Arn\}\/index\/\*$/) : null;
    if (match) return `${match[1]}/index`;
    throw new Error(`Unsupported policy resource ${JSON.stringify(value)}`);
  });
}

function grantedActions(fn: string): Set<string> {
  const granted = new Set<string>();
  for (const policy of policiesOf(fn)) {
    if (isStatementPolicy(policy)) {
      for (const statement of policy.Statement as Statement[]) {
        if (statement.Effect !== "Allow") continue;
        for (const resource of statementResources(statement.Resource)) {
          for (const action of [statement.Action].flat()) granted.add(`${action}@${resource}`);
        }
      }
      continue;
    }
    for (const [name, config] of Object.entries(policy)) {
      const actions = SAM_POLICY_TEMPLATES[name];
      if (!actions) throw new Error(`${fn}: unknown SAM policy template ${name}`);
      const table = refOf((config as { TableName?: unknown }).TableName);
      if (!table) throw new Error(`${fn}: ${name} without a table Ref`);
      for (const action of actions) {
        granted.add(`dynamodb:${action}@${table}`);
        granted.add(`dynamodb:${action}@${table}/index`);
      }
    }
  }
  return granted;
}

describe("T10 / CA-NF03.1 - read-only Lambdas cannot write to DynamoDB (template)", () => {
  it("the read-only function list matches the template", () => {
    for (const fn of READ_ONLY_FUNCTIONS) {
      expect(template.Resources[fn]?.Type, fn).toBe("AWS::Serverless::Function");
    }
  });

  it.each(READ_ONLY_FUNCTIONS)("%s has no write SAM policy template", (fn) => {
    const templates = policiesOf(fn).filter((policy) => !isStatementPolicy(policy));
    for (const policy of templates) {
      for (const name of Object.keys(policy)) {
        expect(name, fn).toBe("DynamoDBReadPolicy");
      }
    }
  });

  it.each(READ_ONLY_FUNCTIONS)("%s has no write or wildcard action in explicit statements", (fn) => {
    const actions = [...grantedActions(fn)].map((grant) => grant.split("@")[0]);
    expect(actions.length, fn).toBeGreaterThan(0);
    for (const action of actions) {
      expect(WRITE_ACTIONS, `${fn}: ${action}`).not.toContain(action);
      expect(action, fn).not.toMatch(/\*/);
    }
  });

  it.each(READ_ONLY_FUNCTIONS)("%s handler code issues only read calls", (fn) => {
    const accesses = handlerAccesses(fn);
    expect(accesses.length, fn).toBeGreaterThan(0);
    for (const access of accesses) {
      expect(WRITE_ACTIONS, `${fn}: ${access.action}`).not.toContain(`dynamodb:${access.action}`);
    }
  });
});

describe("T10 / CA-NF03.1 - every DynamoDB call in a handler is allowed by its function policy", () => {
  it.each(functions.map(([name]) => name))("%s policy covers its handler's DynamoDB calls", (fn) => {
    const granted = grantedActions(fn);
    const missing = handlerAccesses(fn)
      .map(({ action, table, index }) => `dynamodb:${action}@${table}${index ? "/index" : ""}`)
      .filter((needed) => !granted.has(needed));
    expect(missing, fn).toEqual([]);
  });
});

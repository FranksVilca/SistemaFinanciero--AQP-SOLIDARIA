import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type CollectionItem, type ScalarTag, type YAMLMap, type YAMLSeq } from "yaml";

const TEMPLATE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../infra/template.yaml");

export const STAGES = ["academic", "production"] as const;
export type Stage = (typeof STAGES)[number];

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface ResolvedTemplate {
  stage: Stage;
  parameters: Record<string, string>;
  conditions: Record<string, boolean>;
  resources: Record<string, JsonObject>;
  outputs: Record<string, JsonObject>;
  globals: JsonObject;
}

const NO_VALUE = "AWS::NoValue";

// "!GetAtt A.B" is the short form of {"Fn::GetAtt": ["A", "B"]}; every other tag maps to its long form.
const SHORT_TAGS = [
  "Ref", "Sub", "GetAtt", "Equals", "If", "Join", "Not", "And", "Or", "Select", "FindInMap",
  "ImportValue", "Condition", "Base64", "GetAZs", "Split",
];

function longName(tag: string): string {
  return tag === "Ref" || tag === "Condition" ? tag : `Fn::${tag}`;
}

function nodeToJson(node: unknown): Json {
  const candidate = node as { toJSON?: () => Json };
  return candidate.toJSON ? candidate.toJSON() : (node as Json);
}

const customTags = SHORT_TAGS.flatMap((name) => {
  const wrap = (value: Json): Json => ({ [longName(name)]: value });
  const scalar: ScalarTag = {
    tag: `!${name}`,
    resolve: (value: string) => wrap(name === "GetAtt" ? value.split(".") : value),
  };
  const sequence = { tag: `!${name}`, collection: "seq" as const, resolve: (seq: YAMLSeq) => wrap(nodeToJson(seq)) };
  const map = { tag: `!${name}`, collection: "map" as const, resolve: (mapNode: YAMLMap) => wrap(nodeToJson(mapNode)) };
  return [scalar, sequence, map];
});

function parseTemplateFile(): JsonObject {
  const source = readFileSync(TEMPLATE_PATH, "utf8");
  return parse(source, { customTags: customTags as never }) as JsonObject;
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evaluateCondition(expression: Json, parameters: Record<string, string>, named: Record<string, Json>): boolean {
  if (!isObject(expression)) throw new Error(`Unsupported condition: ${JSON.stringify(expression)}`);
  if ("Fn::Equals" in expression) {
    const [left, right] = expression["Fn::Equals"] as Json[];
    return resolveValue(left, parameters) === resolveValue(right, parameters);
  }
  if ("Fn::Not" in expression) {
    return !evaluateCondition((expression["Fn::Not"] as Json[])[0], parameters, named);
  }
  if ("Fn::And" in expression) {
    return (expression["Fn::And"] as Json[]).every((item) => evaluateCondition(item, parameters, named));
  }
  if ("Fn::Or" in expression) {
    return (expression["Fn::Or"] as Json[]).some((item) => evaluateCondition(item, parameters, named));
  }
  if ("Condition" in expression) {
    return evaluateCondition(named[expression.Condition as string], parameters, named);
  }
  throw new Error(`Unsupported condition: ${JSON.stringify(expression)}`);
}

function resolveValue(value: Json, parameters: Record<string, string>): Json {
  if (isObject(value) && "Ref" in value && typeof value.Ref === "string" && value.Ref in parameters) {
    return parameters[value.Ref];
  }
  return value;
}

function resolveIfs(value: Json, conditions: Record<string, boolean>): Json | undefined {
  if (Array.isArray(value)) {
    return value.map((item) => resolveIfs(item, conditions)).filter((item): item is Json => item !== undefined);
  }
  if (!isObject(value)) return value;

  if ("Fn::If" in value) {
    const [name, whenTrue, whenFalse] = value["Fn::If"] as Json[];
    const chosen = conditions[name as string] ? whenTrue : whenFalse;
    if (isObject(chosen) && chosen.Ref === NO_VALUE) return undefined;
    return resolveIfs(chosen, conditions);
  }

  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    const resolved = resolveIfs(child, conditions);
    if (resolved !== undefined) result[key] = resolved;
  }
  return result;
}

function collectParameters(raw: JsonObject, stage: Stage, overrides: Record<string, string>): Record<string, string> {
  const declared = (raw.Parameters ?? {}) as Record<string, JsonObject>;
  const parameters: Record<string, string> = {};
  for (const [name, definition] of Object.entries(declared)) {
    parameters[name] = String(definition.Default ?? "");
  }
  return { ...parameters, StageName: stage, ...overrides };
}

/**
 * Loads infra/template.yaml for one stage: evaluates parameters and Conditions, removes resources
 * whose Condition is false and resolves Fn::If. Parameter overrides emulate `sam deploy --parameter-overrides`.
 */
export function loadTemplate(stage: Stage, overrides: Record<string, string> = {}): ResolvedTemplate {
  const raw = parseTemplateFile();
  const parameters = collectParameters(raw, stage, overrides);
  const rawConditions = (raw.Conditions ?? {}) as Record<string, Json>;
  const conditions = Object.fromEntries(
    Object.entries(rawConditions).map(([name, expression]) => [name, evaluateCondition(expression, parameters, rawConditions)])
  );

  const resources: Record<string, JsonObject> = {};
  for (const [name, definition] of Object.entries((raw.Resources ?? {}) as Record<string, JsonObject>)) {
    const condition = definition.Condition as string | undefined;
    if (condition && !conditions[condition]) continue;
    resources[name] = resolveIfs(definition, conditions) as JsonObject;
  }

  return {
    stage,
    parameters,
    conditions,
    resources,
    outputs: (raw.Outputs ?? {}) as Record<string, JsonObject>,
    globals: (raw.Globals ?? {}) as JsonObject,
  };
}

export function resourcesOfType(template: ResolvedTemplate, type: string): Array<[string, JsonObject]> {
  return Object.entries(template.resources).filter(([, definition]) => definition.Type === type);
}

export function lambdaFunctions(template: ResolvedTemplate): Array<[string, JsonObject]> {
  return resourcesOfType(template, "AWS::Serverless::Function");
}

export function propertiesOf(definition: JsonObject): JsonObject {
  return (definition.Properties ?? {}) as JsonObject;
}

export function handlerOf(definition: JsonObject): string {
  return String(propertiesOf(definition).Handler);
}

export function policiesOf(definition: JsonObject): Json[] {
  return (propertiesOf(definition).Policies ?? []) as Json[];
}

export function eventsOf(definition: JsonObject): Array<[string, JsonObject]> {
  return Object.entries((propertiesOf(definition).Events ?? {}) as Record<string, JsonObject>);
}

export function rawParameters(): Record<string, JsonObject> {
  return (parseTemplateFile().Parameters ?? {}) as Record<string, JsonObject>;
}

export type { CollectionItem };

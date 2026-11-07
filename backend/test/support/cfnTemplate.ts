import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse, type CollectionTag, type ScalarTag } from "yaml";

// Parses infra/template.yaml with CloudFormation short-form intrinsics (!Ref, !Sub, !GetAtt, ...)
// mapped to their long form ({ Ref: X }, { "Fn::Sub": ... }, { "Fn::GetAtt": [X, Attr] }).

export type Resource = { Type: string; Properties?: Record<string, unknown>; Condition?: string };
export type Template = {
  Globals?: { Function?: { Environment?: { Variables?: Record<string, unknown> } } };
  Resources: Record<string, Resource>;
  Outputs?: Record<string, unknown>;
};

const INTRINSICS = [
  "Ref", "Sub", "GetAtt", "Equals", "If", "Not", "And", "Or",
  "Join", "Select", "Split", "FindInMap", "ImportValue", "GetAZs", "Base64", "Condition",
];

const cfnTags: (ScalarTag | CollectionTag)[] = INTRINSICS.flatMap((name) => {
  const key = name === "Ref" || name === "Condition" ? name : `Fn::${name}`;
  const resolve = (value: unknown) =>
    name === "GetAtt" && typeof value === "string" ? { [key]: value.split(".") } : { [key]: value };
  return [
    { tag: `!${name}`, resolve: (str: string) => resolve(str) } as ScalarTag,
    { tag: `!${name}`, collection: "seq", resolve: (seq) => resolve(seq.toJSON()) } as CollectionTag,
    { tag: `!${name}`, collection: "map", resolve: (map) => resolve(map.toJSON()) } as CollectionTag,
  ];
});

export const templatePath = fileURLToPath(new URL("../../../infra/template.yaml", import.meta.url));

export function parseTemplate(source: string): Template {
  return parse(source, { customTags: cfnTags }) as Template;
}

export const template: Template = parseTemplate(readFileSync(templatePath, "utf8"));
export const resources = template.Resources;

export const ofType = (type: string): [string, Resource][] =>
  Object.entries(resources).filter(([, r]) => r.Type === type);

export const refOf = (value: unknown): string | undefined =>
  value && typeof value === "object" && "Ref" in value ? String((value as { Ref: unknown }).Ref) : undefined;

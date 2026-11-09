import type { Json } from "../../infra/helpers/loadTemplate.js";

export type TableArns = Record<string, string>;

function isObject(value: Json): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Resolves the CloudFormation intrinsics that the function policies of the template use into plain ARNs. */
function resolveArn(value: Json, arns: TableArns): string {
  if (typeof value === "string") return value;
  if (isObject(value) && "Fn::GetAtt" in value) {
    const [logicalId] = value["Fn::GetAtt"] as string[];
    return arns[logicalId];
  }
  if (isObject(value) && "Fn::Sub" in value) {
    return String(value["Fn::Sub"]).replace(/\$\{(\w+)\.Arn\}/g, (_match, logicalId: string) => arns[logicalId]);
  }
  throw new Error(`Unsupported resource expression: ${JSON.stringify(value)}`);
}

interface TemplateStatement {
  Effect: string;
  Action: string | string[];
  Resource: Json;
  Condition?: Json;
}

/** Turns the inline policies of a SAM function into one IAM policy document with concrete ARNs. */
export function buildPolicyDocument(policies: Json[], arns: TableArns): string {
  const statements = policies.flatMap((policy) => (policy as unknown as { Statement: TemplateStatement[] }).Statement);
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: statements.map((statement) => ({
      Effect: statement.Effect,
      Action: statement.Action,
      Resource: (Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource]).map((resource) =>
        resolveArn(resource, arns)
      ),
      // Kept as written: a condition (for example the velocity# key prefix) is part of what the function is granted.
      ...(statement.Condition !== undefined && { Condition: statement.Condition }),
    })),
  });
}

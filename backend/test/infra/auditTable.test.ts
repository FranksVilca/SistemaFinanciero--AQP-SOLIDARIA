import { describe, expect, it } from "vitest";
import { STAGES, loadTemplate, propertiesOf, resourcesOfType, type JsonObject } from "./helpers/loadTemplate.js";

const MUTATING_ACTIONS = ["dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"];

describe.each(STAGES)("audit table in stage %s", (stage) => {
  const [, table] = resourcesOfType(loadTemplate(stage), "AWS::DynamoDB::Table").find(([name]) => name === "AuditTable")!;
  const properties = propertiesOf(table);

  it("is partitioned by UTC day and sorted by timestamp", () => {
    expect(properties.KeySchema).toEqual([
      { AttributeName: "auditDay", KeyType: "HASH" },
      { AttributeName: "timestamp#eventId", KeyType: "RANGE" },
    ]);
  });

  it("denies update and delete to the roles of the functions through a resource policy", () => {
    const policy = (properties.ResourcePolicy as JsonObject).PolicyDocument as JsonObject;
    const [statement] = policy.Statement as unknown as Array<{ Effect: string; Action: string[]; Condition: JsonObject }>;

    expect(statement.Effect).toBe("Deny");
    expect([...statement.Action].sort()).toEqual([...MUTATING_ACTIONS].sort());
    expect(JSON.stringify(statement.Condition)).toContain("FunctionRole");
  });
});

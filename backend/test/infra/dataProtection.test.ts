import { describe, expect, it } from "vitest";
import { STAGES, loadTemplate, propertiesOf, resourcesOfType, type JsonObject } from "./helpers/loadTemplate.js";

const CRITICAL_TABLES = ["Projects", "Donations", "Audit"] as const;

function tableProperties(stage: (typeof STAGES)[number], name: string, overrides: Record<string, string> = {}): JsonObject {
  const template = loadTemplate(stage, overrides);
  const table = resourcesOfType(template, "AWS::DynamoDB::Table").find(([logicalId]) => logicalId === `${name}Table`);
  if (!table) throw new Error(`${name}Table is missing`);
  return propertiesOf(table[1]);
}

const pitrOf = (properties: JsonObject) => (properties.PointInTimeRecoverySpecification as JsonObject | undefined)?.PointInTimeRecoveryEnabled;

describe.each(STAGES)("data protection in stage %s", (stage) => {
  it.each(CRITICAL_TABLES)("%s table is protected against deletion only in production", (name) => {
    expect(tableProperties(stage, name).DeletionProtectionEnabled).toBe(stage === "production");
  });

  it.each(CRITICAL_TABLES)("%s table has point-in-time recovery when requested", (name) => {
    expect(pitrOf(tableProperties(stage, name, { EnablePitr: "true" }))).toBe(true);
  });

  it.each(CRITICAL_TABLES)("%s table has point-in-time recovery by default only in production", (name) => {
    expect(pitrOf(tableProperties(stage, name))).toBe(stage === "production");
  });

  it("leaves the idempotency table without deletion protection or recovery (24 hour TTL data)", () => {
    const properties = tableProperties(stage, "Idempotency", { EnablePitr: "true" });
    expect(properties.DeletionProtectionEnabled ?? false).toBe(false);
    expect(properties.PointInTimeRecoverySpecification).toBeUndefined();
  });
});

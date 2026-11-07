import { describe, expect, it } from "vitest";
import { STAGES, loadTemplate, rawParameters, resourcesOfType } from "./helpers/loadTemplate.js";

const OPTIONAL_DETECTION = [
  { parameter: "EnableGuardDuty", type: "AWS::GuardDuty::Detector" },
  { parameter: "EnableSecurityHub", type: "AWS::SecurityHub::Hub" },
] as const;

describe("optional threat detection (30-day trials)", () => {
  it.each(OPTIONAL_DETECTION)("$parameter is off by default and documents the trial", ({ parameter }) => {
    const definition = rawParameters()[parameter];
    expect(definition.Default).toBe("false");
    expect(definition.AllowedValues).toEqual(["true", "false"]);
    expect(String(definition.Description)).toMatch(/30/);
  });

  describe.each(STAGES)("stage %s", (stage) => {
    it.each(OPTIONAL_DETECTION)("$type exists only when $parameter is true", ({ parameter, type }) => {
      expect(resourcesOfType(loadTemplate(stage), type)).toHaveLength(0);
      expect(resourcesOfType(loadTemplate(stage, { [parameter]: "true" }), type)).toHaveLength(1);
    });

    it("keeps every other resource independent from the optional detection services", () => {
      const withDetection = loadTemplate(stage, { EnableGuardDuty: "true", EnableSecurityHub: "true" });
      const withoutDetection = loadTemplate(stage);
      const detectionTypes: string[] = OPTIONAL_DETECTION.map(({ type }) => type);

      for (const [name, definition] of Object.entries(withDetection.resources)) {
        if (detectionTypes.includes(String(definition.Type))) continue;
        expect(withoutDetection.resources[name], name).toBeDefined();
        expect(JSON.stringify(definition)).not.toMatch(/GuardDuty|SecurityHub/);
      }
    });
  });
});

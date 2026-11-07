import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildDistPackage } from "../scripts/distPackage.mjs";

// SAM packages backend/dist as each Lambda's code; without this manifest the runtime
// loads the ESM output as CommonJS and the runtime dependencies (zod) are never installed.
describe("Lambda deployment manifest (backend/dist/package.json)", () => {
  const source = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const manifest = buildDistPackage(source);

  it("declares ESM so Node loads the compiled handlers as modules", () => {
    expect(manifest.type).toBe("module");
  });

  it("carries exactly the runtime dependencies for sam build to install", () => {
    expect(manifest.dependencies).toEqual(source.dependencies);
    expect(manifest.dependencies).toHaveProperty("zod");
  });

  it("never ships dev dependencies or scripts into the Lambda package", () => {
    expect(manifest).not.toHaveProperty("devDependencies");
    expect(manifest).not.toHaveProperty("scripts");
  });
});

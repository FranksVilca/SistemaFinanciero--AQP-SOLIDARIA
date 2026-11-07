// Writes backend/dist/package.json, the manifest SAM uses to package each Lambda:
// "type": "module" for the ESM output and the runtime dependencies for `sam build` to install.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

export function buildDistPackage(source) {
  return {
    name: `${source.name}-lambda`,
    version: source.version,
    private: true,
    type: "module",
    dependencies: source.dependencies,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const source = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const target = new URL("../dist/package.json", import.meta.url);
  writeFileSync(target, `${JSON.stringify(buildDistPackage(source), null, 2)}\n`);
}

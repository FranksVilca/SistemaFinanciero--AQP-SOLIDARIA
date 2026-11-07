// Writes backend/dist/package.json so Lambda loads the compiled files as ES modules and `sam build`
// installs the runtime dependencies. The AWS SDK v3 is provided by the Lambda runtime and is not installed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { dependencies } = JSON.parse(readFileSync(resolve(backendRoot, "package.json"), "utf8"));

const runtimeDependencies = Object.fromEntries(
  Object.entries(dependencies).filter(([name]) => !name.startsWith("@aws-sdk/"))
);

mkdirSync(resolve(backendRoot, "dist"), { recursive: true });
writeFileSync(
  resolve(backendRoot, "dist/package.json"),
  `${JSON.stringify({ name: "aqp-solidaria-functions", private: true, type: "module", dependencies: runtimeDependencies }, null, 2)}\n`
);

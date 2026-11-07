// Prepares DynamoDB Local for `npm run dev:api`: recreates the template tables and writes the
// `sam local --env-vars` file that points every Lambda container at the local endpoint.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  applyLocalCredentials,
  localTables,
  recreateLocalTables,
} from "../test/integration/support/localTables.js";

export function samEnvVars(
  tables: { envVar: string; tableName: string }[],
  endpoint: string
): { Parameters: Record<string, string> } {
  return {
    Parameters: {
      DYNAMODB_ENDPOINT: endpoint,
      AWS_ACCESS_KEY_ID: "local",
      AWS_SECRET_ACCESS_KEY: "local",
      AWS_REGION: "us-east-1",
      ...Object.fromEntries(tables.map(({ envVar, tableName }) => [envVar, tableName])),
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [hostEndpoint, containerEndpoint, outFile] = process.argv.slice(2);
  applyLocalCredentials();
  const created = await recreateLocalTables(hostEndpoint);
  mkdirSync(new URL(".", `file://${outFile}`), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(samEnvVars(localTables(), containerEndpoint), null, 2)}\n`);
  console.info(`[dev:api] DynamoDB Local tables ready: ${created.join(", ")}`);
}

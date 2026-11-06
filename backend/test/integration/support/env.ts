import { applyLocalCredentials, hasLocalEndpoint, localTables } from "./localTables.js";

// Runs before each integration test file is imported, so shared/dynamo.ts reads these values.
if (hasLocalEndpoint()) {
  applyLocalCredentials();
  for (const { envVar, tableName } of localTables()) {
    process.env[envVar] = tableName;
  }
}

import { applyLocalCredentials, assertIntegrationEndpoint, recreateLocalTables, SKIP_MESSAGE } from "./localTables.js";

export default async function setup(): Promise<void> {
  if (!assertIntegrationEndpoint()) {
    console.warn(SKIP_MESSAGE);
    return;
  }
  applyLocalCredentials();
  const tables = await recreateLocalTables(process.env.DYNAMODB_ENDPOINT!);
  console.info(`[integration] DynamoDB Local at ${process.env.DYNAMODB_ENDPOINT}: created ${tables.join(", ")}`);
}

import { defineConfig } from "vitest/config";
import { INTEGRATION_ENV } from "./test/integration/testEnv.js";

// Integration tests run against DynamoDB Local; files run sequentially because they share the same tables.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    globalSetup: ["test/integration/globalSetup.ts"],
    setupFiles: ["test/integration/setup.ts"],
    env: { ...INTEGRATION_ENV },
    fileParallelism: false,
    testTimeout: 20000,
  },
});

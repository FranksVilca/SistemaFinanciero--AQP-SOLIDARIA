import { defineConfig } from "vitest/config";

// Integration run against DynamoDB Local (`npm run test:integration`).
// Requires DYNAMODB_ENDPOINT (e.g. http://localhost:8000); without it every suite is skipped.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    globalSetup: ["test/integration/support/globalSetup.ts"],
    setupFiles: ["test/integration/support/env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Keep the handlers' structured JSON logs out of the report; test summaries still print.
    onConsoleLog: (log) => !log.startsWith('{"level"'),
  },
});

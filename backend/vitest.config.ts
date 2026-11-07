import { defineConfig } from "vitest/config";

// Unit tests only: integration tests need DynamoDB Local and infra tests have their own script.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**", "test/infra/**", "node_modules/**"],
  },
});

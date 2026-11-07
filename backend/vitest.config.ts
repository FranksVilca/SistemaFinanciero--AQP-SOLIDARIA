import { defineConfig } from "vitest/config";

// Unit tests only: integration and emulator tests need containers; infra tests have their own script.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**", "test/infra/**", "test/floci/**", "node_modules/**"],
  },
});

import { defineConfig } from "vitest/config";
import { FLOCI_ENV } from "./test/floci/flociEnv.js";

// Runs the handlers and the real IAM policies of infra/template.yaml against Floci with IAM enforcement on.
export default defineConfig({
  test: {
    include: ["test/floci/**/*.test.ts"],
    globalSetup: ["test/floci/globalSetup.ts"],
    env: { ...FLOCI_ENV },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});

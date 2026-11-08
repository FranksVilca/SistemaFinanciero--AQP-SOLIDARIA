import { defineConfig } from "vitest/config";
import { FLOCI_ENV } from "./test/floci/flociEnv.js";

// Full path with the Lambdas running in Docker. Needs a Floci whose container can reach the Docker socket
// (test/floci/docker-compose.lambda.yml), which is why it is separate from the default emulator suite.
export default defineConfig({
  test: {
    include: ["test/floci/e2e/**/*.test.ts"],
    env: { ...FLOCI_ENV },
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 400000,
  },
});

import { defineConfig } from "vitest/config";
import { FLOCI_ENV } from "./test/floci/flociEnv.js";

// The SPA in a real browser (Microsoft Edge or Chrome through Playwright) against the whole system in Floci.
// Needs the Floci with the Docker socket (test/floci/docker-compose.lambda.yml) and port 3000 free.
export default defineConfig({
  test: {
    include: ["test/browser/**/*.test.ts"],
    env: { ...FLOCI_ENV },
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 600000,
  },
});

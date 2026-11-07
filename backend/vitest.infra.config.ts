import { defineConfig } from "vitest/config";

// Infrastructure tests assert on infra/template.yaml and need no database.
export default defineConfig({
  test: {
    include: ["test/infra/**/*.test.ts"],
  },
});

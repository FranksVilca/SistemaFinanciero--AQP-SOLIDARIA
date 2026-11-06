import { defineConfig } from "vitest/config";

// Default unit run (`npm test`): DynamoDB is mocked. Integration tests against DynamoDB Local
// live in test/integration and run only through `npm run test:integration`.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**", "**/node_modules/**"],
  },
});

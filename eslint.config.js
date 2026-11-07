import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

// Limits of constitution principle VII. Exceeding them requires an eslint-disable comment that explains why.
const MAX_COMPLEXITY = 10;
const MAX_FUNCTION_LINES = 50;

const typescriptRules = {
  "no-unused-vars": "off",
  "no-undef": "off",
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
  "@typescript-eslint/no-explicit-any": "error",
  complexity: ["error", MAX_COMPLEXITY],
};

const functionSizeRule = ["error", { max: MAX_FUNCTION_LINES, skipBlankLines: true, skipComments: true }];

export default [
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: typescriptRules,
  },
  {
    // Production code of the backend: strict function size.
    files: ["backend/src/**/*.ts"],
    rules: { "max-lines-per-function": functionSizeRule },
  },
  {
    // The frontend predates principle VII: size violations are reported as warnings and tracked in
    // specs/002-zta-hardening/followups.md until each file is touched.
    files: ["frontend/**/*.ts", "frontend/**/*.tsx"],
    rules: {
      "max-lines-per-function": ["warn", { max: MAX_FUNCTION_LINES, skipBlankLines: true, skipComments: true }],
      complexity: ["warn", MAX_COMPLEXITY],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.aws-sam/**", "**/*.config.js", "**/*.config.ts"],
  },
];

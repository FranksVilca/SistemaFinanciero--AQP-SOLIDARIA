const endpoint = process.env.FLOCI_ENDPOINT ?? "http://localhost:4566";

/** Administrator of the emulator: used only to create tables and users and to seed or inspect data. */
export const FLOCI_ENV = {
  FLOCI_ENDPOINT: endpoint,
  DYNAMODB_ENDPOINT: endpoint,
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  PROJECTS_TABLE: "aqp-projects-floci",
  DONATIONS_TABLE: "aqp-donations-floci",
  IDEMPOTENCY_TABLE: "aqp-idempotency-floci",
  AUDIT_TABLE: "aqp-audit-floci",
  // Permissive stand-in for the Cognito userInfo endpoint, started by the global setup.
  COGNITO_USERINFO_URL: "http://127.0.0.1:8766/oauth2/userInfo",
} as const;

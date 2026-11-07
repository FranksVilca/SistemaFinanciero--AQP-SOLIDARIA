export const INTEGRATION_ENV = {
  DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
  AWS_REGION: "us-east-1",
  AWS_ACCESS_KEY_ID: "local",
  AWS_SECRET_ACCESS_KEY: "local",
  PROJECTS_TABLE: "aqp-projects-it",
  DONATIONS_TABLE: "aqp-donations-it",
  IDEMPOTENCY_TABLE: "aqp-idempotency-it",
  AUDIT_TABLE: "aqp-audit-it",
  // Permissive stand-in for the Cognito userInfo endpoint, started by globalSetup.
  COGNITO_USERINFO_URL: "http://127.0.0.1:8765/oauth2/userInfo",
} as const;

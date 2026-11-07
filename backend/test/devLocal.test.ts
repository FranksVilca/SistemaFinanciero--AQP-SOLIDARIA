import { describe, it, expect } from "vitest";
import { samEnvVars } from "../scripts/devLocal.js";
import { localTables } from "./integration/support/localTables.js";

// `sam local start-api` runs each Lambda in its own container; these env vars point every
// function at DynamoDB Local over the shared Docker network instead of real AWS.
describe("sam local env vars for the dev API", () => {
  const tables = localTables();
  const env = samEnvVars(tables, "http://aqp-dynamodb-local:8000");

  it("applies to every function through the global Parameters section", () => {
    expect(Object.keys(env)).toEqual(["Parameters"]);
  });

  it("points the DynamoDB client at the local container endpoint", () => {
    expect(env.Parameters.DYNAMODB_ENDPOINT).toBe("http://aqp-dynamodb-local:8000");
  });

  it("maps every table env var from the template to its local table", () => {
    for (const { envVar, tableName } of tables) {
      expect(env.Parameters[envVar]).toBe(tableName);
    }
    expect(Object.keys(env.Parameters)).toEqual(
      expect.arrayContaining(["PROJECTS_TABLE", "DONATIONS_TABLE", "IDEMPOTENCY_TABLE", "AUDIT_TABLE"])
    );
  });

  it("uses fake local credentials so the dev API can never reach real AWS", () => {
    expect(env.Parameters.AWS_ACCESS_KEY_ID).toBe("local");
    expect(env.Parameters.AWS_SECRET_ACCESS_KEY).toBe("local");
  });
});

describe("DynamoDB endpoint override contract", () => {
  it("declares DYNAMODB_ENDPOINT empty in template Globals so only sam local can point it elsewhere", async () => {
    const { template } = await import("./support/cfnTemplate.js");
    const vars = (template as { Globals?: { Function?: { Environment?: { Variables?: Record<string, unknown> } } } })
      .Globals?.Function?.Environment?.Variables;
    expect(vars?.DYNAMODB_ENDPOINT).toBe("");
  });

  it("treats an empty endpoint as the real AWS endpoint", async () => {
    const { dynamoClientConfig } = await import("../src/shared/dynamo.js");
    expect(dynamoClientConfig({ DYNAMODB_ENDPOINT: "" }).endpoint).toBeUndefined();
    expect(dynamoClientConfig({}).endpoint).toBeUndefined();
    expect(dynamoClientConfig({ DYNAMODB_ENDPOINT: "http://aqp-dynamodb-local:8000" }).endpoint).toBe(
      "http://aqp-dynamodb-local:8000"
    );
  });
});

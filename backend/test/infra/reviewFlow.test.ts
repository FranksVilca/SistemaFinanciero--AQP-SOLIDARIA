import { describe, expect, it } from "vitest";
import {
  STAGES,
  eventsOf,
  handlerOf,
  lambdaFunctions,
  loadTemplate,
  policiesOf,
  propertiesOf,
  rawParameters,
  resourcesOfType,
  type Json,
  type JsonObject,
} from "./helpers/loadTemplate.js";

const REVIEW_SCOPE = "api/donations.review";
const EXPIRY_HANDLER = "reviews/expireReviews.handler";

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource: Json;
}

const statementsOf = (definition: JsonObject): Statement[] =>
  policiesOf(definition).flatMap((policy) => (policy as unknown as { Statement: Statement[] }).Statement);
const actionsOf = (statement: Statement): string[] =>
  Array.isArray(statement.Action) ? statement.Action : [statement.Action];

describe("REVIEW_EXPIRY_DAYS is a template parameter", () => {
  it("declares ReviewExpiryDays as a positive number of days, 7 by default", () => {
    expect(rawParameters().ReviewExpiryDays).toMatchObject({ Type: "Number", Default: 7, MinValue: 1 });
  });
});

describe.each(STAGES)("review of held donations in stage %s", (stage) => {
  const template = loadTemplate(stage);
  const functionOf = (handler: string) => {
    const found = lambdaFunctions(template).find(([, definition]) => handlerOf(definition) === handler);
    if (!found) throw new Error(`No function with handler ${handler}`);
    return found[1];
  };

  it("adds the REVISOR group to the single user pool (whose MFA is already ON for everyone)", () => {
    const groups = resourcesOfType(template, "AWS::Cognito::UserPoolGroup").map(([, group]) => propertiesOf(group));
    const pools = resourcesOfType(template, "AWS::Cognito::UserPool");

    expect(groups.find((group) => group.GroupName === "REVISOR")).toMatchObject({
      UserPoolId: { Ref: "CognitoUserPool" },
    });
    expect(pools).toHaveLength(1);
    expect(propertiesOf(pools[0][1]).MfaConfiguration).toBe("ON");
  });

  it("declares the donations.review scope and lets the SPA client request it", () => {
    const server = propertiesOf(template.resources.CognitoResourceServer);
    const client = propertiesOf(template.resources.CognitoUserPoolClient);

    expect((server.Scopes as JsonObject[]).map((scope) => scope.ScopeName)).toContain("donations.review");
    expect(client.AllowedOAuthScopes).toContain(REVIEW_SCOPE);
  });

  it.each([
    ["reviews/listReviews.handler", "/v1/reviews", "GET"],
    ["reviews/reviewDonation.handler", "/v1/donations/{donationId}/review", "POST"],
  ])("exposes %s at %s %s behind the JWT authorizer with the review scope only", (handler, path, method) => {
    const events = eventsOf(functionOf(handler));

    expect(events).toHaveLength(1);
    const [, event] = events[0];
    expect(event.Type).toBe("HttpApi");
    expect(propertiesOf(event)).toEqual({
      Path: path,
      Method: method,
      ApiId: { Ref: "HttpApi" },
      Auth: { AuthorizationScopes: [REVIEW_SCOPE] },
    });
  });

  it("indexes the donations by status and creation date", () => {
    const table = propertiesOf(template.resources.DonationsTable);
    const indexes = table.GlobalSecondaryIndexes as JsonObject[];

    expect(table.AttributeDefinitions).toContainEqual({ AttributeName: "status", AttributeType: "S" });
    expect(indexes.find((index) => index.IndexName === "status-createdAt-index")).toEqual({
      IndexName: "status-createdAt-index",
      KeySchema: [
        { AttributeName: "status", KeyType: "HASH" },
        { AttributeName: "createdAt", KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    });
  });

  it("runs the expiry once a day from an EventBridge schedule and never from an API route", () => {
    const events = eventsOf(functionOf(EXPIRY_HANDLER));

    expect(events).toHaveLength(1);
    const [, event] = events[0];
    expect(event.Type).toBe("Schedule");
    expect(propertiesOf(event)).toMatchObject({ Schedule: "rate(1 day)", Enabled: true });
  });

  it("passes the expiry threshold to the expiry function only", () => {
    const variables = (definition: JsonObject) =>
      ((propertiesOf(definition).Environment as JsonObject | undefined)?.Variables ?? {}) as JsonObject;

    expect(variables(functionOf(EXPIRY_HANDLER)).REVIEW_EXPIRY_DAYS).toEqual({ Ref: "ReviewExpiryDays" });
    for (const [, definition] of lambdaFunctions(template).filter(([, d]) => handlerOf(d) !== EXPIRY_HANDLER)) {
      expect(JSON.stringify(propertiesOf(definition))).not.toContain("REVIEW_EXPIRY_DAYS");
    }
    expect(JSON.stringify(template.globals)).not.toContain("REVIEW_EXPIRY_DAYS");
  });

  it("gives the expiry function exactly Query on the status index, UpdateItem on donations and PutItem on audit", () => {
    const statements = statementsOf(functionOf(EXPIRY_HANDLER));

    expect(statements.every((statement) => statement.Effect === "Allow")).toBe(true);
    expect(statements.map((statement) => [actionsOf(statement), statement.Resource])).toEqual([
      [
        ["dynamodb:Query"],
        [
          { "Fn::GetAtt": ["DonationsTable", "Arn"] },
          { "Fn::Sub": "${DonationsTable.Arn}/index/status-createdAt-index" },
        ],
      ],
      [["dynamodb:UpdateItem"], { "Fn::GetAtt": ["DonationsTable", "Arn"] }],
      [["dynamodb:PutItem"], { "Fn::GetAtt": ["AuditTable", "Arn"] }],
    ]);
  });

  it("lets the queue query only the status index of the donations", () => {
    const statements = statementsOf(functionOf("reviews/listReviews.handler"));
    const query = statements.filter((statement) => actionsOf(statement).includes("dynamodb:Query"));

    expect(query).toHaveLength(1);
    expect(query[0].Resource).toEqual([
      { "Fn::GetAtt": ["DonationsTable", "Arn"] },
      { "Fn::Sub": "${DonationsTable.Arn}/index/status-createdAt-index" },
    ]);
  });
});

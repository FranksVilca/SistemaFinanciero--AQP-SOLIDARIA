import { describe, expect, it } from "vitest";
import {
  STAGES,
  eventsOf,
  handlerOf,
  lambdaFunctions,
  loadTemplate,
  propertiesOf,
  resourcesOfType,
  type JsonObject,
} from "./helpers/loadTemplate.js";

const ADMIN_SCOPE = "api/admin.users";
const ADMIN_HANDLERS = ["admin/listUsers.handler", "admin/changeUserRole.handler"];

describe.each(STAGES)("administration of roles in stage %s", (stage) => {
  const template = loadTemplate(stage);
  const functionOf = (handler: string) => {
    const found = lambdaFunctions(template).find(([, definition]) => handlerOf(definition) === handler);
    if (!found) throw new Error(`No function with handler ${handler}`);
    return found[1];
  };

  it("adds the ADMIN group to the single user pool", () => {
    const groups = resourcesOfType(template, "AWS::Cognito::UserPoolGroup").map(([, group]) => propertiesOf(group));

    expect(groups.find((group) => group.GroupName === "ADMIN")).toMatchObject({ UserPoolId: { Ref: "CognitoUserPool" } });
    expect(resourcesOfType(template, "AWS::Cognito::UserPool")).toHaveLength(1);
  });

  it("declares the admin.users scope and lets the SPA client request it", () => {
    const server = propertiesOf(template.resources.CognitoResourceServer);
    const client = propertiesOf(template.resources.CognitoUserPoolClient);

    expect((server.Scopes as JsonObject[]).map((scope) => scope.ScopeName)).toContain("admin.users");
    expect(client.AllowedOAuthScopes).toContain(ADMIN_SCOPE);
  });

  it.each([
    ["admin/listUsers.handler", "/v1/admin/users", "GET"],
    ["admin/changeUserRole.handler", "/v1/admin/users/{userId}/roles", "POST"],
  ])("exposes %s at %s %s behind the JWT authorizer with the admin scope only", (handler, path, method) => {
    const events = eventsOf(functionOf(handler));

    expect(events).toHaveLength(1);
    const [, event] = events[0];
    expect(event.Type).toBe("HttpApi");
    expect(propertiesOf(event)).toEqual({
      Path: path,
      Method: method,
      ApiId: { Ref: "HttpApi" },
      Auth: { AuthorizationScopes: [ADMIN_SCOPE] },
    });
  });

  it("lets no other route be called with the admin scope", () => {
    for (const [, definition] of lambdaFunctions(template).filter(([, d]) => !ADMIN_HANDLERS.includes(handlerOf(d)))) {
      expect(JSON.stringify(eventsOf(definition))).not.toContain(ADMIN_SCOPE);
    }
  });

  it("never gives the administration functions access to donations, projects or the idempotency table", () => {
    for (const handler of ADMIN_HANDLERS) {
      const text = JSON.stringify(propertiesOf(functionOf(handler)).Policies);

      for (const table of ["DonationsTable", "ProjectsTable", "IdempotencyTable"]) expect(text).not.toContain(table);
    }
  });
});

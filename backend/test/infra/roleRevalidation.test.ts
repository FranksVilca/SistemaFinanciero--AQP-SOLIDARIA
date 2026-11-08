import { describe, expect, it } from "vitest";
import {
  STAGES,
  handlerOf,
  lambdaFunctions,
  loadTemplate,
  policiesOf,
  propertiesOf,
  type Json,
  type JsonObject,
} from "./helpers/loadTemplate.js";

/**
 * A token keeps the groups it was issued with, so the sensitive actions ask Cognito for the current ones
 * (backend/src/authz/currentGroups.ts). That needs one permission, on one pool, for exactly these functions.
 */
const SENSITIVE_HANDLERS = [
  "projects/publishProject.handler",
  "audit/getAuditEvents.handler",
  "donations/simulateDonation.handler",
];
const LIST_GROUPS = "cognito-idp:AdminListGroupsForUser";

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource: Json;
}

const statementsOf = (definition: JsonObject): Statement[] =>
  policiesOf(definition).flatMap((policy) => (policy as unknown as { Statement: Statement[] }).Statement);
const actionsOf = (statement: Statement): string[] => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]);

describe.each(STAGES)("role revalidation permissions in stage %s", (stage) => {
  const template = loadTemplate(stage);
  const functions = lambdaFunctions(template);

  it("lets exactly the sensitive functions read the groups of a user", () => {
    const withPermission = functions
      .filter(([, definition]) => statementsOf(definition).some((statement) => actionsOf(statement).includes(LIST_GROUPS)))
      .map(([, definition]) => handlerOf(definition))
      .sort();

    expect(withPermission).toEqual(
      SENSITIVE_HANDLERS.filter((handler) => stage === "academic" || !handler.includes("simulateDonation")).sort()
    );
  });

  it("grants that single Cognito action, on the user pool of the stack only", () => {
    for (const [, definition] of functions) {
      const cognito = statementsOf(definition).filter((statement) =>
        actionsOf(statement).some((action) => action.startsWith("cognito-idp:"))
      );

      for (const statement of cognito) {
        expect(statement.Effect).toBe("Allow");
        expect(actionsOf(statement)).toEqual([LIST_GROUPS]);
        expect(statement.Resource).toEqual({ "Fn::GetAtt": ["CognitoUserPool", "Arn"] });
      }
    }
  });

  it("tells the sensitive functions which pool to ask, and no other function", () => {
    const pool = (definition: JsonObject) =>
      ((propertiesOf(definition).Environment as JsonObject | undefined)?.Variables as JsonObject | undefined)
        ?.COGNITO_USER_POOL_ID;
    const globals = ((template.globals.Function as JsonObject).Environment as JsonObject).Variables as JsonObject;

    // Not global: a function that the pool names as its trigger cannot reference the pool (circular dependency).
    expect(globals.COGNITO_USER_POOL_ID).toBeUndefined();
    for (const [, definition] of functions) {
      const sensitive = SENSITIVE_HANDLERS.includes(handlerOf(definition));
      expect(pool(definition)).toEqual(sensitive ? { Ref: "CognitoUserPool" } : undefined);
    }
  });
});

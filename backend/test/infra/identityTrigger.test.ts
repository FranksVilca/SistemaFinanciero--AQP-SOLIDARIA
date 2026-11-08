import { describe, expect, it } from "vitest";
import {
  STAGES,
  attachedPolicyDocuments,
  eventsOf,
  handlerOf,
  lambdaFunctions,
  loadTemplate,
  propertiesOf,
  resourcesOfType,
  type JsonObject,
} from "./helpers/loadTemplate.js";

/**
 * Whoever registers becomes a donor: the pool calls a function when a registration is confirmed. That wiring is where a
 * template goes wrong without a test noticing (a circular dependency, a permission on the wrong pool, a function that
 * Cognito cannot invoke), and only a deployment would show it.
 */

const TRIGGER = "AddDonorToGroupFunction";
const TRIGGER_HANDLER = "identity/addDonorToGroup.handler";

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
}

describe.each(STAGES)("registration trigger in stage %s", (stage) => {
  const template = loadTemplate(stage);
  const [, pool] = resourcesOfType(template, "AWS::Cognito::UserPool")[0];
  const [, trigger] = lambdaFunctions(template).find(([name]) => name === TRIGGER)!;

  it("is the post-confirmation trigger of the pool, and only that", () => {
    const config = propertiesOf(pool).LambdaConfig as JsonObject;

    expect(handlerOf(trigger)).toBe(TRIGGER_HANDLER);
    expect(config.PostConfirmation).toEqual({ "Fn::GetAtt": [TRIGGER, "Arn"] });
    expect(Object.keys(config)).toEqual(["PostConfirmation"]);
    expect(eventsOf(trigger)).toHaveLength(0); // not reachable through the API
  });

  it("states that anyone may register, instead of leaving it to a default", () => {
    expect(propertiesOf(pool).AdminCreateUserConfig).toEqual({ AllowAdminCreateUserOnly: false });
  });

  it("lets Cognito invoke the function, from this pool only", () => {
    const permissions = resourcesOfType(template, "AWS::Lambda::Permission").filter(
      ([, permission]) => JSON.stringify(propertiesOf(permission).FunctionName).includes(TRIGGER)
    );

    expect(permissions).toHaveLength(1);
    expect(propertiesOf(permissions[0][1])).toMatchObject({
      Action: "lambda:InvokeFunction",
      Principal: "cognito-idp.amazonaws.com",
      SourceArn: { "Fn::GetAtt": ["CognitoUserPool", "Arn"] },
    });
  });

  it("may add a user to a group of this pool and do nothing else with Cognito", () => {
    const [document] = attachedPolicyDocuments(template, TRIGGER);
    const statements = document.Statement as unknown as Statement[];

    expect(attachedPolicyDocuments(template, TRIGGER)).toHaveLength(1);
    expect(statements).toEqual([
      {
        Effect: "Allow",
        Action: "cognito-idp:AdminAddUserToGroup",
        Resource: { "Fn::GetAtt": ["CognitoUserPool", "Arn"] },
      },
    ]);
  });

  it("does not reference the pool anywhere else (the pool names it as its trigger: that would be a cycle)", () => {
    const inline = JSON.stringify(propertiesOf(trigger));
    const globals = JSON.stringify(template.globals);

    expect(inline).not.toContain("CognitoUserPool");
    expect(globals).not.toContain("CognitoUserPool");
  });
});

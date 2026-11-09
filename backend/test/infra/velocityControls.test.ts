import { describe, expect, it } from "vitest";
import {
  STAGES,
  handlerOf,
  lambdaFunctions,
  loadTemplate,
  policiesOf,
  propertiesOf,
  rawParameters,
  type JsonObject,
} from "./helpers/loadTemplate.js";

const PARAMETERS = {
  VelocityMaxPerMinute: { env: "VELOCITY_MAX_PER_MINUTE", default: 5 },
  VelocityReviewThresholdCents: { env: "VELOCITY_REVIEW_THRESHOLD_CENTS", default: 500_000 },
  VelocityStructuringCount: { env: "VELOCITY_STRUCTURING_COUNT", default: 3 },
} as const;

interface Statement {
  Action: string | string[];
  Resource: unknown;
}

const actionsOf = (statement: Statement) => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]);

describe("velocity thresholds are template parameters", () => {
  it.each(Object.entries(PARAMETERS))("declares %s as a positive number with its default", (name, expected) => {
    const parameter = rawParameters()[name];

    expect(parameter).toMatchObject({ Type: "Number", Default: expected.default, MinValue: 1 });
  });
});

describe.each(STAGES)("velocity controls of CreateDonation in stage %s", (stage) => {
  const template = loadTemplate(stage);
  const [, createDonation] = lambdaFunctions(template).find(
    ([, definition]) => handlerOf(definition) === "donations/createDonation.handler"
  )!;
  const statements = policiesOf(createDonation).flatMap(
    (policy) => (policy as JsonObject).Statement as unknown as Statement[]
  );

  it("passes every threshold to the function from its parameter", () => {
    const variables = ((propertiesOf(createDonation).Environment as JsonObject).Variables ?? {}) as JsonObject;

    for (const [name, { env }] of Object.entries(PARAMETERS)) expect(variables[env]).toEqual({ Ref: name });
  });

  it("grants UpdateItem for the counters on the idempotency table only", () => {
    const withUpdate = statements.filter((statement) => actionsOf(statement).includes("dynamodb:UpdateItem"));

    expect(withUpdate).toHaveLength(1);
    expect(actionsOf(withUpdate[0])).toEqual(["dynamodb:UpdateItem"]);
    expect(withUpdate[0].Resource).toEqual({ "Fn::GetAtt": ["IdempotencyTable", "Arn"] });
  });

  it("gives no other function the thresholds", () => {
    const others = lambdaFunctions(template).filter(([, definition]) => definition !== createDonation);

    for (const [, definition] of others) expect(JSON.stringify(propertiesOf(definition))).not.toContain("VELOCITY_");
    expect(JSON.stringify(template.globals)).not.toContain("VELOCITY_");
  });
});

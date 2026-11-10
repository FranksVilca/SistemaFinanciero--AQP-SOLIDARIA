import { describe, expect, it } from "vitest";
import { STAGES, loadTemplate, propertiesOf, rawParameters, resourcesOfType, type Json, type JsonObject } from "./helpers/loadTemplate.js";

const budgetsOf = (stage: (typeof STAGES)[number], overrides: Record<string, string> = {}) =>
  resourcesOfType(loadTemplate(stage, overrides), "AWS::Budgets::Budget");

describe.each(STAGES)("spend alert in stage %s", (stage) => {
  it("is not created without an alert email, so a deployment never needs one", () => {
    expect(budgetsOf(stage)).toHaveLength(0);
  });

  it("is created when an alert email is given, as a monthly cost budget on the account", () => {
    const [[, budget]] = budgetsOf(stage, { AlertEmail: "alertas@example.com" });
    const { Budget } = propertiesOf(budget) as { Budget: JsonObject };

    expect(Budget.BudgetType).toBe("COST");
    expect(Budget.TimeUnit).toBe("MONTHLY");
    expect((Budget.BudgetLimit as JsonObject).Unit).toBe("USD");
  });

  it("warns by email at 80% and 100% of what was spent and at 100% of the forecast", () => {
    const [[, budget]] = budgetsOf(stage, { AlertEmail: "alertas@example.com" });
    const notifications = propertiesOf(budget).NotificationsWithSubscribers as JsonObject[];
    const rules = notifications.map((entry) => {
      const { NotificationType, Threshold, ThresholdType, ComparisonOperator } = entry.Notification as JsonObject;
      expect(ThresholdType).toBe("PERCENTAGE");
      expect(ComparisonOperator).toBe("GREATER_THAN");
      for (const subscriber of entry.Subscribers as JsonObject[]) expect(subscriber.SubscriptionType).toBe("EMAIL");
      return `${NotificationType} ${Threshold}`;
    });

    expect(rules.sort()).toEqual(["ACTUAL 100", "ACTUAL 80", "FORECASTED 100"]);
  });
});

describe("alert parameters", () => {
  const parameters = rawParameters();

  it("keeps the email out of the repository: it defaults to empty and only an email address is accepted", () => {
    expect(parameters.AlertEmail.Default).toBe("");
    const pattern = new RegExp(String(parameters.AlertEmail.AllowedPattern));
    expect(pattern.test("")).toBe(true);
    expect(pattern.test("alertas@example.com")).toBe(true);
    expect(pattern.test("no es un correo")).toBe(false);
  });

  it("has a small default limit, never zero", () => {
    expect(Number(parameters.MonthlyBudgetUsd.Default)).toBeGreaterThan(0);
    expect(Number(parameters.MonthlyBudgetUsd.Default)).toBeLessThanOrEqual(10);
  });
});

describe.each(STAGES)("Cognito plan in stage %s", (stage) => {
  it("is stated in the template (it used to be the CloudFormation default and nobody chose it)", () => {
    const [[, pool]] = resourcesOfType(loadTemplate(stage), "AWS::Cognito::UserPool");
    const tier: Json | undefined = propertiesOf(pool).UserPoolTier;

    expect(tier).toBe("ESSENTIALS");
  });
});

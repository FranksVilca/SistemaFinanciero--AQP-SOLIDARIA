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

const EMAIL = { AlertEmail: "alertas@example.com" };

describe.each(STAGES)("alarms in stage %s", (stage) => {
  it("are not created without an alert email", () => {
    const template = loadTemplate(stage);
    for (const type of ["AWS::CloudWatch::Alarm", "AWS::SNS::Topic", "AWS::SNS::Subscription"]) {
      expect(resourcesOfType(template, type), type).toHaveLength(0);
    }
  });

  it("are four, mail one topic and nothing else, so the monthly cost stays at cents", () => {
    const template = loadTemplate(stage, EMAIL);
    const alarms = resourcesOfType(template, "AWS::CloudWatch::Alarm");
    const [[topicId]] = resourcesOfType(template, "AWS::SNS::Topic");
    const [[, subscription]] = resourcesOfType(template, "AWS::SNS::Subscription");

    expect(alarms).toHaveLength(4);
    expect(propertiesOf(subscription).Protocol).toBe("email");
    for (const [name, alarm] of alarms) {
      expect(propertiesOf(alarm).AlarmActions, name).toEqual([{ Ref: topicId }]);
      expect(propertiesOf(alarm).OKActions, `${name} does not mail when it recovers`).toBeUndefined();
    }
  });

  it("watch the 5xx of the API, the errors and throttles of Lambda, and the daily job not running", () => {
    const alarms = resourcesOfType(loadTemplate(stage, EMAIL), "AWS::CloudWatch::Alarm");
    const watched = alarms.map(([, alarm]) => `${propertiesOf(alarm).Namespace} ${propertiesOf(alarm).MetricName}`);

    expect(watched.sort()).toEqual(["AWS/ApiGateway 5xx", "AWS/Lambda Errors", "AWS/Lambda Invocations", "AWS/Lambda Throttles"]);
  });

  it("never alarm on 4xx, which are the expected refusals (D9)", () => {
    const alarms = resourcesOfType(loadTemplate(stage, EMAIL), "AWS::CloudWatch::Alarm");
    expect(alarms.map(([, alarm]) => propertiesOf(alarm).MetricName)).not.toContain("4xx");
  });

  it("treat missing data as healthy, except the daily job, whose silence is the failure", () => {
    for (const [name, alarm] of resourcesOfType(loadTemplate(stage, EMAIL), "AWS::CloudWatch::Alarm")) {
      const silence = propertiesOf(alarm).MetricName === "Invocations";
      expect(propertiesOf(alarm).TreatMissingData, name).toBe(silence ? "breaching" : "notBreaching");
    }
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

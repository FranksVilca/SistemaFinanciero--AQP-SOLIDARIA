import { describe, expect, it } from "vitest";
import { STAGES, loadTemplate, type JsonObject } from "./helpers/loadTemplate.js";

describe.each(STAGES)("session revalidation settings in stage %s", (stage) => {
  const environment = ((loadTemplate(stage).globals.Function as JsonObject).Environment as JsonObject).Variables as JsonObject;

  it("gives every function the Cognito userInfo endpoint built from the domain prefix", () => {
    const value = JSON.stringify(environment.COGNITO_USERINFO_URL);

    expect(value).toContain("CognitoDomainPrefix");
    expect(value).toContain("/oauth2/userInfo");
  });

  it("requests the openid scope, which the userInfo endpoint requires", () => {
    const template = loadTemplate(stage);
    const client = Object.values(template.resources).find((resource) => resource.Type === "AWS::Cognito::UserPoolClient")!;

    expect(JSON.stringify(client)).toContain('"openid"');
  });
});

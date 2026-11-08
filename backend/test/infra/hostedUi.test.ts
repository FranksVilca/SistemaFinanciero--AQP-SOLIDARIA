import { describe, expect, it } from "vitest";
import { STAGES, loadTemplate, propertiesOf, resourcesOfType } from "./helpers/loadTemplate.js";

/**
 * Cognito accepts, for the classic hosted UI, only these class names and, for each, only these properties
 * (https://docs.aws.amazon.com/cognito/latest/developerguide/hosted-ui-classic-branding.html). Anything else makes
 * the deployment fail, and nothing but a deployment to AWS would show it, so the template is checked here.
 */
const COLORS = ["color", "background-color"];
const ALLOWED_PROPERTIES: Record<string, string[]> = {
  "background-customizable": ["background-color"],
  "banner-customizable": ["padding", "background-color"],
  "errorMessage-customizable": ["margin", "padding", "font-size", "width", "background", "border", "color", "box-sizing"],
  "idpButton-customizable": ["height", "width", "text-align", "margin-bottom", "color", "background-color", "border-color"],
  "idpButton-customizable:hover": COLORS,
  "idpDescription-customizable": ["padding-top", "padding-bottom", "display", "font-size", "color"],
  "inputField-customizable": ["width", "height", "color", "background-color", "border"],
  "inputField-customizable:focus": ["border-color", "outline"],
  "label-customizable": ["font-weight", "color"],
  "legalText-customizable": ["color", "font-size"],
  "logo-customizable": ["max-width", "max-height", "background-color"],
  "passwordCheck-valid-customizable": ["color"],
  "passwordCheck-notValid-customizable": ["color"],
  "redirect-customizable": [],
  "socialButton-customizable": ["height", "text-align", "width", "margin-bottom"],
  "submitButton-customizable": ["font-size", "font-weight", "margin", "width", "height", "color", "background-color"],
  "submitButton-customizable:hover": COLORS,
  "textDescription-customizable": ["padding-top", "padding-bottom", "display", "font-size", "color"],
};
const FORBIDDEN = /@import|@supports|@page|@media|javascript:|<script|expression\(/i;

interface Rule {
  selector: string;
  properties: string[];
}

function parseRules(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector.trim(),
    properties: body
      .split(";")
      .map((declaration) => declaration.split(":")[0].trim())
      .filter(Boolean),
  }));
}

describe.each(STAGES)("hosted sign-in page branding in stage %s", (stage) => {
  const template = loadTemplate(stage);
  const attachments = resourcesOfType(template, "AWS::Cognito::UserPoolUICustomizationAttachment");

  it("brands the hosted sign-in page of every app client, once the domain exists", () => {
    expect(attachments).toHaveLength(1);
    const [, attachment] = attachments[0];

    expect(propertiesOf(attachment).ClientId).toBe("ALL");
    expect(propertiesOf(attachment).UserPoolId).toEqual({ Ref: "CognitoUserPool" });
    expect(attachment.DependsOn).toBe("CognitoUserPoolDomain");
  });

  it("uses the classic hosted UI, the only one the CSS branding applies to and the one the free plan includes", () => {
    const [[, domain]] = resourcesOfType(template, "AWS::Cognito::UserPoolDomain");

    expect(propertiesOf(domain).ManagedLoginVersion).toBe(1);
  });

  it("uses only the class names and properties Cognito accepts", () => {
    const css = String(propertiesOf(attachments[0][1]).CSS);
    const rules = parseRules(css);

    expect(rules.length).toBeGreaterThan(0);
    expect(css).not.toMatch(FORBIDDEN);
    for (const { selector, properties } of rules) {
      expect(selector.startsWith("."), `selector "${selector}" must be a class`).toBe(true);
      const allowed = ALLOWED_PROPERTIES[selector.slice(1)];
      expect(allowed, `class "${selector}" is not customizable in the hosted UI`).toBeDefined();
      for (const property of properties) {
        expect(allowed, `"${property}" is not allowed for ${selector}`).toContain(property);
      }
    }
  });

  it("keeps the legible contrast of the submit button (white on the brand colour)", () => {
    const css = String(propertiesOf(attachments[0][1]).CSS);

    expect(css).toMatch(/\.submitButton-customizable \{[^}]*color: #ffffff;[^}]*background-color: #4f46e5;/);
  });
});

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadTemplate, propertiesOf, rawBootstrapTemplate, rawTemplate, type Json, type JsonObject } from "./helpers/loadTemplate.js";

/**
 * The identity that deploys this application from GitHub (infra/bootstrap/github-oidc.yaml). It is the most privileged
 * thing in the repository, and a template that creates it cannot be tried without an AWS account, so what makes it safe
 * is checked here: who can assume it, what it can do, and that what the application template needs is covered.
 */

const bootstrap = rawBootstrapTemplate();
const resources = bootstrap.Resources as Record<string, JsonObject>;
const parameters = bootstrap.Parameters as Record<string, JsonObject>;

interface Statement {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: Json;
  Principal?: Json;
  Condition?: Record<string, Record<string, Json>>;
}

const actionsOf = (statement: Statement): string[] => (Array.isArray(statement.Action) ? statement.Action : [statement.Action]);
const statementsOf = (document: Json): Statement[] => (document as unknown as { Statement: Statement[] }).Statement;

const githubRole = resources.GitHubDeployRole;
const executionRole = resources.CloudFormationExecutionRole;
const githubStatements = statementsOf(((propertiesOf(githubRole).Policies as JsonObject[])[0] as JsonObject).PolicyDocument);
const executionStatements = ["ComputeAndDataPolicy", "EdgeAndIdentityPolicy"].flatMap((name) =>
  statementsOf(propertiesOf(resources[name]).PolicyDocument)
);

// Resolves the substitutions of a template string the way a deployment of the academic stage would.
const resolveSub = (value: Json): string =>
  String(typeof value === "object" && value !== null && "Fn::Sub" in value ? (value as JsonObject)["Fn::Sub"] : value)
    .replaceAll("${AWS::Partition}", "aws")
    .replaceAll("${AWS::Region}", "us-east-1")
    .replaceAll("${AWS::AccountId}", "123456789012")
    .replaceAll("${StageName}", "academic");
const matches = (glob: string, value: string): boolean =>
  new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`).test(value);
const resourcesOf = (statement: Statement): string[] =>
  (Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource]).map((resource) =>
    typeof resource === "object" && resource !== null && "Fn::GetAtt" in resource ? "<role>" : resolveSub(resource)
  );

describe("who can assume the role that GitHub uses", () => {
  const trust = statementsOf(propertiesOf(githubRole).AssumeRolePolicyDocument)[0];
  const trustStatements = statementsOf(propertiesOf(githubRole).AssumeRolePolicyDocument);

  it("is the OIDC provider of GitHub, through a web identity, and nothing else", () => {
    expect(trustStatements).toHaveLength(1);
    expect(trust.Effect).toBe("Allow");
    expect(trust.Action).toBe("sts:AssumeRoleWithWebIdentity");
    expect(resolveSub((trust.Principal as JsonObject).Federated)).toBe(
      "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    );
  });

  it("requires the audience of AWS and exactly one repository and one branch, with no pattern", () => {
    const condition = trust.Condition!;

    expect(Object.keys(condition)).toEqual(["StringEquals"]); // never StringLike or a "ForAnyValue" operator
    expect(Object.keys(condition.StringEquals)).toEqual([
      "token.actions.githubusercontent.com:aud",
      "token.actions.githubusercontent.com:sub",
    ]);
    expect(condition.StringEquals["token.actions.githubusercontent.com:aud"]).toBe("sts.amazonaws.com");
    expect(condition.StringEquals["token.actions.githubusercontent.com:sub"]).toEqual({
      "Fn::Sub": "repo:${GitHubRepository}:ref:refs/heads/${GitHubBranch}",
    });
  });

  it("defaults to this repository and to main, and the parameters cannot hold a wildcard", () => {
    expect(parameters.GitHubRepository.Default).toBe("FranksVilca/SistemaFinanciero--AQP-SOLIDARIA");
    expect(parameters.GitHubBranch.Default).toBe("main");
    for (const [name, attempt] of [
      ["GitHubRepository", "*/x"],
      ["GitHubRepository", "owner/*"],
      ["GitHubRepository", "owner/repo*"],
      ["GitHubBranch", "*"],
      ["GitHubBranch", "release/*"],
    ] as const) {
      expect(new RegExp(String(parameters[name].AllowedPattern)).test(attempt), `${name} accepts ${attempt}`).toBe(false);
    }
  });

  it("lives for one hour at most", () => {
    expect(propertiesOf(githubRole).MaxSessionDuration).toBeLessThanOrEqual(3600);
  });
});

describe("what the role that GitHub uses can do", () => {
  const allActions = githubStatements.flatMap(actionsOf);

  it("has no wildcard action and only allows", () => {
    expect(githubStatements.every((statement) => statement.Effect === "Allow")).toBe(true);
    expect(allActions.filter((action) => action.includes("*"))).toEqual([]);
  });

  it("manages the stack only through change sets, never creating or deleting it directly", () => {
    const cloudformation = allActions.filter((action) => action.startsWith("cloudformation:"));

    expect(cloudformation).not.toContain("cloudformation:DeleteStack");
    expect(cloudformation).not.toContain("cloudformation:CreateStack");
    expect(cloudformation).not.toContain("cloudformation:UpdateStack");
    expect(cloudformation).toContain("cloudformation:CreateChangeSet");
    expect(cloudformation).toContain("cloudformation:ExecuteChangeSet");
  });

  it("can create nothing in AWS itself: its only IAM action hands the stack the execution role, and only to CloudFormation", () => {
    const iam = githubStatements.filter((statement) => actionsOf(statement).some((action) => action.startsWith("iam:")));

    expect(iam).toHaveLength(1);
    expect(iam[0].Action).toBe("iam:PassRole");
    expect(iam[0].Resource).toEqual({ "Fn::GetAtt": ["CloudFormationExecutionRole", "Arn"] });
    expect(iam[0].Condition).toEqual({ StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" } });
    expect(new Set(allActions.map((action) => action.split(":")[0]))).toEqual(new Set(["cloudformation", "s3", "iam", "cloudfront"]));
  });

  it("limits the stack to the one of this application and the buckets to the artifacts and the frontend", () => {
    for (const statement of githubStatements) {
      for (const resource of resourcesOf(statement)) {
        if (actionsOf(statement)[0].startsWith("cloudformation:")) {
          expect(
            [
              "arn:aws:cloudformation:us-east-1:123456789012:stack/aqp-solidaria-academic/*",
              "arn:aws:cloudformation:us-east-1:aws:transform/Serverless-2016-10-31",
              "arn:aws:cloudformation:us-east-1:123456789012:stack/aws-sam-cli-managed-default/*",
            ],
            resource
          ).toContain(resource);
        }
        if (actionsOf(statement)[0].startsWith("s3:")) {
          expect(resource).toMatch(/^arn:aws:s3:::(aws-sam-cli-managed-default-samclisourcebucket-\*|aqp-solidaria-spa-academic-123456789012)(\/\*)?$/);
        }
      }
    }
  });

  it("only invalidates the cache of CloudFront distributions of this account", () => {
    const invalidation = githubStatements.find((statement) => statement.Action === "cloudfront:CreateInvalidation")!;

    expect(resourcesOf(invalidation)).toEqual(["arn:aws:cloudfront::123456789012:distribution/*"]);
  });
});

describe("the role that creates the resources, usable only by CloudFormation", () => {
  const trust = statementsOf(propertiesOf(executionRole).AssumeRolePolicyDocument);
  const allActions = executionStatements.flatMap(actionsOf);

  it("is assumed by the CloudFormation service for the stack of this application and for this account only", () => {
    expect(trust).toHaveLength(1);
    expect(trust[0].Principal).toEqual({ Service: "cloudformation.amazonaws.com" });
    expect(trust[0].Condition).toMatchObject({
      StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } },
    });
    expect(resolveSub(trust[0].Condition!.ArnLike["aws:SourceArn"])).toBe(
      "arn:aws:cloudformation:us-east-1:123456789012:stack/aqp-solidaria-academic/*"
    );
  });

  it("carries only its own two policies, no managed policy of AWS", () => {
    expect(propertiesOf(executionRole).ManagedPolicyArns).toEqual([{ Ref: "ComputeAndDataPolicy" }, { Ref: "EdgeAndIdentityPolicy" }]);
    expect(propertiesOf(executionRole).Policies).toBeUndefined();
  });

  it("allows only, with no action that is a wildcard", () => {
    expect(executionStatements.every((statement) => statement.Effect === "Allow")).toBe(true);
    expect(allActions.filter((action) => action.includes("*"))).toEqual([]);
  });

  it("uses no service that the application does not need", () => {
    expect(new Set(allActions.map((action) => action.split(":")[0]))).toEqual(
      new Set(["dynamodb", "lambda", "iam", "apigateway", "logs", "cognito-idp", "cloudfront", "s3", "cloudtrail"])
    );
  });

  it("can create roles only in the namespace of the application, which excludes the two roles of the CI", () => {
    const iam = executionStatements.filter((statement) => actionsOf(statement).some((action) => action.startsWith("iam:")));
    const names = [
      resolveSub(propertiesOf(githubRole).RoleName),
      resolveSub(propertiesOf(executionRole).RoleName),
    ];

    expect(iam).toHaveLength(3);
    for (const statement of iam) {
      expect(resourcesOf(statement)).toEqual(["arn:aws:iam::123456789012:role/aqp-solidaria-academic-*"]);
      for (const name of names) expect(matches("aqp-solidaria-academic-*", name), `${name} must be out of reach`).toBe(false);
    }
    expect(allActions.filter((action) => /iam:(CreateUser|CreateAccessKey|CreateLoginProfile|PutUserPolicy|AttachUserPolicy|CreatePolicy|PutRolePermissionsBoundary|DeleteRolePermissionsBoundary)/.test(action))).toEqual([]);
  });

  it("attaches to those roles the basic execution policy of Lambda and no other, and hands them only to Lambda", () => {
    const attach = executionStatements.find((statement) => actionsOf(statement).includes("iam:AttachRolePolicy"))!;
    const pass = executionStatements.find((statement) => statement.Action === "iam:PassRole")!;

    expect(attach.Condition).toEqual({
      ArnEquals: { "iam:PolicyARN": { "Fn::Sub": "arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" } },
    });
    expect(pass.Condition).toEqual({ StringEquals: { "iam:PassedToService": "lambda.amazonaws.com" } });
  });

  it("names a resource for everything that accepts one, and the names are those of the application", () => {
    const ALLOWED_WITHOUT_RESOURCE = [
      "LogDeliveryOfTheApiAccessLog",
      "CreatingAndFindingUserPools",
      "Distribution",
      "FindingTrails",
    ];
    const withoutResource = executionStatements.filter((statement) => resourcesOf(statement).includes("*"));

    expect(withoutResource.map((statement) => statement.Sid)).toEqual(ALLOWED_WITHOUT_RESOURCE);
    for (const statement of executionStatements.filter((candidate) => !withoutResource.includes(candidate))) {
      for (const resource of resourcesOf(statement)) {
        expect(resource, `${statement.Sid}`).toMatch(/^arn:aws:[a-z0-9-]+:(us-east-1)?:?(123456789012)?:?.*(aqp|aws-sam-cli|apis|tags|userpool)/);
      }
    }
  });
});

describe("what the application template needs is covered", () => {
  const granted = new Set(executionStatements.flatMap(actionsOf));
  const raw = rawTemplate().Resources as Record<string, JsonObject>;

  // SAM turns these into the resources on the right; the others are created as they are written.
  const EXPANDS_TO: Record<string, string[]> = {
    "AWS::Serverless::Function": ["AWS::Lambda::Function", "AWS::IAM::Role"],
    "AWS::Serverless::HttpApi": ["AWS::ApiGatewayV2::Api", "AWS::ApiGatewayV2::Stage"],
  };
  // The action that creates each type: if the role cannot do it, the deployment fails.
  const CREATED_BY: Record<string, string[]> = {
    "AWS::ApiGatewayV2::Api": ["apigateway:POST"],
    "AWS::ApiGatewayV2::Stage": ["apigateway:POST"],
    "AWS::CloudFront::Distribution": ["cloudfront:CreateDistribution"],
    "AWS::CloudFront::OriginAccessControl": ["cloudfront:CreateOriginAccessControl"],
    "AWS::CloudFront::ResponseHeadersPolicy": ["cloudfront:CreateResponseHeadersPolicy"],
    "AWS::CloudTrail::Trail": ["cloudtrail:CreateTrail"],
    "AWS::Cognito::UserPool": ["cognito-idp:CreateUserPool"],
    "AWS::Cognito::UserPoolClient": ["cognito-idp:CreateUserPoolClient"],
    "AWS::Cognito::UserPoolDomain": ["cognito-idp:CreateUserPoolDomain"],
    "AWS::Cognito::UserPoolGroup": ["cognito-idp:CreateGroup"],
    "AWS::Cognito::UserPoolResourceServer": ["cognito-idp:CreateResourceServer"],
    "AWS::Cognito::UserPoolUICustomizationAttachment": ["cognito-idp:SetUICustomization"],
    "AWS::DynamoDB::Table": ["dynamodb:CreateTable", "dynamodb:PutResourcePolicy"],
    "AWS::IAM::Policy": ["iam:PutRolePolicy"],
    "AWS::IAM::Role": ["iam:CreateRole", "iam:PassRole"],
    "AWS::Lambda::Function": ["lambda:CreateFunction"],
    "AWS::Lambda::Permission": ["lambda:AddPermission"],
    "AWS::Logs::LogGroup": ["logs:CreateLogGroup"],
    "AWS::S3::Bucket": ["s3:CreateBucket"],
    "AWS::S3::BucketPolicy": ["s3:PutBucketPolicy"],
  };
  // Off by default in the free plan: turning them on fails the deployment until their permissions are added on purpose.
  const NOT_COVERED = ["AWS::GuardDuty::Detector", "AWS::SecurityHub::Hub"];

  const needed = [...new Set(Object.values(raw).flatMap((resource) => EXPANDS_TO[String(resource.Type)] ?? [String(resource.Type)]))];

  it("lets the role create every type of resource of the template, except the options that are off by default", () => {
    for (const type of needed.filter((candidate) => !NOT_COVERED.includes(candidate))) {
      expect(CREATED_BY[type], `add ${type} to CREATED_BY and to infra/bootstrap/github-oidc.yaml`).toBeDefined();
      for (const action of CREATED_BY[type]) expect(granted.has(action), `${type} needs ${action}`).toBe(true);
    }
  });

  it("leaves uncovered only the options that the template turns off by default", () => {
    const resolved = Object.keys(loadTemplate("academic").resources);
    const types = needed.filter((type) => NOT_COVERED.includes(type));

    expect(types.sort()).toEqual([...NOT_COVERED].sort());
    for (const [name, resource] of Object.entries(raw)) {
      if (NOT_COVERED.includes(String(resource.Type))) expect(resolved, `${name} must be off by default`).not.toContain(name);
    }
  });

  it("scopes by the names that the template really gives its resources", () => {
    const policy = (name: string) => statementsOf(propertiesOf(resources[name]).PolicyDocument);
    const scope = (policyName: string, sid: string) => resourcesOf(policy(policyName).find((statement) => statement.Sid === sid)!);
    const nameOf = (type: string, property: string) =>
      Object.values(raw)
        .filter((resource) => resource.Type === type)
        .map((resource) => resolveSub(propertiesOf(resource)[property] as Json));

    const tableArn = (name: string) => `arn:aws:dynamodb:us-east-1:123456789012:table/${name}`;
    for (const name of nameOf("AWS::DynamoDB::Table", "TableName")) {
      expect(scope("ComputeAndDataPolicy", "Tables").some((glob) => matches(glob, tableArn(name))), name).toBe(true);
    }
    for (const name of nameOf("AWS::Logs::LogGroup", "LogGroupName")) {
      const arn = `arn:aws:logs:us-east-1:123456789012:log-group:${name}`;
      expect(scope("ComputeAndDataPolicy", "LogGroups").some((glob) => matches(glob, arn)), name).toBe(true);
    }
    for (const name of nameOf("AWS::S3::Bucket", "BucketName")) {
      expect(scope("EdgeAndIdentityPolicy", "AppBuckets").some((glob) => matches(glob, `arn:aws:s3:::${name}`)), name).toBe(true);
    }
    for (const name of nameOf("AWS::CloudTrail::Trail", "TrailName")) {
      expect(scope("EdgeAndIdentityPolicy", "Trail").some((glob) => matches(glob, `arn:aws:cloudtrail:us-east-1:123456789012:trail/${name}`)), name).toBe(true);
    }
  });
});

describe("the pipeline uses this identity", () => {
  const ci = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../.github/workflows/ci.yml"), "utf8");

  it("deploys the stack whose name the roles are scoped to, handing it the execution role", () => {
    expect(ci).toContain("--stack-name aqp-solidaria-academic");
    expect(ci).toContain("--role-arn ${{ vars.AWS_CLOUDFORMATION_ROLE_ARN }}");
    expect(ci).toContain("role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}");
  });

  it("only deploys when the three variables that identify the deployment are set", () => {
    for (const variable of ["AWS_DEPLOY_ROLE_ARN", "AWS_CLOUDFORMATION_ROLE_ARN", "COGNITO_DOMAIN_PREFIX"]) {
      expect(ci, variable).toContain(`vars.${variable} != ''`);
    }
  });
});

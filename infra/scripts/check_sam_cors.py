"""Checks the CORS that API Gateway will receive, by running the SAM translator on the template as CloudFormation does.

A condition around a whole list made SAM write `x-amazon-apigateway-cors` wrongly; API Gateway ignored it and the
deployed API answered no preflight request. The tests that read the template after resolving its conditions cannot see
that, only the translated template can.

    pip install aws-sam-translator
    python infra/scripts/check_sam_cors.py infra/template.yaml
"""

import json
import sys

from samtranslator.translator.transform import transform
from samtranslator.yaml_helper import yaml_parse

REQUIRED_LISTS = ("allowOrigins", "allowHeaders", "allowMethods")


class NoManagedPolicies:
    """The template uses inline policies only, so no managed policy has to be looked up."""

    def load(self):
        return {}


def translate(path):
    with open(path, encoding="utf-8") as handle:
        manifest = yaml_parse(handle)
    for resource in manifest["Resources"].values():
        if resource.get("Type") == "AWS::Serverless::Function":
            resource["Properties"]["CodeUri"] = "s3://bucket/code.zip"  # `sam package` puts the real address here
    return transform(manifest, {}, NoManagedPolicies())


def problems_of(cors):
    if not isinstance(cors, dict):
        return [f"x-amazon-apigateway-cors must be an object, SAM wrote: {json.dumps(cors)[:200]}"]
    problems = []
    for name in REQUIRED_LISTS:
        value = cors.get(name)
        if not isinstance(value, list) or not value:
            problems.append(f"{name} must be a non-empty list, SAM wrote: {json.dumps(value)[:200]}")
    if "*" in json.dumps(cors.get("allowOrigins", [])):
        problems.append("allowOrigins must not allow every origin")
    if "CloudFrontDistribution" not in json.dumps(cors.get("allowOrigins", [])):
        problems.append("allowOrigins must allow the CloudFront domain of the stack")
    return problems


def main(path):
    processed = translate(path)
    body = processed["Resources"]["HttpApi"]["Properties"].get("Body", {})
    problems = problems_of(body.get("x-amazon-apigateway-cors"))
    if problems:
        print("The CORS of the API is wrong in the translated template:")
        for problem in problems:
            print(f"  - {problem}")
        sys.exit(1)
    print("CORS of the API as API Gateway receives it: OK")


main(sys.argv[1] if len(sys.argv) > 1 else "infra/template.yaml")

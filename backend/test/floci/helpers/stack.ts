import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CloudFormationClient,
  CreateStackCommand,
  DeleteStackCommand,
  DescribeStacksCommand,
  ListStackResourcesCommand,
  type StackResourceSummary,
} from "@aws-sdk/client-cloudformation";
import { FLOCI_ENV } from "../flociEnv.js";

const TEMPLATE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../infra/template.yaml"),
  "utf8"
);
const CAPABILITIES = ["CAPABILITY_IAM", "CAPABILITY_AUTO_EXPAND", "CAPABILITY_NAMED_IAM"];
const POLL_ATTEMPTS = 60;
const POLL_WAIT_MS = 500;

export const cloudFormation = new CloudFormationClient({
  region: FLOCI_ENV.AWS_REGION,
  endpoint: FLOCI_ENV.FLOCI_ENDPOINT,
  credentials: { accessKeyId: FLOCI_ENV.AWS_ACCESS_KEY_ID, secretAccessKey: FLOCI_ENV.AWS_SECRET_ACCESS_KEY },
});

async function stackStatus(stackName: string): Promise<string | undefined> {
  try {
    const { Stacks } = await cloudFormation.send(new DescribeStacksCommand({ StackName: stackName }));
    return Stacks?.[0]?.StackStatus;
  } catch {
    return undefined; // the stack does not exist
  }
}

async function waitFor(stackName: string, done: (status: string | undefined) => boolean): Promise<string | undefined> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const status = await stackStatus(stackName);
    if (done(status)) return status;
    await new Promise((resolveWait) => setTimeout(resolveWait, POLL_WAIT_MS));
  }
  return stackStatus(stackName);
}

/** Deploys infra/template.yaml (SAM included) as a stack, replacing a previous one, and returns its resources. */
export async function deployStack(
  stackName: string,
  parameters: Record<string, string>,
  templateBody: string = TEMPLATE
): Promise<StackResourceSummary[]> {
  await cloudFormation.send(new DeleteStackCommand({ StackName: stackName }));
  await waitFor(stackName, (status) => status === undefined);

  await cloudFormation.send(
    new CreateStackCommand({
      StackName: stackName,
      TemplateBody: templateBody,
      Capabilities: CAPABILITIES as never,
      Parameters: Object.entries(parameters).map(([ParameterKey, ParameterValue]) => ({
        ParameterKey,
        ParameterValue,
      })),
    })
  );
  const status = await waitFor(stackName, (current) => current !== undefined && !current.endsWith("IN_PROGRESS"));
  if (status !== "CREATE_COMPLETE") throw new Error(`Stack ${stackName} ended as ${status}`);

  const { StackResourceSummaries = [] } = await cloudFormation.send(
    new ListStackResourcesCommand({ StackName: stackName })
  );
  return StackResourceSummaries;
}

/**
 * Deletes a stack and waits until it is gone. The template names its resources, so a stack still being deleted would
 * make the next deployment fail with "already exists".
 */
export async function deleteStack(stackName: string): Promise<void> {
  await cloudFormation.send(new DeleteStackCommand({ StackName: stackName }));
  await waitFor(stackName, (status) => status === undefined || status === "DELETE_COMPLETE");
}

export const countOf = (resources: StackResourceSummary[], type: string): number =>
  resources.filter((resource) => resource.ResourceType === type).length;

export const physicalIdOf = (resources: StackResourceSummary[], type: string): string =>
  resources.find((resource) => resource.ResourceType === type)!.PhysicalResourceId!;

/**
 * The template without the simulation function: what the production stage ends up with, since that function only
 * exists in the academic stage. Floci cannot deploy the production stage from the full template because its static
 * reference check rejects the Fn::If branches that SAM generates around the conditional function; real CloudFormation
 * accepts them.
 */
export function productionEquivalentTemplate(): string {
  const lines = TEMPLATE.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("  SimulateDonationFunction:"));
  if (start < 0) throw new Error("SimulateDonationFunction is no longer declared in the template");

  // The resource ends at the next line that is not indented deeper than the resource name (or is a top-level key).
  let end = start + 1;
  while (end < lines.length && !/^ {0,2}\S/.test(lines[end])) end++;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

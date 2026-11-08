import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inject, vi } from "vitest";
import { FLOCI_ENV } from "../flociEnv.js";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../src");

export const credentialsOf = (handlerRef: string) => inject("functionCredentials")[handlerRef];

export interface RunOptions {
  /**
   * Makes the sensitive actions ask the emulated Cognito, with the function's own credentials, which groups the person
   * holds. Without it the answer is the groups of the token, so a test of DynamoDB permissions does not depend on Cognito.
   */
  userPoolId?: string;
}

type Handler = (event: unknown, context?: unknown) => Promise<unknown>;

/** Runs the real handler with the credentials of its own IAM user. */
export async function runHandlerAs<T = { statusCode: number; body: string }>(
  handlerRef: string,
  event: unknown,
  options: RunOptions = {}
): Promise<T> {
  const { accessKeyId, secretAccessKey } = credentialsOf(handlerRef);
  const names = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "COGNITO_USER_POOL_ID", "COGNITO_IDP_ENDPOINT"] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.AWS_ACCESS_KEY_ID = accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY = secretAccessKey;
  if (options.userPoolId) {
    process.env.COGNITO_USER_POOL_ID = options.userPoolId;
    process.env.COGNITO_IDP_ENDPOINT = FLOCI_ENV.FLOCI_ENDPOINT;
  }
  try {
    vi.resetModules(); // fresh AWS clients that pick up the function credentials
    const separator = handlerRef.lastIndexOf(".");
    const file = resolve(SOURCE_ROOT, `${handlerRef.slice(0, separator)}.ts`);
    const loaded: Record<string, Handler> = await import(pathToFileURL(file).href);
    if (!options.userPoolId) {
      const groups: typeof import("../../../src/authz/currentGroups.js") = await import(
        pathToFileURL(resolve(SOURCE_ROOT, "authz/currentGroups.ts")).href
      );
      groups.replaceGroupsLookup(async (principal) => principal.groups);
    }
    return (await loaded[handlerRef.slice(separator + 1)](event)) as T;
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
}

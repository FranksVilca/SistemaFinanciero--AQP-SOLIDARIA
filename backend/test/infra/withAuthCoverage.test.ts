import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { WITH_AUTH } from "../../src/authz/withAuthMarker.js";
import { STAGES, eventsOf, handlerOf, lambdaFunctions, loadTemplate } from "./helpers/loadTemplate.js";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");

// Cognito triggers are not API routes: nobody calls them with a token, Cognito calls them with an event. They are the
// only functions allowed to skip withAuth, and only while the pool names them as its trigger (identityTrigger.test.ts).
export const COGNITO_TRIGGER_HANDLERS = ["identity/addDonorToGroup.handler"];
// Scheduled jobs are not API routes either: EventBridge calls them on a schedule, with no token. They may skip withAuth
// only while their single event is a schedule (checked below), never an HTTP route.
export const SCHEDULED_JOB_HANDLERS = ["reviews/expireReviews.handler"];
const EXEMPT_HANDLERS = [...COGNITO_TRIGGER_HANDLERS, ...SCHEDULED_JOB_HANDLERS];

/** "projects/listProjects.handler" is exported as `handler` by backend/src/projects/listProjects.ts. */
function resolveHandlerModule(handlerReference: string): { file: string; exportName: string } {
  const separator = handlerReference.lastIndexOf(".");
  return {
    file: resolve(SOURCE_ROOT, `${handlerReference.slice(0, separator)}.ts`),
    exportName: handlerReference.slice(separator + 1),
  };
}

export function isWithAuthHandler(candidate: unknown): boolean {
  return typeof candidate === "function" && (candidate as unknown as Record<symbol, unknown>)[WITH_AUTH] === true;
}

describe("every API route is exported through withAuth, and only Cognito triggers and scheduled jobs are not", () => {
  it("rejects a handler that was not produced by withAuth", () => {
    expect(isWithAuthHandler(async () => ({ statusCode: 200 }))).toBe(false);
    expect(isWithAuthHandler(undefined)).toBe(false);
  });

  describe.each(STAGES)("stage %s", (stage) => {
    const functions = lambdaFunctions(loadTemplate(stage));
    const handlers = functions.map(([name, definition]) => [name, handlerOf(definition)] as const);

    it("declares at least one function", () => {
      expect(handlers.length).toBeGreaterThan(0);
    });

    const routes = handlers.filter(([, handlerReference]) => !EXEMPT_HANDLERS.includes(handlerReference));

    it.each(routes)("%s uses withAuth (%s)", async (_name, handlerReference) => {
      const { file, exportName } = resolveHandlerModule(handlerReference);
      const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);

      expect(isWithAuthHandler(loaded[exportName])).toBe(true);
    });

    it("exempts only the declared Cognito triggers and scheduled jobs", () => {
      const exempted = handlers.map(([, handlerReference]) => handlerReference).filter((reference) => EXEMPT_HANDLERS.includes(reference));

      expect(exempted.sort()).toEqual([...EXEMPT_HANDLERS].sort());
    });

    it("gives a scheduled job a schedule and no HTTP route", () => {
      for (const [, definition] of functions.filter(([, d]) => SCHEDULED_JOB_HANDLERS.includes(handlerOf(d)))) {
        const types = eventsOf(definition).map(([, event]) => event.Type);
        expect(types).toEqual(["Schedule"]);
      }
    });
  });
});

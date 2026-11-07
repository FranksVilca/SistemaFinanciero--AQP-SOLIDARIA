import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { WITH_AUTH } from "../../src/authz/withAuthMarker.js";
import { STAGES, handlerOf, lambdaFunctions, loadTemplate } from "./helpers/loadTemplate.js";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");

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

describe("every API route is exported through withAuth", () => {
  it("rejects a handler that was not produced by withAuth", () => {
    expect(isWithAuthHandler(async () => ({ statusCode: 200 }))).toBe(false);
    expect(isWithAuthHandler(undefined)).toBe(false);
  });

  describe.each(STAGES)("stage %s", (stage) => {
    const handlers = lambdaFunctions(loadTemplate(stage)).map(([name, definition]) => [name, handlerOf(definition)] as const);

    it("declares at least one function", () => {
      expect(handlers.length).toBeGreaterThan(0);
    });

    it.each(handlers)("%s uses withAuth (%s)", async (_name, handlerReference) => {
      const { file, exportName } = resolveHandlerModule(handlerReference);
      const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);

      expect(isWithAuthHandler(loaded[exportName])).toBe(true);
    });
  });
});

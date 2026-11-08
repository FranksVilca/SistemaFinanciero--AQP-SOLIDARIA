import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * infra/scripts/publish-frontend.sh runs on a person's machine, often in Git Bash on Windows, and in the CI on Linux.
 * Only a real publication shows some of its mistakes (the first one failed on Windows with "invalid invalidation
 * paths"), so what can be checked without AWS is checked here.
 */

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../infra/scripts/publish-frontend.sh");
const source = readFileSync(SCRIPT, "utf8");

describe("the frontend publication script", () => {
  it("is valid bash and stops at the first error", () => {
    expect(() => execFileSync("bash", ["-n", SCRIPT], { stdio: "pipe" })).not.toThrow();
    expect(source).toMatch(/^set -euo pipefail$/m);
  });

  it("keeps Git Bash from rewriting the invalidation paths as Windows paths, before it uses them", () => {
    const protection = source.indexOf("export MSYS_NO_PATHCONV=1");
    const invalidation = source.indexOf("aws cloudfront create-invalidation");

    expect(protection).toBeGreaterThan(-1);
    expect(invalidation).toBeGreaterThan(protection);
    expect(source).toContain('--paths "/" "/index.html"');
  });

  it("lets the files with a hash in their name be cached for a year and never the page that names them", () => {
    expect(source).toContain('--cache-control "public,max-age=31536000,immutable"');
    expect(source).toContain('--cache-control "no-cache"');
    expect(source.indexOf("--exclude index.html")).toBeGreaterThan(-1);
  });

  it("changes nothing in a dry run", () => {
    const afterDryRun = source.slice(source.indexOf('if [ -n "$DRY_RUN" ]'));

    expect(afterDryRun.indexOf("exit 0")).toBeLessThan(afterDryRun.indexOf("create-invalidation"));
  });

  it("refuses to run when the stack lacks an output, instead of publishing to the wrong place", () => {
    for (const output of ["ApiEndpoint", "UserPoolId", "UserPoolClientId", "FrontendBucketName", "CloudFrontDistributionId"]) {
      expect(source).toContain(`require ${output}`);
    }
  });
});

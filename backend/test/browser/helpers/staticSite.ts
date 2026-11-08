import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import {
  loadTemplate,
  propertiesOf,
  rawParameters,
  resourcesOfType,
  type JsonObject,
} from "../../infra/helpers/loadTemplate.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const REGION = "us-east-1";
// Hosts of the emulator, added to connect-src only: in AWS those requests go to *.amazonaws.com and the Cognito domain.
const EMULATOR_HOSTS = "https://localhost:4566 http://localhost:4566";

/** The content security policy of the CloudFront response headers policy of infra/template.yaml, with its Fn::Sub resolved. */
export function templateContentSecurityPolicy(): string {
  const [, policy] = resourcesOfType(loadTemplate("academic"), "AWS::CloudFront::ResponseHeadersPolicy")[0];
  const config = propertiesOf(policy).ResponseHeadersPolicyConfig as JsonObject;
  const csp = ((config.SecurityHeadersConfig as JsonObject).ContentSecurityPolicy as JsonObject).ContentSecurityPolicy;
  const raw = typeof csp === "string" ? csp : String((csp as JsonObject)["Fn::Sub"]);

  return raw
    .replace(/\$\{CognitoDomainPrefix\}/g, String(rawParameters().CognitoDomainPrefix.Default))
    .replace(/\$\{AWS::Region\}/g, REGION);
}

/** Same policy, with the emulator's hosts allowed for fetch requests so the SPA can talk to it. */
export function emulatorContentSecurityPolicy(): string {
  return templateContentSecurityPolicy().replace(/connect-src ([^;]+);/, `connect-src $1 ${EMULATOR_HOSTS};`);
}

function resolveFile(root: string, urlPath: string): string {
  const candidate = normalize(join(root, decodeURIComponent(urlPath.split("?")[0])));
  const inside = candidate.startsWith(normalize(root));
  return inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : join(root, "index.html");
}

/**
 * Serves the built SPA the way CloudFront does: the files of the bucket, index.html for any other path (the SPA
 * routes) and the security headers of the response headers policy, including the content security policy.
 */
export interface RunningSite {
  close: () => Promise<void>;
}

const DEV_SERVER_ATTEMPTS = 60;

/** Starts the Vite dev server of the frontend (what `npm run local` opens) and waits until it answers. */
export async function startViteDevServer(
  repositoryRoot: string,
  port: number,
  environment: NodeJS.ProcessEnv
): Promise<RunningSite> {
  const child = spawn("npm", ["run", "dev", "--workspace=frontend", "--", "--port", String(port), "--strictPort"], {
    cwd: repositoryRoot,
    env: environment,
    stdio: "ignore",
    shell: true,
  });
  const close = async (): Promise<void> => {
    if (child.pid === undefined) return;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else child.kill("SIGTERM");
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  };

  for (let attempt = 0; attempt < DEV_SERVER_ATTEMPTS; attempt++) {
    try {
      if ((await fetch(`http://localhost:${port}/`)).ok) return { close };
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
  }
  await close();
  throw new Error("The Vite dev server did not start (is port 3000 free?)");
}

export function serveBuiltSite(root: string, port: number, contentSecurityPolicy: string): Promise<RunningSite> {
  const server = createServer((request, response) => {
    const file = resolveFile(root, request.url ?? "/");
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Security-Policy": contentSecurityPolicy,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    response.end(readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(port, "0.0.0.0", () =>
      resolve({ close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())) })
    )
  );
}

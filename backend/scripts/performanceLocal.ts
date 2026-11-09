import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootLocalStack } from "../test/floci/helpers/localStack.js";
import { hostedSignIn } from "../test/floci/helpers/cognitoUsers.js";
import { signInSettings } from "../test/floci/helpers/gateway.js";
import { deleteStack } from "../test/floci/helpers/stack.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const stackName = "zta-performance";
const image = "grafana/k6:1.3.0";

async function prepareDataset(baseUrl: string, token: string): Promise<void> {
  const projects = (await (await fetch(`${baseUrl}/v1/projects`)).json()) as unknown[];
  for (let index = projects.length; index < 50; index++) {
    const response = await fetch(`${baseUrl}/v1/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        title: `Proyecto QA ${index + 1}`,
        description: "Proyecto sintético para medición local de rendimiento.",
        goalAmountCents: 100_000,
      }),
    });
    if (response.status !== 201) throw new Error(`Create fixture failed: ${response.status}`);
    const { projectId } = (await response.json()) as { projectId: string };
    const published = await fetch(`${baseUrl}/v1/projects/${projectId}/publish`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (published.status !== 200) throw new Error(`Publish fixture failed: ${published.status}`);
  }
}

function runK6(baseUrl: string, script: string): void {
  // On Linux, k6's image user cannot write the runner-owned bind mount. Use the host user's UID/GID, not root.
  const owner = process.getuid && process.getgid ? ["--user", `${process.getuid()}:${process.getgid()}`] : [];
  const containerUrl = new URL(baseUrl);
  if (["localhost", "127.0.0.1"].includes(containerUrl.hostname)) {
    containerUrl.hostname = "host.docker.internal";
  }
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      ...owner,
      "--add-host",
      "host.docker.internal:host-gateway",
      "-v",
      `${root}:/work`,
      "-w",
      "/work/.local/performance",
      "-e",
      `API_BASE_URL=${containerUrl.toString().replace(/\/$/, "")}/v1`,
      "-e",
      "TEST_ENVIRONMENT=floci-local",
      "-e",
      "CLIENT_LOCATION=Docker Desktop on developer machine",
      "-e",
      `ITERATIONS=${process.env.PERF_ITERATIONS ?? "100"}`,
      "-e",
      "SUMMARY_PATH=public-reads-summary.json",
      image,
      "run",
      "--insecure-skip-tls-verify",
      "--summary-export",
      `${script}-k6.json`,
      "--out",
      `json=${script}-samples.json`,
      `/work/backend/test/performance/${script}.js`,
    ],
    { stdio: "inherit" }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`k6 ${script} failed with exit ${result.status}`);
}

// Local emulator only. Never seeds or mutates an AWS account. Run sequentially with the other Floci suites.
const stack = await bootLocalStack(stackName, "zta-performance-auth");
try {
  const { scopes, redirectUri } = signInSettings();
  const manager = await hostedSignIn(stack.pool, "gestor@aqpsolidaria.pe", scopes, redirectUri);
  await prepareDataset(stack.baseUrl, manager.accessToken);
  await mkdir(resolve(root, ".local/performance"), { recursive: true });
  runK6(stack.baseUrl, "public-reads");
  runK6(stack.baseUrl, "unauthenticated");
} finally {
  await deleteStack(stackName);
}

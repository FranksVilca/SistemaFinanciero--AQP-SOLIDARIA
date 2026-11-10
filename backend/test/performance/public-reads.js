/* global __ENV, __ITER, console */
import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Trend } from "k6/metrics";

const baseUrl = (__ENV.API_BASE_URL || "").replace(/\/$/, "");
if (!baseUrl) throw new Error("API_BASE_URL is required (including /v1)");
const iterations = Number(__ENV.ITERATIONS || 100);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) {
  throw new Error("ITERATIONS must be between 1 and 1000");
}
const duration = new Trend("read_duration_ms", true);
export const options = {
  vus: 1,
  iterations,
  setupTimeout: "120s",
  summaryTrendStats: ["count", "med", "p(95)", "max"],
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate==0"],
    "read_duration_ms{route:catalog}": ["p(95)<=1500"],
    "read_duration_ms{route:detail}": ["p(95)<=1500"],
    "read_duration_ms{route:stats}": ["p(95)<=1500"],
  },
};

const params = (route) => ({ tags: { route, name: route }, timeout: route === "warmup" ? "30s" : "10s" });

export function setup() {
  const catalog = http.get(`${baseUrl}/projects`, params("warmup"));
  if (catalog.status !== 200) fail(`Catalog warmup returned ${catalog.status}`);
  const projects = catalog.json();
  if (!Array.isArray(projects) || projects.length < 50) fail("At least 50 published projects are required");
  const ids = projects.slice(0, 50).map((project) => project.projectId);
  if (ids.some((id) => typeof id !== "string" || !id)) fail("Catalog has invalid project IDs");
  // Warm all three Lambda handlers before collecting the custom latency metric. These requests remain in raw output.
  for (const path of [`/projects/${ids[0]}`, `/projects/${ids[0]}/stats`]) {
    const response = http.get(`${baseUrl}${path}`, params("warmup"));
    if (response.status !== 200) fail(`Warmup returned ${response.status}`);
    sleep(0.5);
  }
  return { ids, projectCount: projects.length };
}

export default function (data) {
  const projectId = data.ids[__ITER % data.ids.length];
  for (const [route, path] of [
    ["catalog", "/projects"],
    ["detail", `/projects/${projectId}`],
    ["stats", `/projects/${projectId}/stats`],
  ]) {
    const startedAt = Date.now();
    const response = http.get(`${baseUrl}${path}`, params(route));
    // Include ALL measured responses, even errors: a fast 401/429 cannot masquerade as a successful performance run.
    duration.add(Date.now() - startedAt, { route });
    if (response.status !== 200) console.error(`${route}: unexpected HTTP ${response.status}`);
    check(response, { "public GET returns 200": (result) => result.status === 200 }, { route });
    sleep(0.5);
  }
}

export function handleSummary(data) {
  const report = {
    measuredAt: new Date().toISOString(),
    environment: __ENV.TEST_ENVIRONMENT || "unspecified",
    clientLocation: __ENV.CLIENT_LOCATION || "unspecified",
    baseUrl,
    iterations,
    vus: 1,
    requirement: "CA-NF05.1",
    caveat:
      "Warmup is excluded from read_duration_ms. Correlate AWS logs for any later cold starts; do not discard slow samples.",
    ...data,
  };
  const json = JSON.stringify(report, null, 2);
  return { stdout: `${json}\n`, [__ENV.SUMMARY_PATH || "summary.json"]: json };
}

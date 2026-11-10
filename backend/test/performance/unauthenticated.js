/* global __ENV */
import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = (__ENV.API_BASE_URL || "").replace(/\/$/, "");
if (!baseUrl) throw new Error("API_BASE_URL is required (including /v1)");
export const options = {
  vus: 1,
  iterations: 5,
  thresholds: { checks: ["rate==1"], http_req_failed: ["rate==0"] },
};

// This profile verifies denials. Its 401s are expected and never enter the public-read latency metric.
export default function () {
  for (const route of ["/donations/me", "/reviews", "/audit"]) {
    const response = http.get(`${baseUrl}${route}`, {
      responseCallback: http.expectedStatuses(401),
      tags: { name: route },
      timeout: "10s",
    });
    check(response, { "protected route rejects missing token": (result) => result.status === 401 });
    sleep(0.5);
  }
}

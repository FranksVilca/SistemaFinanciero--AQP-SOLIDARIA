import { describe, it, expect } from "vitest";
import {
  LOGOUT_CONTINUE_PATH,
  LOGOUT_QUEUE_TTL_MS,
  buildHostedUiLogoutUrls,
  realmsMissingHostedUiDomain,
  takeNextLogoutHop,
  type HostedUiRealm,
} from "../src/auth/logoutChain.js";

const origin = "https://app.example.org";
const donor: HostedUiRealm = {
  realm: "donor",
  hostedUiDomain: "https://donor.auth.us-east-1.amazoncognito.com",
  clientId: "donor-client",
};
const staff: HostedUiRealm = {
  realm: "staff",
  hostedUiDomain: "https://staff.auth.us-east-1.amazoncognito.com",
  clientId: "staff-client",
};

describe("Hosted UI logout chain", () => {
  it("ends the Hosted UI session of every configured realm, not only the last one", () => {
    const urls = buildHostedUiLogoutUrls([donor, staff], origin);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/^https:\/\/donor\.auth\.us-east-1\.amazoncognito\.com\/logout\?/);
    expect(urls[1]).toMatch(/^https:\/\/staff\.auth\.us-east-1\.amazoncognito\.com\/logout\?/);
  });

  it("sends each realm its own client_id and returns to the continuation route", () => {
    const [donorUrl, staffUrl] = buildHostedUiLogoutUrls([donor, staff], origin).map((u) => new URL(u));
    expect(donorUrl.searchParams.get("client_id")).toBe("donor-client");
    expect(staffUrl.searchParams.get("client_id")).toBe("staff-client");
    for (const url of [donorUrl, staffUrl]) {
      expect(url.searchParams.get("logout_uri")).toBe(`${origin}${LOGOUT_CONTINUE_PATH}`);
    }
  });

  it("skips realms whose Hosted UI domain is not configured", () => {
    const urls = buildHostedUiLogoutUrls([{ ...donor, hostedUiDomain: "" }, staff], origin);
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).searchParams.get("client_id")).toBe("staff-client");
  });

  it("reports realms without a Hosted UI domain so logout can warn instead of failing silently", () => {
    expect(realmsMissingHostedUiDomain([donor, staff])).toEqual([]);
    expect(realmsMissingHostedUiDomain([{ ...donor, hostedUiDomain: "" }, staff])).toEqual(["donor"]);
  });
});

describe("Logout queue continuation", () => {
  const realms = [donor, staff];
  const [donorUrl, staffUrl] = buildHostedUiLogoutUrls(realms, origin);
  const now = 1_000_000;

  it("takes the next hop and keeps the rest for the following continuation", () => {
    const { next, remaining } = takeNextLogoutHop({ createdAt: now, urls: [donorUrl, staffUrl] }, now, realms);
    expect(next).toBe(donorUrl);
    expect(remaining).toEqual({ createdAt: now, urls: [staffUrl] });
  });

  it("finishes when the queue is empty or missing", () => {
    expect(takeNextLogoutHop({ createdAt: now, urls: [staffUrl] }, now, realms)).toEqual({ next: staffUrl });
    expect(takeNextLogoutHop(null, now, realms)).toEqual({});
  });

  it("never redirects to a URL outside the configured Hosted UI /logout endpoints", () => {
    const queue = {
      createdAt: now,
      urls: [
        "https://evil.example.com/logout?client_id=x",
        "https://donor.auth.us-east-1.amazoncognito.com/oauth2/authorize?client_id=x",
        "javascript:alert(1)",
        "not a url",
        staffUrl,
      ],
    };
    expect(takeNextLogoutHop(queue, now, realms)).toEqual({ next: staffUrl });
  });

  it("discards a stale queue left by an abandoned logout", () => {
    const stale = { createdAt: now - LOGOUT_QUEUE_TTL_MS - 1, urls: [donorUrl, staffUrl] };
    expect(takeNextLogoutHop(stale, now, realms)).toEqual({});
  });

  it("skips a realm whose configured Hosted UI domain is malformed instead of throwing", () => {
    const misconfigured = [{ ...donor, hostedUiDomain: "donor.auth.us-east-1.amazoncognito.com" }, staff];
    const queue = { createdAt: now, urls: [donorUrl, staffUrl] };
    expect(() => takeNextLogoutHop(queue, now, misconfigured)).not.toThrow();
    expect(takeNextLogoutHop(queue, now, misconfigured)).toEqual({ next: staffUrl });
  });

  it("ignores malformed queue payloads", () => {
    expect(takeNextLogoutHop({ urls: [donorUrl] }, now, realms)).toEqual({});
    expect(takeNextLogoutHop({ createdAt: now, urls: "nope" }, now, realms)).toEqual({});
    expect(takeNextLogoutHop([donorUrl], now, realms)).toEqual({});
  });
});

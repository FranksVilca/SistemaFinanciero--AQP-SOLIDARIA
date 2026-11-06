import { describe, it, expect } from "vitest";
import {
  LOGOUT_CONTINUE_PATH,
  buildHostedUiLogoutUrls,
  realmsMissingHostedUiDomain,
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

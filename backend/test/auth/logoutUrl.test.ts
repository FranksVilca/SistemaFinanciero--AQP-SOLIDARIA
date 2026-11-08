import { describe, expect, it } from "vitest";
import { logoutUrlOf } from "../../../frontend/src/auth/revocation.js";

describe("logoutUrlOf", () => {
  it("builds the hosted UI logout of a Cognito domain from its token endpoint", () => {
    const url = logoutUrlOf(
      "https://aqp-solidaria.auth.us-east-1.amazoncognito.com/oauth2/token",
      "client123",
      "https://d111.cloudfront.net"
    );

    expect(url).toBe(
      "https://aqp-solidaria.auth.us-east-1.amazoncognito.com/logout?client_id=client123&logout_uri=https%3A%2F%2Fd111.cloudfront.net"
    );
  });

  it("works for the emulator, whose hosted UI lives under /cognito-idp", () => {
    const url = logoutUrlOf("https://localhost:4566/cognito-idp/oauth2/token", "c1", "http://localhost:3000");

    expect(url).toBe("https://localhost:4566/cognito-idp/logout?client_id=c1&logout_uri=http%3A%2F%2Flocalhost%3A3000");
  });

  it("refuses a token endpoint it does not recognise instead of sending the person somewhere wrong", () => {
    expect(() => logoutUrlOf("https://idp.example.com/connect/token", "c", "http://localhost:3000")).toThrow(
      /cannot derive the logout endpoint/
    );
  });
});

import { describe, expect, it } from "vitest";
import { extractAuthClaims, parseGroupsClaim } from "../src/authz/claims.js";
import { authorize, EmbeddedPolicyAuthorizer, type PolicyAuthorizer } from "../src/authz/evaluateAuthz.js";
import { AUTHZ_ACTIONS } from "../src/shared/constants.js";

const authorizer = new EmbeddedPolicyAuthorizer();
const donor = { sub: "donor-sub-1", groups: ["DONANTE"] };
const manager = { sub: "manager-sub-1", groups: ["GESTOR"] };

describe("policy decisions (T02, T03, T09, T12)", () => {
  it("T02: denies a protected action without identity as UNAUTHENTICATED", async () => {
    const decision = await authorize({ action: AUTHZ_ACTIONS.createDonation, resourceType: "Donation" }, authorizer);
    expect(decision).toEqual({ allowed: false, reason: "UNAUTHENTICATED" });
  });

  it("T03: denies a donor creating a project as ROLE", async () => {
    const decision = await authorize(
      { principal: donor, action: AUTHZ_ACTIONS.createProject, resourceType: "Project" },
      authorizer
    );
    expect(decision).toEqual({ allowed: false, reason: "ROLE" });
  });

  it("allows a manager to create a project", async () => {
    const decision = await authorize(
      { principal: manager, action: AUTHZ_ACTIONS.createProject, resourceType: "Project" },
      authorizer
    );
    expect(decision).toEqual({ allowed: true });
  });

  it("T09: denies a donor acting on another donor's donation as OWNER", async () => {
    const decision = await authorize(
      {
        principal: donor,
        action: AUTHZ_ACTIONS.simulateDonation,
        resourceType: "Donation",
        resourceOwnerSub: "donor-b",
        requiresOwner: true,
      },
      authorizer
    );
    expect(decision).toEqual({ allowed: false, reason: "OWNER" });
  });

  it("T12: denies a manager acting on a donor's donation as ROLE", async () => {
    const decision = await authorize(
      {
        principal: manager,
        action: AUTHZ_ACTIONS.simulateDonation,
        resourceType: "Donation",
        resourceOwnerSub: "donor-sub-1",
        requiresOwner: true,
      },
      authorizer
    );
    expect(decision).toEqual({ allowed: false, reason: "ROLE" });
  });

  it("fails closed when the policy engine throws", async () => {
    const brokenEngine: PolicyAuthorizer = {
      isAuthorized: async () => {
        throw new Error("engine down");
      },
    };

    const decision = await authorize(
      { principal: manager, action: AUTHZ_ACTIONS.createProject, resourceType: "Project" },
      brokenEngine
    );

    expect(decision).toEqual({ allowed: false, reason: "ENGINE_ERROR" });
  });

  it("allows public actions without identity", async () => {
    const decision = await authorize({ action: AUTHZ_ACTIONS.listProjects, resourceType: "Project" }, authorizer);
    expect(decision).toEqual({ allowed: true });
  });
});

describe("claims extraction (T11)", () => {
  it("returns no principal when the event carries no authorizer claims", () => {
    expect(extractAuthClaims({})).toBeUndefined();
  });

  it("extracts sub, email and groups from verified claims", () => {
    const principal = extractAuthClaims({
      requestContext: {
        authorizer: {
          jwt: { claims: { sub: "sub-123", email: "donor@aqpsolidaria.pe", "cognito:groups": '["DONANTE"]' } },
        },
      },
    });

    expect(principal).toEqual({ sub: "sub-123", email: "donor@aqpsolidaria.pe", groups: ["DONANTE"] });
  });

  it.each([
    [
      ["A", "B"],
      ["A", "B"],
    ],
    ['["A","B"]', ["A", "B"]],
    ["[A B]", ["A", "B"]],
    ["[A,B]", ["A", "B"]],
    ["A", ["A"]],
    [undefined, []],
    [42, []],
  ])("parses the groups claim %j", (raw, expected) => {
    expect(parseGroupsClaim(raw)).toEqual(expected);
  });
});

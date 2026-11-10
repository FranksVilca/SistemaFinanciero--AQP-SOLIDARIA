import { describe, expect, it } from "vitest";
import { extractAuthClaims, parseGroupsClaim } from "../src/authz/claims.js";
import {
  authorize,
  EmbeddedPolicyAuthorizer,
  violatesSeparationOfDuties,
  type PolicyAuthorizer,
} from "../src/authz/evaluateAuthz.js";
import { AUTHZ_ACTIONS, SENSITIVE_ACTIONS } from "../src/shared/constants.js";

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
          jwt: {
            claims: {
              sub: "sub-123",
              token_use: "access",
              email: "donor@aqpsolidaria.pe",
              "cognito:groups": '["DONANTE"]',
            },
          },
        },
      },
    });

    expect(principal).toEqual({ sub: "sub-123", email: "donor@aqpsolidaria.pe", groups: ["DONANTE"] });
  });

  it("ignores claims of an ID token", () => {
    const principal = extractAuthClaims({
      requestContext: {
        authorizer: { jwt: { claims: { sub: "sub-123", token_use: "id", "cognito:groups": ["DONANTE"] } } },
      },
    });

    expect(principal).toBeUndefined();
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

describe("separation of duties", () => {
  it.each([
    [["AUDITOR"], false],
    [["DONANTE"], false],
    [["GESTOR", "DONANTE"], false],
    [["AUDITOR", "DONANTE"], true],
    [["AUDITOR", "GESTOR"], true],
    [["AUDITOR", "unrelated-group"], false],
  ])("groups %j violate it: %s", (groups, expected) => {
    expect(violatesSeparationOfDuties(groups)).toBe(expected);
  });

  it("denies every protected action to a combined auditor, with its own reason", async () => {
    const combined = { sub: "sub-1", groups: ["AUDITOR", "DONANTE"] };

    for (const action of [AUTHZ_ACTIONS.viewAudit, AUTHZ_ACTIONS.createDonation, AUTHZ_ACTIONS.viewMyDonations]) {
      const decision = await authorize({ principal: combined, action, resourceType: "Donation" }, authorizer);
      expect(decision).toEqual({ allowed: false, reason: "SEPARATION_OF_DUTIES" });
    }
  });
});

describe("review of donations held by the velocity controls", () => {
  const reviewActions = [AUTHZ_ACTIONS.listReviews, AUTHZ_ACTIONS.reviewDonation];

  it.each(reviewActions)("allows a REVISOR to %s", async (action) => {
    const reviewer = { sub: "reviewer-1", groups: ["REVISOR"] };

    expect(await authorize({ principal: reviewer, action, resourceType: "Donation" }, authorizer)).toEqual({
      allowed: true,
    });
  });

  it.each([
    ["DONANTE", AUTHZ_ACTIONS.listReviews],
    ["DONANTE", AUTHZ_ACTIONS.reviewDonation],
    ["GESTOR", AUTHZ_ACTIONS.listReviews],
    ["GESTOR", AUTHZ_ACTIONS.reviewDonation],
    ["AUDITOR", AUTHZ_ACTIONS.listReviews],
    ["AUDITOR", AUTHZ_ACTIONS.reviewDonation],
  ])("denies %s the action %s as ROLE", async (group, action) => {
    const decision = await authorize(
      { principal: { sub: "someone", groups: [group] }, action, resourceType: "Donation" },
      authorizer
    );

    expect(decision).toEqual({ allowed: false, reason: "ROLE" });
  });

  it.each(reviewActions)("denies an AUDITOR who is also REVISOR the action %s", async (action) => {
    const combined = { sub: "sub-2", groups: ["AUDITOR", "REVISOR"] };

    expect(violatesSeparationOfDuties(combined.groups)).toBe(true);
    expect(await authorize({ principal: combined, action, resourceType: "Donation" }, authorizer)).toEqual({
      allowed: false,
      reason: "SEPARATION_OF_DUTIES",
    });
  });

  it("lets a REVISOR also be DONANTE: the conflict with their own donations is decided per donation", async () => {
    const reviewer = { sub: "sub-3", groups: ["REVISOR", "DONANTE"] };

    expect(violatesSeparationOfDuties(reviewer.groups)).toBe(false);
    expect(
      await authorize(
        { principal: reviewer, action: AUTHZ_ACTIONS.reviewDonation, resourceType: "Donation" },
        authorizer
      )
    ).toEqual({ allowed: true });
  });

  it("refuses a REVISOR who is also GESTOR everything: one person would approve what they publish", async () => {
    const both = { sub: "sub-4", groups: ["REVISOR", "GESTOR"] };

    expect(violatesSeparationOfDuties(both.groups)).toBe(true);
    for (const action of [AUTHZ_ACTIONS.reviewDonation, AUTHZ_ACTIONS.createProject]) {
      expect(await authorize({ principal: both, action, resourceType: "Donation" }, authorizer)).toEqual({
        allowed: false,
        reason: "SEPARATION_OF_DUTIES",
      });
    }
  });

  it("revalidates the session and the groups of a review decision", () => {
    expect(SENSITIVE_ACTIONS).toContain(AUTHZ_ACTIONS.reviewDonation);
  });
});

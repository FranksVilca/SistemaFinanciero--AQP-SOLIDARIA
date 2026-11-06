import { describe, it, expect, vi } from "vitest";
import { EmbeddedPolicyAuthorizer, AuthzContext } from "../src/authz/evaluateAuthz.js";
import { VerifiedPermissionsAuthorizer } from "../src/authz/cedarAdapter.js";

// Mock VerifiedPermissionsClient
vi.mock("@aws-sdk/client-verifiedpermissions", () => {
  return {
    VerifiedPermissionsClient: class MockClient {
      send(command: any) {
        const action = command.input.action.actionId;
        const groups = command.input.entities.entityList[0]?.parents?.map((p: any) => p.entityId) || [];
        const donorSub = command.input.entities.entityList[1]?.attributes?.donorSub?.string;
        const principalId = command.input.principal.entityId;

        // Cedar policy emulation matching policies.cedar
        if (action === "CreateProject" || action === "PublishProject") {
          return Promise.resolve({ decision: groups.includes("GESTOR") ? "ALLOW" : "DENY" });
        }

        if (action === "CreateDonation") {
          return Promise.resolve({ decision: groups.includes("DONANTE") ? "ALLOW" : "DENY" });
        }

        if (action === "ViewDonation" || action === "SimulateDonation") {
          if (!groups.includes("DONANTE")) {
            return Promise.resolve({ decision: "DENY" });
          }
          if (donorSub && donorSub !== principalId) {
            return Promise.resolve({ decision: "DENY" });
          }
          return Promise.resolve({ decision: "ALLOW" });
        }

        if (action === "ViewAudit") {
          return Promise.resolve({ decision: groups.includes("AUDITOR") ? "ALLOW" : "DENY" });
        }

        return Promise.resolve({ decision: "DENY" });
      }
    },
    IsAuthorizedCommand: class MockCommand {
      constructor(public input: unknown) {}
    },
  };
});

describe("User Story 8 - Cedar & Verified Permissions Equivalence (HU-12, T03, T09, T12)", () => {
  const embedded = new EmbeddedPolicyAuthorizer();
  const external = new VerifiedPermissionsAuthorizer("test-policy-store");

  it("T03: Donor creating project -> both must DENY", async () => {
    const ctx: AuthzContext = {
      principal: { sub: "donor-1", groups: ["DONANTE"] },
      action: "CreateProject",
      resourceType: "Project",
    };

    const embeddedResult = await embedded.isAuthorized(ctx);
    const externalResult = await external.isAuthorized(ctx);

    expect(embeddedResult).toBe(false);
    expect(externalResult).toBe(false);
    expect(embeddedResult).toBe(externalResult);
  });

  it("T09: Donor accessing another donor's donation -> both must DENY (BOLA)", async () => {
    const ctx: AuthzContext = {
      principal: { sub: "donor-alice", groups: ["DONANTE"] },
      action: "ViewDonation",
      resourceType: "Donation",
      resourceOwnerSub: "donor-bob",
    };

    const embeddedResult = await embedded.isAuthorized(ctx);
    const externalResult = await external.isAuthorized(ctx);

    expect(embeddedResult).toBe(false);
    expect(externalResult).toBe(false);
    expect(embeddedResult).toBe(externalResult);
  });

  it("T12: Gestor querying donor donation -> both must DENY", async () => {
    const ctx: AuthzContext = {
      principal: { sub: "gestor-1", groups: ["GESTOR"] },
      action: "ViewDonation",
      resourceType: "Donation",
      resourceOwnerSub: "donor-1",
    };

    const embeddedResult = await embedded.isAuthorized(ctx);
    const externalResult = await external.isAuthorized(ctx);

    expect(embeddedResult).toBe(false);
    expect(externalResult).toBe(false);
    expect(embeddedResult).toBe(externalResult);
  });

  it("Legitimate actions: Gestor creating project & Donor viewing own donation -> both must ALLOW", async () => {
    const gestorCtx: AuthzContext = {
      principal: { sub: "gestor-1", groups: ["GESTOR"] },
      action: "CreateProject",
      resourceType: "Project",
    };

    const donorOwnCtx: AuthzContext = {
      principal: { sub: "donor-1", groups: ["DONANTE"] },
      action: "ViewDonation",
      resourceType: "Donation",
      resourceOwnerSub: "donor-1",
    };

    expect(await embedded.isAuthorized(gestorCtx)).toBe(true);
    expect(await external.isAuthorized(gestorCtx)).toBe(true);

    expect(await embedded.isAuthorized(donorOwnCtx)).toBe(true);
    expect(await external.isAuthorized(donorOwnCtx)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import {
  enforceAuthz,
  extractAuthClaims,
  EmbeddedPolicyAuthorizer,
} from "../src/authz/evaluateAuthz.js";
import { UnauthorizedError, ForbiddenError } from "../src/shared/errors.js";

describe("User Story 2 & Security Tests - Zero Trust Auth & RBAC (HU-03, HU-04, T02, T03, T09, T11, T12)", () => {
  const authorizer = new EmbeddedPolicyAuthorizer();

  it("T02: should reject unauthenticated requests with UnauthorizedError (401)", async () => {
    const context = {
      action: "CreateDonation" as const,
      resourceType: "Donation" as const,
    };

    await expect(enforceAuthz(context, authorizer)).rejects.toThrow(UnauthorizedError);
  });

  it("T03: should reject donor attempting to create a project with ForbiddenError (403)", async () => {
    const donorPrincipal = {
      sub: "donor-sub-1",
      groups: ["DONANTE"],
    };

    const context = {
      principal: donorPrincipal,
      action: "CreateProject" as const,
      resourceType: "Project" as const,
    };

    await expect(enforceAuthz(context, authorizer)).rejects.toThrow(ForbiddenError);
  });

  it("should permit GESTOR to create project", async () => {
    const gestorPrincipal = {
      sub: "gestor-sub-1",
      groups: ["GESTOR"],
    };

    const context = {
      principal: gestorPrincipal,
      action: "CreateProject" as const,
      resourceType: "Project" as const,
    };

    await expect(enforceAuthz(context, authorizer)).resolves.not.toThrow();
  });

  it("T09 (BOLA): should reject donor attempting to view or simulate another donor's donation", async () => {
    const donorA = {
      sub: "donor-a",
      groups: ["DONANTE"],
    };

    const context = {
      principal: donorA,
      action: "ViewDonation" as const,
      resourceType: "Donation" as const,
      resourceOwnerSub: "donor-b", // Another donor
    };

    await expect(enforceAuthz(context, authorizer)).rejects.toThrow(ForbiddenError);
  });

  it("T12: should reject GESTOR attempting to access donor private history", async () => {
    const gestor = {
      sub: "gestor-sub-1",
      groups: ["GESTOR"],
    };

    const context = {
      principal: gestor,
      action: "ViewDonation" as const,
      resourceType: "Donation" as const,
      resourceOwnerSub: "donor-sub-1",
    };

    await expect(enforceAuthz(context, authorizer)).rejects.toThrow(ForbiddenError);
  });

  it("T11: extractAuthClaims should correctly reject event without authorizer claims", () => {
    const eventWithoutAuth = {};
    expect(extractAuthClaims(eventWithoutAuth)).toBeUndefined();

    // Valid claims extraction
    const eventWithAuth = {
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              sub: "sub-123",
              email: "donor@aqpsolidaria.pe",
              "cognito:groups": '["DONANTE"]',
            },
          },
        },
      },
    };

    const principal = extractAuthClaims(eventWithAuth);
    expect(principal).toBeDefined();
    expect(principal?.sub).toBe("sub-123");
    expect(principal?.groups).toContain("DONANTE");
  });
});

describe("cognito:groups claim parsing (API Gateway flattened formats)", () => {
  const eventWithGroups = (rawGroups: unknown) => ({
    requestContext: {
      authorizer: { jwt: { claims: { sub: "sub-1", "cognito:groups": rawGroups } } },
    },
  });

  it.each([
    ["native array", ["GESTOR", "AUDITOR"]],
    ["JSON string", '["GESTOR","AUDITOR"]'],
    ["HTTP API bracketed, space separated", "[GESTOR AUDITOR]"],
    ["bracketed, comma separated", "[GESTOR, AUDITOR]"],
    ["plain comma separated", "GESTOR,AUDITOR"],
  ])("extracts groups from %s", (_label, rawGroups) => {
    expect(extractAuthClaims(eventWithGroups(rawGroups))?.groups).toEqual(["GESTOR", "AUDITOR"]);
  });

  it("extracts a single bracketed group as sent by HTTP API", () => {
    expect(extractAuthClaims(eventWithGroups("[GESTOR]"))?.groups).toEqual(["GESTOR"]);
  });

  it("returns no groups when the claim is absent", () => {
    expect(extractAuthClaims(eventWithGroups(undefined))?.groups).toEqual([]);
  });
});

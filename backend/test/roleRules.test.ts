import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  EXCLUSIVE_ROLES,
  addableRoles,
  findIncompatibleRoles,
  holdsExclusiveRole,
  removableRoles,
  rolesAmong,
  violatesSeparationOfDuties,
} from "../src/shared/roleRules.js";

const ROLES = ["DONANTE", "GESTOR", "REVISOR", "AUDITOR", "ADMIN"] as const;

// The table of the design (backend/src/shared/roleRules.ts), written out so that any change of a rule is a visible one.
const COMPATIBLE: Record<string, string[]> = {
  DONANTE: ["GESTOR", "REVISOR"],
  GESTOR: ["DONANTE"],
  REVISOR: ["DONANTE"],
  AUDITOR: [],
  ADMIN: [],
};

describe("which roles can be held together", () => {
  const pairs = ROLES.flatMap((first) =>
    ROLES.filter((second) => first !== second).map((second) => [first, second] as const)
  );

  it.each(pairs)("%s with %s", (first, second) => {
    expect(violatesSeparationOfDuties([first, second])).toBe(!COMPATIBLE[first].includes(second));
  });

  it("is symmetric: the order of the groups never matters", () => {
    for (const [first, second] of pairs) {
      expect(violatesSeparationOfDuties([first, second])).toBe(violatesSeparationOfDuties([second, first]));
    }
  });

  it("allows a single role, none, and the allowed pair of a donor with a manager or a reviewer", () => {
    for (const role of ROLES) expect(violatesSeparationOfDuties([role])).toBe(false);
    expect(violatesSeparationOfDuties([])).toBe(false);
    expect(violatesSeparationOfDuties(["DONANTE", "GESTOR"])).toBe(false);
    expect(violatesSeparationOfDuties(["DONANTE", "REVISOR"])).toBe(false);
  });

  it("refuses the three roles of the ordinary operation together, because a manager is not a reviewer", () => {
    expect(findIncompatibleRoles(["DONANTE", "GESTOR", "REVISOR"])).toEqual(["GESTOR", "REVISOR"]);
  });

  it("ignores groups that are not roles, and repetitions", () => {
    expect(rolesAmong(["DONANTE", "DONANTE", "GESTOR_FAKE", "gestor"])).toEqual(["DONANTE"]);
    expect(violatesSeparationOfDuties(["AUDITOR", "GESTOR_FAKE"])).toBe(false);
  });

  it("holds alone the roles that audit or grant", () => {
    expect(EXCLUSIVE_ROLES).toEqual(["AUDITOR", "ADMIN"]);
    expect(holdsExclusiveRole(["DONANTE", "AUDITOR"])).toBe(true);
    expect(holdsExclusiveRole(["ADMIN"])).toBe(true);
    expect(holdsExclusiveRole(["DONANTE", "GESTOR", "REVISOR"])).toBe(false);
  });
});

describe("what an administrator may give and take away", () => {
  it("never includes the auditor or the administrator among the roles of the application", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["DONANTE", "GESTOR", "REVISOR"]);
  });

  it.each([
    [["DONANTE"], ["GESTOR", "REVISOR"], ["DONANTE"]],
    [["DONANTE", "GESTOR"], [], ["DONANTE", "GESTOR"]],
    [["DONANTE", "REVISOR"], [], ["DONANTE", "REVISOR"]],
    [["GESTOR"], ["DONANTE"], ["GESTOR"]],
    [["REVISOR"], ["DONANTE"], ["REVISOR"]],
    [[], ["DONANTE", "GESTOR", "REVISOR"], []],
  ])("for %j: can give %j and take away %j", (groups, addable, removable) => {
    expect(addableRoles(groups)).toEqual(addable);
    expect(removableRoles(groups)).toEqual(removable);
  });

  it.each([["AUDITOR"], ["ADMIN"], ["DONANTE", "AUDITOR"], ["ADMIN", "DONANTE"]])(
    "can neither give nor take anything from someone who holds %j",
    (...groups) => {
      expect(addableRoles(groups)).toEqual([]);
      expect(removableRoles(groups)).toEqual([]);
    }
  );

  it("never offers a role that would make the combination invalid", () => {
    for (const first of ROLES) {
      for (const second of ROLES) {
        const groups = first === second ? [first] : [first, second];
        for (const role of addableRoles(groups)) expect(violatesSeparationOfDuties([...groups, role])).toBe(false);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { isNoOp, parseRoleNames, planRoleChange } from "../../scripts/roleCommands.js";

const okPlan = (result: ReturnType<typeof planRoleChange>) => {
  if (!result.ok) throw new Error(`Expected a plan, got: ${result.error}`);
  return result;
};
const error = (result: ReturnType<typeof planRoleChange>) => {
  if (result.ok) throw new Error("Expected a refusal");
  return result.error;
};

describe("the roles named on the command line", () => {
  it("accepts any case, spaces and repetitions", () => {
    expect(parseRoleNames(["revisor", " Donante ", "REVISOR"])).toEqual({ roles: ["REVISOR", "DONANTE"] });
  });

  it("names the first one that is not a role, as it was typed", () => {
    expect(parseRoleNames(["DONANTE", "superuser"])).toEqual({ invalid: "superuser" });
  });
});

describe("add", () => {
  it("adds a role to someone who has another one that is compatible", () => {
    const plan = okPlan(planRoleChange(["DONANTE"], "add", ["REVISOR"]));

    expect(plan).toMatchObject({
      before: ["DONANTE"],
      after: ["DONANTE", "REVISOR"],
      toAdd: ["REVISOR"],
      toRemove: [],
    });
  });

  it("does nothing when the person already has the role", () => {
    expect(isNoOp(okPlan(planRoleChange(["DONANTE", "REVISOR"], "add", ["REVISOR"])))).toBe(true);
  });

  it("refuses GESTOR + REVISOR", () => {
    expect(error(planRoleChange(["DONANTE", "REVISOR"], "add", ["GESTOR"]))).toContain("no pueden combinarse");
  });

  it.each(["AUDITOR", "ADMIN"])("refuses %s on top of other roles and points to `set`", (role) => {
    expect(error(planRoleChange(["DONANTE"], "add", [role]))).toContain("`set`");
  });

  it("refuses any role on top of AUDITOR or ADMIN", () => {
    expect(error(planRoleChange(["AUDITOR"], "add", ["DONANTE"]))).toContain("no pueden combinarse");
    expect(error(planRoleChange(["ADMIN"], "add", ["GESTOR"]))).toContain("no pueden combinarse");
  });

  it("refuses a request that is itself an invalid combination", () => {
    expect(error(planRoleChange([], "add", ["AUDITOR", "ADMIN"]))).toContain("no pueden combinarse");
  });
});

describe("remove", () => {
  it("takes a role away and keeps the others", () => {
    const plan = okPlan(planRoleChange(["DONANTE", "REVISOR"], "remove", ["DONANTE"]));

    expect(plan).toMatchObject({ after: ["REVISOR"], toRemove: ["DONANTE"], toAdd: [] });
  });

  it("does nothing for a role the person never had", () => {
    expect(isNoOp(okPlan(planRoleChange(["DONANTE"], "remove", ["GESTOR"])))).toBe(true);
  });
});

describe("set", () => {
  it("leaves exactly the roles asked, taking away the others first in the plan", () => {
    const plan = okPlan(planRoleChange(["DONANTE", "GESTOR"], "set", ["ADMIN"]));

    expect(plan).toMatchObject({ after: ["ADMIN"], toRemove: ["DONANTE", "GESTOR"], toAdd: ["ADMIN"] });
  });

  it("makes the first administrator out of an ordinary donor", () => {
    expect(okPlan(planRoleChange(["DONANTE"], "set", ["ADMIN"]))).toMatchObject({
      toRemove: ["DONANTE"],
      toAdd: ["ADMIN"],
    });
  });

  it("refuses to leave a combination that is not allowed", () => {
    expect(error(planRoleChange(["DONANTE"], "set", ["GESTOR", "REVISOR"]))).toContain("GESTOR y REVISOR");
  });

  it("ignores groups that are not roles: they are neither taken away nor counted", () => {
    const plan = okPlan(planRoleChange(["DONANTE", "OTRO_GRUPO"], "set", ["DONANTE"]));

    expect(plan.before).toEqual(["DONANTE"]);
    expect(isNoOp(plan)).toBe(true);
  });
});

it("asks for at least one role", () => {
  expect(error(planRoleChange(["DONANTE"], "add", []))).toContain("al menos un rol");
});

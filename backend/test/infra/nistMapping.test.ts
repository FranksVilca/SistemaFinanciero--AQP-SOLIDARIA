import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MAPPING = readFileSync(resolve(REPOSITORY_ROOT, "docs/nist-800-207-mapping.md"), "utf8");
const NIST_PRINCIPLES = 7;
const REPOSITORY_PATH = /`((?:backend|infra|docs|evidence|specs|policies|\.github)\/[\w./-]+|\.checkov\.yaml)`/g;
const ALLOWED_STATES = ["Cumple", "Parcial"];

describe("NIST SP 800-207 mapping", () => {
  it("covers the seven principles, each with evidence and a state", () => {
    const sections = MAPPING.split(/^## Principio /m).slice(1);

    expect(sections).toHaveLength(NIST_PRINCIPLES);
    sections.forEach((section, index) => {
      expect(section.startsWith(`${index + 1} —`), `principle ${index + 1} is out of order`).toBe(true);
      expect(section, `principle ${index + 1} has no evidence table`).toContain("| Evidencia |");
      const state = /\*\*Estado: ([^*]+)\*\*/.exec(section)?.[1] ?? "";
      expect(
        ALLOWED_STATES.some((allowed) => state.startsWith(allowed)),
        `principle ${index + 1} state: "${state}"`
      ).toBe(true);
    });
  });

  it("names the three NIST components (PA, PEP, PE)", () => {
    for (const component of ["**PA**", "**PEP**", "**PE**"]) expect(MAPPING).toContain(component);
  });

  it("only cites files that exist", () => {
    const cited = [...MAPPING.matchAll(REPOSITORY_PATH)].map((match) => match[1]);
    const missing = cited.filter((path) => !existsSync(resolve(REPOSITORY_ROOT, path)));

    expect(cited.length).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it("states the one principle that is only partially covered", () => {
    expect(MAPPING).toMatch(/Principio 5[\s\S]*Estado: Parcial \(declarado\)/);
  });
});

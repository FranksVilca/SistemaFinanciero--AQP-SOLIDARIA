import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// Tailwind v4 only generates utilities when a stylesheet imports it and the app loads that
// stylesheet; without it every className in the UI renders unstyled.
describe("global stylesheet", () => {
  const stylesheet = new URL("../src/index.css", import.meta.url);

  it("imports Tailwind", () => {
    expect(existsSync(stylesheet)).toBe(true);
    expect(readFileSync(stylesheet, "utf8")).toMatch(/@import\s+["']tailwindcss["']/);
  });

  it("is loaded by the app entry point", () => {
    const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
    expect(main).toMatch(/import\s+["']\.\/index\.css["']/);
  });
});

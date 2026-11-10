import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression: opening an empty mood board crashed with "Maximum update depth
// exceeded" because a store selector returned a fresh `[]` on every read.
describe("Mood board store selectors", () => {
  it("never return a fresh empty array or object literal", () => {
    const src = readFileSync(join(__dirname, "Mood.tsx"), "utf8");
    const selectors = src.match(/use[A-Z]\w*Store\(\(s\)\s*=>[^;]*\);/g) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) {
      expect(sel).not.toMatch(/\?\?\s*(\[\]|\{\})/);
    }
  });
});

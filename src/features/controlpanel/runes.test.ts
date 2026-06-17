import { describe, it, expect } from "vitest";
import { RUNES, pickRune } from "./runes";

describe("pickRune", () => {
  it("is deterministic for a seed", () => {
    expect(pickRune("builtin:web-research")).toBe(pickRune("builtin:web-research"));
  });
  it("always returns a glyph from the library", () => {
    for (const seed of ["a", "b", "c", "builtin:summarizer", ""]) {
      expect(RUNES).toContain(pickRune(seed));
    }
  });
  it("spreads across more than one glyph", () => {
    const seen = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(pickRune));
    expect(seen.size).toBeGreaterThan(1);
  });
});

import { describe, it, expect } from "vitest";
import { skillSigil, hexToRgb } from "./sigil";

describe("skillSigil", () => {
  it("is deterministic for a given seed", () => {
    expect(skillSigil("builtin:web-research")).toEqual(skillSigil("builtin:web-research"));
  });

  it("differs across seeds", () => {
    expect(skillSigil("a")).not.toEqual(skillSigil("b"));
  });

  it("returns an even number of points, all inside the unit box", () => {
    const pts = skillSigil("anything");
    expect(pts.length % 2).toBe(0);
    expect(pts.length).toBeGreaterThanOrEqual(8);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
});

describe("hexToRgb", () => {
  it("parses a 6-digit hex", () => {
    expect(hexToRgb("#b14cff")).toBe("177, 76, 255");
    expect(hexToRgb("00e0ff")).toBe("0, 224, 255");
  });
  it("falls back to violet on bad input", () => {
    expect(hexToRgb("")).toBe("177, 76, 255");
    expect(hexToRgb("nope")).toBe("177, 76, 255");
  });
});

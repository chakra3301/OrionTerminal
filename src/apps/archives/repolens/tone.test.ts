import { describe, it, expect } from "vitest";
import { withTone, tonePreamble, TONES, DEFAULT_TONE } from "./tone";

describe("tone", () => {
  it("neutral has no preamble", () => {
    expect(tonePreamble("neutral")).toBe("");
    expect(withTone("neutral", "BODY")).toBe("BODY");
  });
  it("director prepends a voice directive", () => {
    const out = withTone("director", "BODY");
    expect(out.endsWith("BODY")).toBe(true);
    expect(out.length).toBeGreaterThan("BODY".length);
  });
  it("exposes the 6 tones with neutral default", () => {
    expect(DEFAULT_TONE).toBe("neutral");
    expect(TONES.map((t) => t.key)).toContain("copilot");
  });
});

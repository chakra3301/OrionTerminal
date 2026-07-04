import { describe, it, expect } from "vitest";
import { sourceRasterKey, buildGlyphAtlas, GLYPH_SLOTS, DEFAULT_GLYPH_RAMP } from "./fxRaster";
import { fxEffect } from "./fxRegistry";
import type { FxLayer } from "./fxModel";

function layer(params: FxLayer["params"]): FxLayer {
  return { id: "L", effectId: "ascii", name: "G", opacity: 1, params };
}

describe("sourceRasterKey", () => {
  it("changes when params or resolution change", () => {
    const a = sourceRasterKey(layer({ ramp: "ab" }), 100, 100);
    expect(sourceRasterKey(layer({ ramp: "ab" }), 100, 100)).toBe(a);
    expect(sourceRasterKey(layer({ ramp: "cd" }), 100, 100)).not.toBe(a);
    expect(sourceRasterKey(layer({ ramp: "ab" }), 200, 100)).not.toBe(a);
  });
});

describe("glyph atlas", () => {
  it("is one row of 16 square slots", () => {
    const atlas = buildGlyphAtlas(DEFAULT_GLYPH_RAMP, 0);
    expect(atlas.width).toBe(atlas.height * GLYPH_SLOTS);
    expect(atlas.height).toBeGreaterThan(0);
  });

  it("tolerates an empty ramp (falls back to the default)", () => {
    const atlas = buildGlyphAtlas("", 0);
    expect(atlas.width).toBe(atlas.height * GLYPH_SLOTS);
  });
});

describe("glyph dither spec wiring", () => {
  it("carries an auxiliary texture but is NOT a mask-capable source", () => {
    const spec = fxEffect("ascii")!;
    expect(spec.source).toBe(true); // atlas rides the uSrc slot
    expect(spec.category).toBe("effect"); // …but it's an effect, not a source
    expect(spec.label).toBe("Glyph dither");
  });

  it("samples the atlas with the 16-slot layout the builder produces", () => {
    const spec = fxEffect("ascii")!;
    expect(spec.frag).toContain("15.999"); // slot quantisation
    expect(spec.frag).toContain("/ 16.0"); // atlas column addressing
    expect(spec.frag).toContain("texture(uSrc");
  });
});

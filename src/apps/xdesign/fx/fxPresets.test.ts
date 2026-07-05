import { describe, it, expect } from "vitest";
import { FX_PRESETS, buildPreset } from "./fxPresets";
import { fxEffect, FX_EFFECTS } from "./fxRegistry";
import { sanitizeScene } from "./fxStore";

describe("FX presets", () => {
  it("have unique ids", () => {
    const ids = FX_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("build scenes made only of known effects with valid param keys and bindings", () => {
    for (const preset of FX_PRESETS) {
      const scene = buildPreset(preset);
      expect(scene.layers.length, preset.id).toBeGreaterThan(1);
      for (const l of scene.layers) {
        const spec = fxEffect(l.effectId);
        expect(spec, `${preset.id}: unknown effect ${l.effectId}`).toBeDefined();
        for (const key of Object.keys(l.params)) {
          expect(
            spec!.params.some((p) => p.key === key),
            `${preset.id}/${l.effectId}: bogus param ${key}`,
          ).toBe(true);
        }
        for (const key of Object.keys(l.bindings ?? {})) {
          const p = spec!.params.find((q) => q.key === key);
          expect(p?.type, `${preset.id}/${l.effectId}: binding on ${key}`).toBe("number");
        }
      }
      // Round-trip through the sanitizer must not drop anything.
      expect(sanitizeScene(scene).layers).toHaveLength(scene.layers.length);
    }
  });

  it("registry finale pack landed (52 layer types)", () => {
    expect(FX_EFFECTS.length).toBe(52);
    for (const id of ["lightning", "sunGrid", "tunnel", "voronoi", "fire", "bokeh", "rainGlass", "interference", "crt", "sharpen"]) {
      expect(fxEffect(id), id).toBeDefined();
    }
  });
});

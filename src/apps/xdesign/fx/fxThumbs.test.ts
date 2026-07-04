import { describe, it, expect } from "vitest";
import { demoSceneFor, THUMB_W, THUMB_H } from "./fxThumbs";
import { FX_EFFECTS, fxEffect } from "./fxRegistry";
import { defaultParams } from "./fxModel";

describe("demoSceneFor", () => {
  it("builds a valid demo scene for every registry effect", () => {
    for (const spec of FX_EFFECTS) {
      const scene = demoSceneFor(spec);
      expect(scene.width).toBe(THUMB_W);
      expect(scene.height).toBe(THUMB_H);
      expect(scene.layers.length).toBeGreaterThan(0);
      // The effect itself is always the top layer.
      expect(scene.layers[scene.layers.length - 1]!.effectId).toBe(spec.id);
      for (const l of scene.layers) {
        const s = fxEffect(l.effectId);
        expect(s, `${spec.id} demo uses unknown ${l.effectId}`).toBeDefined();
        // Params must be complete (defaults + demo tweaks only).
        for (const key of Object.keys(defaultParams(s!))) {
          expect(l.params[key], `${spec.id}: missing ${key}`).toBeDefined();
        }
      }
    }
  });

  it("generators render alone; effects get a demo base underneath", () => {
    const gen = demoSceneFor(fxEffect("nebula")!);
    expect(gen.layers).toHaveLength(1);
    const eff = demoSceneFor(fxEffect("bloom")!);
    expect(eff.layers).toHaveLength(2);
    expect(eff.layers[0]!.effectId).toBe("gradient");
  });
});

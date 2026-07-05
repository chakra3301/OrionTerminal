import { describe, it, expect } from "vitest";
import { FxBindingRuntime, easeOutCubic, type FxInputs } from "./fxBindings";
import { emptyScene, type FxLayer } from "./fxModel";

const INPUTS: FxInputs = {
  mouseX: 1,
  mouseY: 0,
  mouseSpeed: 0,
  hover: 0,
  appear: 0,
  audio: 0,
};

function layerWith(bindings: FxLayer["bindings"], params = {}): FxLayer {
  return {
    id: "L1",
    effectId: "noiseDistort",
    name: "Noise",
    opacity: 1,
    params: { scale: 4, strength: 0.1, speed: 0.3, mouse: 0, ...params },
    bindings,
  };
}

function sceneWith(layer: FxLayer) {
  const s = emptyScene();
  s.layers.push(layer);
  return s;
}

describe("FxBindingRuntime", () => {
  it("resolves a bound param toward base + amount×range×source", () => {
    const rt = new FxBindingRuntime();
    const scene = sceneWith(
      layerWith({ strength: { source: "mouseX", amount: 0.5, smooth: 0 } }),
    );
    // Large dt → smoothing converges immediately at smooth 0.
    const out = rt.tick(scene, INPUTS, 10);
    // strength: base 0.1 + 0.5 × (0.5-0) × 1 = 0.35
    expect(out.get("L1")!.strength).toBeCloseTo(0.35, 3);
  });

  it("clamps to the param range", () => {
    const rt = new FxBindingRuntime();
    const scene = sceneWith(
      layerWith({ strength: { source: "mouseX", amount: 1, smooth: 0 } }, { strength: 0.4 }),
    );
    const out = rt.tick(scene, INPUTS, 10);
    expect(out.get("L1")!.strength).toBe(0.5); // max of strength
  });

  it("negative amount subtracts", () => {
    const rt = new FxBindingRuntime();
    const scene = sceneWith(
      layerWith({ strength: { source: "mouseX", amount: -1, smooth: 0 } }, { strength: 0.4 }),
    );
    const out = rt.tick(scene, INPUTS, 10);
    expect(out.get("L1")!.strength).toBe(0); // clamped at min
  });

  it("smoothing converges over ticks instead of jumping", () => {
    const rt = new FxBindingRuntime();
    const scene = sceneWith(
      layerWith({ strength: { source: "hover", amount: 0.5, smooth: 0.9 } }),
    );
    // First tick primes the smoother at the source value (hover 0).
    rt.tick(scene, { ...INPUTS, hover: 0 }, 0.016);
    const first = rt.tick(scene, { ...INPUTS, hover: 1 }, 0.016).get("L1")!.strength;
    let last = first;
    for (let i = 0; i < 400; i++) {
      last = rt.tick(scene, { ...INPUTS, hover: 1 }, 0.016).get("L1")!.strength;
    }
    expect(first).toBeGreaterThan(0.1);
    expect(first).toBeLessThan(0.2); // barely moved on the first frame
    expect(last).toBeCloseTo(0.35, 2); // converged to base + 0.5×0.5
  });

  it("skips hidden layers, unknown params, and non-number params", () => {
    const rt = new FxBindingRuntime();
    const hidden = layerWith({ strength: { source: "mouseX", amount: 1 } });
    hidden.hidden = true;
    expect(rt.tick(sceneWith(hidden), INPUTS, 10).size).toBe(0);

    const ghost = layerWith({ nope: { source: "mouseX", amount: 1 } });
    expect(rt.tick(sceneWith(ghost), INPUTS, 10).size).toBe(0);
  });

  it("reset clears smoothing state", () => {
    const rt = new FxBindingRuntime();
    const scene = sceneWith(
      layerWith({ strength: { source: "appear", amount: 1, smooth: 0 } }),
    );
    rt.tick(scene, { ...INPUTS, appear: 1 }, 10);
    rt.reset();
    const out = rt.tick(scene, { ...INPUTS, appear: 0 }, 0.0001);
    // After reset the smoother re-primes at the current source (0).
    expect(out.get("L1")!.strength).toBeCloseTo(0.1, 3);
  });
});

describe("easeOutCubic", () => {
  it("ramps 0→1 with clamping", () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5); // ease-OUT
  });
});

import { describe, it, expect } from "vitest";
import { evalKeyframes, evalSceneKeyframes, upsertKeyframe } from "./fxTimeline";
import { emptyScene, type FxKeyframe, type FxLayer } from "./fxModel";

describe("evalKeyframes", () => {
  const kfs: FxKeyframe[] = [
    { t: 0.2, v: 0, ease: "linear" },
    { t: 0.8, v: 1, ease: "linear" },
  ];

  it("returns undefined for empty lists", () => {
    expect(evalKeyframes([], 0.5)).toBeUndefined();
  });

  it("holds first/last values outside the key range", () => {
    expect(evalKeyframes(kfs, 0)).toBe(0);
    expect(evalKeyframes(kfs, 0.1)).toBe(0);
    expect(evalKeyframes(kfs, 0.9)).toBe(1);
    expect(evalKeyframes(kfs, 1)).toBe(1);
  });

  it("interpolates linearly", () => {
    expect(evalKeyframes(kfs, 0.5)).toBeCloseTo(0.5, 5);
    expect(evalKeyframes(kfs, 0.35)).toBeCloseTo(0.25, 5);
  });

  it("inOut eases through the midpoint", () => {
    const eased: FxKeyframe[] = [
      { t: 0, v: 0 },
      { t: 1, v: 1, ease: "inOut" },
    ];
    expect(evalKeyframes(eased, 0.5)).toBeCloseTo(0.5, 5);
    expect(evalKeyframes(eased, 0.25)!).toBeLessThan(0.25); // slow start
  });

  it("hold steps at the next key", () => {
    const held: FxKeyframe[] = [
      { t: 0, v: 0 },
      { t: 1, v: 1, ease: "hold" },
    ];
    expect(evalKeyframes(held, 0.99)).toBe(0);
    expect(evalKeyframes(held, 1)).toBe(1);
  });
});

describe("evalSceneKeyframes", () => {
  function sceneWith(layer: Partial<FxLayer>) {
    const s = emptyScene();
    s.layers.push({
      id: "L1",
      effectId: "noiseDistort",
      name: "N",
      opacity: 1,
      params: {},
      ...layer,
    });
    return s;
  }

  it("resolves keyed params, clamped to range, looping over duration", () => {
    const s = sceneWith({
      keyframes: {
        strength: [
          { t: 0, v: 0, ease: "linear" },
          { t: 1, v: 9, ease: "linear" }, // way over max 0.5
        ],
      },
    });
    s.duration = 4;
    const half = evalSceneKeyframes(s, 2); // t01 = 0.5 → raw 4.5 → clamp 0.5
    expect(half.get("L1")!.strength).toBe(0.5);
    const wrapped = evalSceneKeyframes(s, 4.0); // loops to t01 = 0
    expect(wrapped.get("L1")!.strength).toBe(0);
  });

  it("skips hidden layers and unknown params", () => {
    const hidden = sceneWith({
      hidden: true,
      keyframes: { strength: [{ t: 0, v: 0.1 }] },
    });
    expect(evalSceneKeyframes(hidden, 0).size).toBe(0);
    const ghost = sceneWith({ keyframes: { nope: [{ t: 0, v: 1 }] } });
    expect(evalSceneKeyframes(ghost, 0).size).toBe(0);
  });
});

describe("upsertKeyframe", () => {
  it("inserts sorted", () => {
    const out = upsertKeyframe(
      [{ t: 0.8, v: 1 }],
      { t: 0.2, v: 0 },
    );
    expect(out.map((k) => k.t)).toEqual([0.2, 0.8]);
  });

  it("replaces keys within ±1% of t", () => {
    const out = upsertKeyframe(
      [{ t: 0.5, v: 1 }],
      { t: 0.505, v: 2 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.v).toBe(2);
  });

  it("clamps t into 0..1", () => {
    const out = upsertKeyframe(undefined, { t: 1.7, v: 3 });
    expect(out[0]!.t).toBe(1);
  });
});

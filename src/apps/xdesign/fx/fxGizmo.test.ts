import { describe, it, expect, beforeEach } from "vitest";
import { unitBox, containBox } from "./fxGizmo";
import { setSourceAspect, dropSourceAspect } from "./fxSourceInfo";
import type { FxLayer } from "./fxModel";

function layer(effectId: string, params: FxLayer["params"]): FxLayer {
  return { id: "L1", effectId, name: "x", opacity: 1, params };
}

beforeEach(() => dropSourceAspect("L1"));

describe("containBox", () => {
  it("wide image in a square scene is width-limited", () => {
    // aspect 2 (wide), scene aspect 1 → R=2 → w=scale, h=scale/2
    expect(containBox(2, 1, 1)).toEqual({ w: 1, h: 0.5 });
  });
  it("tall image in a square scene is height-limited", () => {
    expect(containBox(0.5, 1, 1)).toEqual({ w: 0.5, h: 1 });
  });
  it("scale multiplies both extents", () => {
    expect(containBox(1, 1, 0.5)).toEqual({ w: 0.5, h: 0.5 });
  });
});

describe("unitBox", () => {
  it("shape uses explicit width/height", () => {
    const b = unitBox(layer("srcShape", { x: 0.3, y: 0.7, width: 0.4, height: 0.2, rotation: 15 }), 1000, 1000);
    expect(b).toEqual({ x: 0.3, y: 0.7, w: 0.4, h: 0.2, rot: 15 });
  });

  it("image is square until its aspect is known, then contain-fit", () => {
    const l = layer("srcImage", { x: 0.5, y: 0.5, scale: 1 });
    // Unknown aspect → square fallback at scale.
    expect(unitBox(l, 1600, 900)).toMatchObject({ w: 1, h: 1 });
    // 16:9 image in a 16:9 scene → fills (R=1).
    setSourceAspect("L1", 16 / 9);
    const b = unitBox(l, 1600, 900)!;
    expect(b.w).toBeCloseTo(1, 5);
    expect(b.h).toBeCloseTo(1, 5);
    // A square image in a 16:9 scene is height-limited.
    setSourceAspect("L1", 1);
    const sq = unitBox(l, 1600, 900)!;
    expect(sq.h).toBeCloseTo(1, 5);
    expect(sq.w).toBeCloseTo(9 / 16, 5);
  });

  it("video uses the same contain-fit path as image", () => {
    setSourceAspect("L1", 2);
    const b = unitBox(layer("srcVideo", { x: 0.5, y: 0.5, scale: 0.5 }), 1000, 1000)!;
    expect(b.w).toBeCloseTo(0.5, 5); // R=2 → w=scale
    expect(b.h).toBeCloseTo(0.25, 5);
  });

  it("text returns a positive measured-ish box and passes rotation through", () => {
    const b = unitBox(layer("srcText", { x: 0.5, y: 0.5, content: "Hi", size: 0.2, rotation: -30 }), 1000, 1000)!;
    expect(b.w).toBeGreaterThan(0);
    expect(b.h).toBeGreaterThan(0);
    expect(b.rot).toBe(-30);
  });

  it("returns null for non-source layers", () => {
    expect(unitBox(layer("nebula", {}), 1000, 1000)).toBeNull();
  });
});

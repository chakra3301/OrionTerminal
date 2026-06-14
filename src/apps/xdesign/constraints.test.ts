import { describe, expect, it } from "vitest";
import { applyConstraints, type ConstrainedChild } from "./constraints";

type Box = { x: number; y: number; w: number; h: number };

const child = (over: Partial<ConstrainedChild>): ConstrainedChild => ({
  x: 20,
  y: 20,
  w: 40,
  h: 30,
  ...over,
});

// A 100×100 frame at the origin is the baseline old frame for most cases.
const oldFrame: Box = { x: 0, y: 0, w: 100, h: 100 };

describe("applyConstraints — horizontal axis", () => {
  it("default (unset) pins the left edge — width-only resize leaves x and w untouched", () => {
    const newFrame: Box = { x: 0, y: 0, w: 200, h: 100 };
    const r = applyConstraints(child({ x: 20, w: 40 }), oldFrame, newFrame);
    expect(r.x).toBe(20);
    expect(r.w).toBe(40);
  });

  it("left explicitly pins the left edge", () => {
    const newFrame: Box = { x: 0, y: 0, w: 200, h: 100 };
    const r = applyConstraints(
      child({ x: 20, w: 40, constraintH: "left" }),
      oldFrame,
      newFrame,
    );
    expect(r.x).toBe(20);
    expect(r.w).toBe(40);
  });

  it("right pins the right gap — child slides with the right edge, width unchanged", () => {
    // old right gap = 100 - (20 + 40) = 40. New frame right = 200 → x = 160 - 40 = 120.
    const newFrame: Box = { x: 0, y: 0, w: 200, h: 100 };
    const r = applyConstraints(
      child({ x: 20, w: 40, constraintH: "right" }),
      oldFrame,
      newFrame,
    );
    expect(r.x).toBe(120);
    expect(r.w).toBe(40);
  });

  it("left-right stretches width to keep both gaps", () => {
    // left gap = 20, right gap = 40. New w = 200 - 20 - 40 = 140, x stays 20.
    const newFrame: Box = { x: 0, y: 0, w: 200, h: 100 };
    const r = applyConstraints(
      child({ x: 20, w: 40, constraintH: "left-right" }),
      oldFrame,
      newFrame,
    );
    expect(r.x).toBe(20);
    expect(r.w).toBe(140);
  });

  it("center keeps the center ratio, width unchanged", () => {
    // child center = 40, ratio = 40/100 = 0.4 → new center = 0.4*200 = 80 → x = 60.
    const newFrame: Box = { x: 0, y: 0, w: 200, h: 100 };
    const r = applyConstraints(
      child({ x: 20, w: 40, constraintH: "center" }),
      oldFrame,
      newFrame,
    );
    expect(r.x).toBe(60);
    expect(r.w).toBe(40);
  });

  it("scale scales both offset and size by the width ratio", () => {
    // ratio = 200/100 = 2 → x = 0 + 20*2 = 40, w = 40*2 = 80.
    const newFrame: Box = { x: 0, y: 0, w: 200, h: 100 };
    const r = applyConstraints(
      child({ x: 20, w: 40, constraintH: "scale" }),
      oldFrame,
      newFrame,
    );
    expect(r.x).toBe(40);
    expect(r.w).toBe(80);
  });

  it("right follows a moving frame-left as well (frame origin shift)", () => {
    // Frame moved to x=10 AND widened to 200. right gap 40 preserved.
    // new right = 10 + 200 = 210 → x = 210 - 40 - 40 = 130.
    const newFrame: Box = { x: 10, y: 0, w: 200, h: 100 };
    const r = applyConstraints(
      child({ x: 20, w: 40, constraintH: "right" }),
      oldFrame,
      newFrame,
    );
    expect(r.x).toBe(130);
    expect(r.w).toBe(40);
  });

  it("left keeps the gap when the frame's left edge moves", () => {
    // Frame left moved 0→10 (resize from the left handle). left gap = 20 preserved.
    const newFrame: Box = { x: 10, y: 0, w: 90, h: 100 };
    const r = applyConstraints(
      child({ x: 20, w: 40, constraintH: "left" }),
      oldFrame,
      newFrame,
    );
    expect(r.x).toBe(30);
    expect(r.w).toBe(40);
  });
});

describe("applyConstraints — vertical axis", () => {
  it("default pins the top edge", () => {
    const newFrame: Box = { x: 0, y: 0, w: 100, h: 200 };
    const r = applyConstraints(child({ y: 20, h: 30 }), oldFrame, newFrame);
    expect(r.y).toBe(20);
    expect(r.h).toBe(30);
  });

  it("bottom pins the bottom gap", () => {
    // bottom gap = 100 - (20 + 30) = 50. new bottom = 200 → y = 200 - 50 - 30 = 120.
    const newFrame: Box = { x: 0, y: 0, w: 100, h: 200 };
    const r = applyConstraints(
      child({ y: 20, h: 30, constraintV: "bottom" }),
      oldFrame,
      newFrame,
    );
    expect(r.y).toBe(120);
    expect(r.h).toBe(30);
  });

  it("top-bottom stretches height", () => {
    // top gap 20, bottom gap 50 → h = 200 - 20 - 50 = 130.
    const newFrame: Box = { x: 0, y: 0, w: 100, h: 200 };
    const r = applyConstraints(
      child({ y: 20, h: 30, constraintV: "top-bottom" }),
      oldFrame,
      newFrame,
    );
    expect(r.y).toBe(20);
    expect(r.h).toBe(130);
  });

  it("center (V) keeps the vertical center ratio", () => {
    // center = 35, ratio = 0.35 → new center = 70 → y = 70 - 15 = 55.
    const newFrame: Box = { x: 0, y: 0, w: 100, h: 200 };
    const r = applyConstraints(
      child({ y: 20, h: 30, constraintV: "center" }),
      oldFrame,
      newFrame,
    );
    expect(r.y).toBe(55);
    expect(r.h).toBe(30);
  });

  it("scale (V) scales offset and height by the height ratio", () => {
    // ratio = 200/100 = 2 → y = 40, h = 60.
    const newFrame: Box = { x: 0, y: 0, w: 100, h: 200 };
    const r = applyConstraints(
      child({ y: 20, h: 30, constraintV: "scale" }),
      oldFrame,
      newFrame,
    );
    expect(r.y).toBe(40);
    expect(r.h).toBe(60);
  });
});

describe("applyConstraints — both axes at once", () => {
  it("applies H and V independently under a both-axis resize", () => {
    // right + bottom, frame 100→200 (w) and 100→150 (h).
    // H right: gap 40 → x = 200 - 40 - 40 = 120.
    // V bottom: gap 50 → y = 150 - 50 - 30 = 70.
    const newFrame: Box = { x: 0, y: 0, w: 200, h: 150 };
    const r = applyConstraints(
      child({ x: 20, y: 20, w: 40, h: 30, constraintH: "right", constraintV: "bottom" }),
      oldFrame,
      newFrame,
    );
    expect(r).toEqual({ x: 120, y: 70, w: 40, h: 30 });
  });

  it("scale on both axes uses each axis's own ratio", () => {
    const newFrame: Box = { x: 0, y: 0, w: 300, h: 200 };
    const r = applyConstraints(
      child({ x: 20, y: 20, w: 40, h: 30, constraintH: "scale", constraintV: "scale" }),
      oldFrame,
      newFrame,
    );
    // H ratio 3 → x 60, w 120. V ratio 2 → y 40, h 60.
    expect(r).toEqual({ x: 60, y: 40, w: 120, h: 60 });
  });

  it("is a no-op when the frame doesn't change", () => {
    const r = applyConstraints(
      child({ x: 20, y: 20, w: 40, h: 30, constraintH: "center", constraintV: "scale" }),
      oldFrame,
      oldFrame,
    );
    expect(r).toEqual({ x: 20, y: 20, w: 40, h: 30 });
  });
});

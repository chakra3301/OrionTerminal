import { describe, expect, it } from "vitest";
import {
  topLevelFrames,
  topLevelFrameAncestor,
  hotspotsForScreen,
  initialScreen,
  computeFit,
  type ProtoLink,
} from "./prototype";
import type { Shape } from "./store";

const frame = (o: Partial<Shape> & { id: string }): Shape =>
  ({
    name: o.id,
    kind: "frame",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    radius: 0,
    fill: "#111",
    stroke: "#000",
    strokeWidth: 1,
    ...o,
  }) as Shape;
const rect = (o: Partial<Shape> & { id: string }): Shape =>
  ({
    name: o.id,
    kind: "rect",
    x: 0,
    y: 0,
    w: 20,
    h: 20,
    radius: 0,
    fill: "#fff",
    stroke: "#000",
    strokeWidth: 0,
    ...o,
  }) as Shape;

const link = (target: string): ProtoLink => ({
  trigger: "click",
  action: "navigate",
  target,
});

function doc(): Shape[] {
  return [
    frame({ id: "A", x: 0, y: 0, w: 200, h: 300 }),
    rect({ id: "btn", x: 10, y: 10, parentId: "A", prototype: link("B") } as Partial<Shape> & { id: string }),
    rect({ id: "label", x: 50, y: 50, parentId: "A" }), // no prototype
    frame({ id: "B", x: 400, y: 0, w: 200, h: 300 }),
    rect({ id: "back", x: 10, y: 10, parentId: "B", prototype: { trigger: "click", action: "back" } } as Partial<Shape> & { id: string }),
    rect({ id: "loose", x: 800, y: 0 }), // top-level non-frame
  ];
}

describe("topLevelFrames", () => {
  it("returns only parentless frames, in document order", () => {
    expect(topLevelFrames(doc()).map((f) => f.id)).toEqual(["A", "B"]);
  });
});

describe("topLevelFrameAncestor", () => {
  it("walks up to the screen a shape lives on", () => {
    expect(topLevelFrameAncestor(doc(), "btn")?.id).toBe("A");
  });
  it("returns the frame itself for a top-level frame", () => {
    expect(topLevelFrameAncestor(doc(), "A")?.id).toBe("A");
  });
  it("returns null for a top-level non-frame", () => {
    expect(topLevelFrameAncestor(doc(), "loose")).toBeNull();
  });
});

describe("hotspotsForScreen", () => {
  it("returns prototyped shapes whose screen is the given frame", () => {
    expect(hotspotsForScreen(doc(), "A").map((s) => s.id)).toEqual(["btn"]);
    expect(hotspotsForScreen(doc(), "B").map((s) => s.id)).toEqual(["back"]);
  });
});

describe("initialScreen", () => {
  it("is the first top-level frame", () => {
    expect(initialScreen(doc())).toBe("A");
  });
  it("is null with no frames", () => {
    expect(initialScreen([rect({ id: "x" })])).toBeNull();
  });
});

describe("computeFit (contain)", () => {
  it("scales to the limiting axis and centers the letterbox", () => {
    // 100x100 into 400x200 → scale 2, content 200x200, offsetX 100, offsetY 0.
    expect(computeFit(100, 100, 400, 200)).toEqual({
      scale: 2,
      offsetX: 100,
      offsetY: 0,
    });
  });
  it("limits on height when the frame is tall", () => {
    // 100x200 into 400x200 → scale 1, content 100x200, offsetX 150, offsetY 0.
    expect(computeFit(100, 200, 400, 200)).toEqual({
      scale: 1,
      offsetX: 150,
      offsetY: 0,
    });
  });
});

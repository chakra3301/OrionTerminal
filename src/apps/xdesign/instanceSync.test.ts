import { describe, expect, it } from "vitest";
import { recloneInstance, type Shape } from "./store";
import { captureOverride } from "./overrides";

// main "m" + child "mc"; instance "i" + child "ic" placed 200px right.
function fixture(): Shape[] {
  const text = (o: Partial<Shape> & { id: string }): Shape =>
    ({
      name: o.id,
      kind: "text",
      x: 0,
      y: 0,
      w: 40,
      h: 20,
      fill: "#fff",
      stroke: "#000",
      strokeWidth: 0,
      text: "Hi",
      fontSize: 12,
      ...o,
    }) as Shape;
  const frame = (o: Partial<Shape> & { id: string }): Shape =>
    ({
      name: o.id,
      kind: "frame",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      radius: 0,
      fill: "transparent",
      stroke: "#000",
      strokeWidth: 1,
      ...o,
    }) as Shape;
  return [
    frame({ id: "m", x: 0, y: 0, isMain: true, parentId: null }),
    text({ id: "mc", x: 10, y: 10, fill: "#fff", text: "Hi", parentId: "m" }),
    frame({
      id: "i",
      x: 200,
      y: 0,
      parentId: null,
      linkedMainId: "m",
      linkedNodeId: "m",
    } as Partial<Shape> & { id: string }),
    text({
      id: "ic",
      x: 210,
      y: 10,
      fill: "#fff",
      text: "Hi",
      parentId: "i",
      linkedMainId: "m",
      linkedNodeId: "mc",
    } as Partial<Shape> & { id: string }),
  ];
}

/** Simulate the store's updateShape capture step: apply a user edit to a node
 * and fold the resulting override onto the instance root. */
function edit(shapes: Shape[], targetId: string, patch: Record<string, unknown>): Shape[] {
  const cap = captureOverride(shapes, targetId, patch);
  const withPatch = shapes.map((s) =>
    s.id === targetId ? ({ ...s, ...patch } as Shape) : s,
  );
  if (!cap) return withPatch;
  return withPatch.map((s) =>
    s.id === cap.rootId ? ({ ...s, overrides: cap.overrides } as Shape) : s,
  );
}

const instChild = (shapes: Shape[]) => {
  const s = shapes.find((x) => x.linkedNodeId === "mc" && x.linkedMainId === "m")!;
  if (s.kind !== "text") throw new Error("expected the instance child to be text");
  return s;
};

describe("recloneInstance — non-lossy overrides", () => {
  it("preserves an instance-child edit across a sync when main is unchanged", () => {
    const shapes = edit(fixture(), "ic", { fill: "#f00" });
    const out = recloneInstance(shapes, "i");
    expect(instChild(out).fill).toBe("#f00");
    // the main child is untouched
    expect(out.find((s) => s.id === "mc")!.fill).toBe("#fff");
  });

  it("lets main win for non-overridden props while the override still wins", () => {
    let shapes = edit(fixture(), "ic", { fill: "#f00" });
    // now main's text changes
    shapes = shapes.map((s) =>
      s.id === "mc" ? ({ ...s, text: "Updated" } as Shape) : s,
    );
    const out = recloneInstance(shapes, "i");
    const child = instChild(out);
    expect(child.text).toBe("Updated"); // main wins (not overridden)
    expect(child.fill).toBe("#f00"); // override wins
  });

  it("re-anchors a position override to the (moved) instance root", () => {
    let shapes = edit(fixture(), "ic", { x: 230 }); // offset 30 from root@200
    // user drags the whole instance root to x=500
    shapes = shapes.map((s) => (s.id === "i" ? ({ ...s, x: 500 } as Shape) : s));
    const out = recloneInstance(shapes, "i");
    expect(instChild(out).x).toBe(530); // 500 + 30
  });

  it("keeps the override map on the root for the next sync", () => {
    const shapes = edit(fixture(), "ic", { fill: "#f00" });
    const out = recloneInstance(shapes, "i");
    const root = out.find((s) => s.id === "i")!;
    expect(root.overrides).toEqual({ mc: { fill: "#f00" } });
    // a second sync still preserves it
    const out2 = recloneInstance(out, "i");
    expect(instChild(out2).fill).toBe("#f00");
  });
});

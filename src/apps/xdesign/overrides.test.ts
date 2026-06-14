import { describe, expect, it } from "vitest";
import { findInstanceRoot, captureOverride, applyOverrides } from "./overrides";
import type { Shape } from "./store";

// A main frame "m" with one text child "mc", and an instance "i"/"ic" of it
// placed 200px to the right.
function fixture(over?: { rootOverrides?: Record<string, Record<string, unknown>> }): Shape[] {
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
    text({ id: "mc", x: 10, y: 10, fill: "#fff", parentId: "m" }),
    frame({
      id: "i",
      x: 200,
      y: 0,
      parentId: null,
      linkedMainId: "m",
      linkedNodeId: "m",
      ...(over?.rootOverrides ? { overrides: over.rootOverrides } : {}),
    } as Partial<Shape> & { id: string }),
    text({
      id: "ic",
      x: 210,
      y: 10,
      fill: "#fff",
      parentId: "i",
      linkedMainId: "m",
      linkedNodeId: "mc",
    } as Partial<Shape> & { id: string }),
  ];
}

describe("findInstanceRoot", () => {
  it("returns the root from a descendant", () => {
    expect(findInstanceRoot(fixture(), "ic")?.id).toBe("i");
  });
  it("returns the root from itself", () => {
    expect(findInstanceRoot(fixture(), "i")?.id).toBe("i");
  });
  it("returns null for a non-instance shape", () => {
    expect(findInstanceRoot(fixture(), "m")).toBeNull();
  });
});

describe("captureOverride", () => {
  it("records a visual prop that differs from the main node", () => {
    const r = captureOverride(fixture(), "ic", { fill: "#f00" });
    expect(r).toEqual({ rootId: "i", overrides: { mc: { fill: "#f00" } } });
  });

  it("clears an entry when the value is reset to match the main node", () => {
    const r = captureOverride(
      fixture({ rootOverrides: { mc: { fill: "#f00" } } }),
      "ic",
      { fill: "#fff" }, // back to main's value
    );
    expect(r).toEqual({ rootId: "i", overrides: {} });
  });

  it("merges into an existing entry without dropping prior props", () => {
    const r = captureOverride(
      fixture({ rootOverrides: { mc: { opacity: 0.5 } } }),
      "ic",
      { fill: "#f00" },
    );
    expect(r).toEqual({ rootId: "i", overrides: { mc: { opacity: 0.5, fill: "#f00" } } });
  });

  it("stores a descendant position as an offset from the instance root", () => {
    // ic moved to x=230; root i is at 200 → stored offset 30.
    const r = captureOverride(fixture(), "ic", { x: 230 });
    expect(r).toEqual({ rootId: "i", overrides: { mc: { x: 30 } } });
  });

  it("does not capture x/y on the instance root itself", () => {
    expect(captureOverride(fixture(), "i", { x: 300 })).toBeNull();
  });

  it("captures a visual prop on the instance root (keyed by the main root id)", () => {
    const r = captureOverride(fixture(), "i", { fill: "#0f0" });
    expect(r).toEqual({ rootId: "i", overrides: { m: { fill: "#0f0" } } });
  });

  it("ignores structural / non-overridable props", () => {
    expect(captureOverride(fixture(), "ic", { parentId: "x" } as never)).toBeNull();
  });

  it("returns null for a shape with no main link", () => {
    expect(captureOverride(fixture(), "m", { fill: "#f00" })).toBeNull();
  });
});

describe("applyOverrides", () => {
  it("applies a visual override onto a freshly-cloned node", () => {
    const fresh = { id: "new", x: 210, y: 10, fill: "#fff" };
    const out = applyOverrides(fresh, "mc", { x: 200, y: 0 }, { mc: { fill: "#f00" } });
    expect(out.fill).toBe("#f00");
  });

  it("re-anchors a position override to the instance root", () => {
    const fresh = { id: "new", x: 999, y: 999 };
    // root moved to (500, 40); stored offset 30 → x = 530.
    const out = applyOverrides(fresh, "mc", { x: 500, y: 40 }, { mc: { x: 30, y: 5 } });
    expect(out.x).toBe(530);
    expect(out.y).toBe(45);
  });

  it("returns the node unchanged when no override exists for it", () => {
    const fresh = { id: "new", x: 1, y: 2, fill: "#fff" };
    const out = applyOverrides(fresh, "mc", { x: 0, y: 0 }, undefined);
    expect(out).toEqual(fresh);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { useXDesign, type Shape } from "./store";

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

// A variant set "set" with members "ma" (State=default) / "mb" (State=hover),
// each holding a text child, plus an instance "i" currently mirroring "ma".
function seed() {
  const shapes: Shape[] = [
    frame({ id: "set", x: 0, y: 0, isVariantSet: true, parentId: null }),
    frame({ id: "ma", x: 0, y: 0, isMain: true, parentId: "set", variantProps: { State: "default" } } as Partial<Shape> & { id: string }),
    text({ id: "mac", x: 10, y: 10, text: "DEFAULT", parentId: "ma" }),
    frame({ id: "mb", x: 0, y: 200, isMain: true, parentId: "set", variantProps: { State: "hover" } } as Partial<Shape> & { id: string }),
    text({ id: "mbc", x: 10, y: 210, text: "HOVER", parentId: "mb" }),
    frame({
      id: "i",
      x: 400,
      y: 0,
      parentId: null,
      linkedMainId: "ma",
      linkedNodeId: "ma",
      variantSelection: { State: "default" },
    } as Partial<Shape> & { id: string }),
    text({
      id: "ic",
      x: 410,
      y: 10,
      text: "DEFAULT",
      parentId: "i",
      linkedMainId: "ma",
      linkedNodeId: "mac",
    } as Partial<Shape> & { id: string }),
  ];
  useXDesign.setState({ shapes, selection: new Set(), past: [], future: [] });
}

const instChildText = (): string => {
  const s = useXDesign
    .getState()
    .shapes.find((x) => x.linkedMainId && x.linkedNodeId && x.kind === "text");
  return s && s.kind === "text" ? s.text : "";
};
const root = (): Shape =>
  useXDesign.getState().shapes.find((s) => s.id === "i")!;

describe("setVariantSelection", () => {
  beforeEach(seed);

  it("swaps the instance to the member matching the selection", () => {
    useXDesign.getState().setVariantSelection("i", { State: "hover" });
    expect(root().linkedMainId).toBe("mb");
    expect(root().variantSelection).toEqual({ State: "hover" });
    expect(instChildText()).toBe("HOVER");
  });

  it("never leaks the member main's variantProps onto the instance root", () => {
    useXDesign.getState().setVariantSelection("i", { State: "hover" });
    expect(root().variantProps).toBeUndefined();
    expect(root().isVariantSet).toBeUndefined();
    expect(root().isMain).toBe(false);
  });

  it("keeps the instance root id + position stable through the swap", () => {
    useXDesign.getState().setVariantSelection("i", { State: "hover" });
    expect(root().x).toBe(400);
    expect(root().y).toBe(0);
  });

  it("falls back to the nearest member for an unknown combination", () => {
    useXDesign.getState().setVariantSelection("i", { State: "gone" });
    // no exact match → first member "ma".
    expect(root().linkedMainId).toBe("ma");
  });

  it("is a no-op for an instance that isn't part of a variant set", () => {
    // point the set frame's flag off so "ma" is just a plain main.
    useXDesign.setState({
      shapes: useXDesign
        .getState()
        .shapes.map((s) => (s.id === "set" ? ({ ...s, isVariantSet: false } as Shape) : s)),
    });
    useXDesign.getState().setVariantSelection("i", { State: "hover" });
    expect(root().linkedMainId).toBe("ma"); // unchanged
  });
});

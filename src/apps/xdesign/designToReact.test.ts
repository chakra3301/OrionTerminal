import { describe, expect, it } from "vitest";
import { pascalCase, colorToCss, generateComponent } from "./designToReact";
import type { Shape, Variable } from "./store";

const base = (over: Partial<Shape> & { id: string; kind: Shape["kind"] }): Shape =>
  ({
    name: over.id,
    x: 0, y: 0, w: 100, h: 100,
    fill: "#000000", stroke: "#000000", strokeWidth: 0,
    ...over,
  }) as Shape;

describe("pascalCase", () => {
  it("converts a frame name", () => {
    expect(pascalCase("primary button")).toBe("PrimaryButton");
    expect(pascalCase("Card / Header")).toBe("CardHeader");
  });
  it("prefixes names starting with a digit", () => {
    expect(pascalCase("2col layout")).toBe("Component2colLayout");
  });
});

describe("colorToCss", () => {
  const vars: Variable[] = [{ id: "v1", name: "Brand Primary", type: "color", values: {} }];
  it("maps a known Orion token hex to var()", () => {
    expect(colorToCss("#00e0ff", [])).toBe("var(--neon-cyan)");
  });
  it("maps an XDesign variable ref to a kebab var()", () => {
    expect(colorToCss("var:v1", vars)).toBe("var(--brand-primary)");
  });
  it("passes a literal color through", () => {
    expect(colorToCss("#123456", [])).toBe("#123456");
  });
});

describe("generateComponent", () => {
  it("emits a component with a flex auto-layout frame + children", () => {
    const shapes: Shape[] = [
      base({
        id: "frame", kind: "frame", name: "Card", w: 200, h: 80, fill: "#0a1015",
        layoutMode: "horizontal", itemSpacing: 8, paddingTop: 10, paddingRight: 10, paddingBottom: 10, paddingLeft: 10,
        primaryAxisAlign: "center", counterAxisAlign: "center", radius: 12,
      } as Partial<Shape> as Shape & { id: string; kind: "frame" }),
      base({ id: "label", kind: "text", parentId: "frame", text: "Hi", fill: "#e6f4ec", fontSize: 14 } as Partial<Shape> as Shape & { id: string; kind: "text" }),
    ];
    const out = generateComponent("frame", shapes, []);
    expect(out).not.toBeNull();
    expect(out!.componentName).toBe("Card");
    expect(out!.code).toContain("export function Card()");
    expect(out!.code).toContain('display: "flex"');
    expect(out!.code).toContain('flexDirection: "row"');
    expect(out!.code).toContain("gap: 8");
    expect(out!.code).toContain('background: "var(--bg-2)"'); // token mapping
    expect(out!.code).toContain("Hi");
    expect(out!.code).toContain('color: "var(--t-primary)"');
  });

  it("absolutely positions children of a freeform frame relative to it", () => {
    const shapes: Shape[] = [
      base({ id: "f", kind: "frame", name: "Free", x: 50, y: 50, w: 300, h: 300, radius: 0 } as Partial<Shape> as Shape & { id: string; kind: "frame" }),
      base({ id: "box", kind: "rect", parentId: "f", x: 70, y: 90, w: 40, h: 40, radius: 0 } as Partial<Shape> as Shape & { id: string; kind: "rect" }),
    ];
    const out = generateComponent("f", shapes, []);
    expect(out!.code).toContain('position: "absolute"');
    expect(out!.code).toContain("left: 20"); // 70 - 50
    expect(out!.code).toContain("top: 40"); // 90 - 50
  });

  it("returns null for an unknown root", () => {
    expect(generateComponent("nope", [], [])).toBeNull();
  });
});

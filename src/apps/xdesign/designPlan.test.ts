import { describe, expect, it } from "vitest";
import {
  parseDesignPlan,
  planToShapes,
  resolveColorRefs,
  stripDesignPlan,
} from "./designPlan";
import type { Shape } from "./store";

const block = (json: string) =>
  "Here is a landing page.\n\n```xd-design\n" + json + "\n```";

describe("parseDesignPlan", () => {
  it("extracts and parses a fenced xd-design block", () => {
    const p = parseDesignPlan(
      block(
        '{"tokens":{"colors":[{"name":"brand","value":"#0d99ff"}]},"screen":{"name":"L","w":1440,"h":1024,"children":[]}}',
      ),
    );
    expect(p?.screen.name).toBe("L");
    expect(p?.tokens.colors[0]).toEqual({ name: "brand", value: "#0d99ff" });
  });
  it("returns null when there is no block", () => {
    expect(parseDesignPlan("just some prose")).toBeNull();
  });
  it("returns null on malformed JSON (fails soft)", () => {
    expect(parseDesignPlan(block("{ not json"))).toBeNull();
  });
  it("returns null when screen is missing", () => {
    expect(parseDesignPlan(block('{"tokens":{"colors":[]}}'))).toBeNull();
  });
  it("defaults missing tokens/children to empty", () => {
    const p = parseDesignPlan(block('{"screen":{"name":"L","w":100,"h":100}}'));
    expect(p?.tokens.colors).toEqual([]);
    expect(p?.screen.children).toEqual([]);
  });
});

const FULL_PLAN = parseDesignPlan(
  "x\n```xd-design\n" +
    JSON.stringify({
      tokens: { colors: [{ name: "brand", value: "#0d99ff" }] },
      screen: {
        name: "Landing",
        w: 1440,
        h: 1024,
        fill: "color/brand",
        layout: { mode: "vertical", padding: 64, gap: 48, counterAlign: "center" },
        children: [
          { type: "text", text: "Hi", fontSize: 56, fontWeight: 700, fill: "#ffffff" },
          {
            type: "frame",
            name: "Row",
            layout: { mode: "horizontal", gap: 24 },
            children: [{ type: "rect", w: 100, h: 100, fill: "color/brand", radius: 8 }],
          },
        ],
      },
    }) +
    "\n```",
)!;

describe("planToShapes", () => {
  it("creates a root frame with auto-layout fields from the screen", () => {
    let n = 0;
    const { shapes } = planToShapes(FULL_PLAN, () => `id${n++}`);
    const root = shapes[0]! as Shape & {
      layoutMode?: string;
      paddingTop?: number;
      itemSpacing?: number;
      counterAxisAlign?: string;
    };
    expect(root.kind).toBe("frame");
    expect(root.layoutMode).toBe("vertical");
    expect(root.paddingTop).toBe(64);
    expect(root.itemSpacing).toBe(48);
    expect(root.counterAxisAlign).toBe("center");
    expect(root.parentId ?? null).toBeNull();
  });

  it("wires children to their parent and keeps color refs as color/<name>", () => {
    let n = 0;
    const { shapes } = planToShapes(FULL_PLAN, () => `id${n++}`);
    const root = shapes[0]!;
    const text = shapes.find((s) => s.kind === "text") as Shape & {
      text: string;
      fontSize?: number;
    };
    expect(text.parentId).toBe(root.id);
    expect(text.text).toBe("Hi");
    expect(text.fontSize).toBe(56);
    expect(text.fill).toBe("#ffffff");
    const rect = shapes.find((s) => s.kind === "rect")!;
    const row = shapes.find((s) => s.name === "Row")!;
    expect(rect.parentId).toBe(row.id);
    expect(rect.fill).toBe("color/brand"); // ref preserved; resolved later
  });

  it("emits the color seeds", () => {
    let n = 0;
    const { variables } = planToShapes(FULL_PLAN, () => `id${n++}`);
    expect(variables).toEqual([{ name: "brand", value: "#0d99ff" }]);
  });
});

describe("resolveColorRefs", () => {
  it("rewrites color/<name> fills to var:<id> using the name→id map", () => {
    const shapes = [
      { id: "a", kind: "rect", name: "a", x: 0, y: 0, w: 1, h: 1, fill: "color/brand", stroke: "transparent", strokeWidth: 0 },
      { id: "b", kind: "rect", name: "b", x: 0, y: 0, w: 1, h: 1, fill: "#fff", stroke: "transparent", strokeWidth: 0 },
    ] as Shape[];
    const out = resolveColorRefs(shapes, new Map([["brand", "VAR1"]]));
    expect(out[0]!.fill).toBe("var:VAR1");
    expect(out[1]!.fill).toBe("#fff"); // literal untouched
  });
});

describe("stripDesignPlan", () => {
  it("removes the fenced block from visible text", () => {
    expect(stripDesignPlan(block('{"screen":{"name":"L","w":1,"h":1}}'))).toBe(
      "Here is a landing page.",
    );
  });
});

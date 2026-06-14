import { beforeEach, describe, expect, it } from "vitest";
import { useXDesign, type Shape } from "./store";
import { ingestDesignPlan } from "./ingestDesignPlan";
import { parseDesignPlan } from "./designPlan";

const rect = (id: string, parentId: string | null = null): Shape =>
  ({
    id,
    name: id,
    kind: "rect",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    radius: 0,
    fill: "#fff",
    stroke: "transparent",
    strokeWidth: 0,
    parentId,
  }) as Shape;

describe("addShapesBatch", () => {
  beforeEach(() =>
    useXDesign.setState({ shapes: [], selection: new Set(), past: [], future: [] }),
  );

  it("appends all shapes in one history step and selects the root", () => {
    useXDesign.getState().addShapesBatch([rect("root"), rect("child", "root")], "root");
    const s = useXDesign.getState();
    expect(s.shapes.map((x) => x.id)).toEqual(["root", "child"]);
    expect(s.past).toHaveLength(1); // one undo step
    expect([...s.selection]).toEqual(["root"]);
  });

  it("undo removes the whole batch", () => {
    useXDesign.getState().addShapesBatch([rect("a"), rect("b")]);
    useXDesign.getState().undo();
    expect(useXDesign.getState().shapes).toHaveLength(0);
  });
});

describe("ingestDesignPlan", () => {
  beforeEach(() =>
    useXDesign.setState({
      shapes: [],
      selection: new Set(),
      past: [],
      future: [],
      variables: [],
      modes: [{ id: "m", name: "Default" }],
      activeModeId: "m",
    }),
  );

  it("creates color variables, resolves refs, and adds the shape graph", () => {
    const plan = parseDesignPlan(
      "x\n```xd-design\n" +
        JSON.stringify({
          tokens: { colors: [{ name: "brand", value: "#0d99ff" }] },
          screen: {
            name: "L",
            w: 200,
            h: 200,
            fill: "color/brand",
            layout: { mode: "vertical" },
            children: [{ type: "rect", fill: "color/brand" }],
          },
        }) +
        "\n```",
    )!;
    ingestDesignPlan(plan);
    const s = useXDesign.getState();
    expect(s.variables).toHaveLength(1);
    const varId = s.variables[0]!.id;
    const root = s.shapes[0]!;
    expect(root.fill).toBe(`var:${varId}`);
    const r = s.shapes.find((x) => x.kind === "rect")!;
    expect(r.fill).toBe(`var:${varId}`);
  });
});

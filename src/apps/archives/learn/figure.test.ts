// src/apps/archives/learn/figure.test.ts
import { describe, it, expect } from "vitest";
import { parseFigure, assignAnchors } from "./figure";

describe("parseFigure", () => {
  it("parses a clean figure object", () => {
    const raw = JSON.stringify({
      name: "penguin",
      outline: [{ x: 0.5, y: 0.1 }, { x: 0.4, y: 0.9 }],
      anchors: [{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.5 }],
    });
    const f = parseFigure(raw)!;
    expect(f.name).toBe("penguin");
    expect(f.outline).toHaveLength(2);
    expect(f.anchors).toHaveLength(2);
  });

  it("strips code fences", () => {
    const raw = "```json\n" + JSON.stringify({ name: "atom", outline: [{ x: 0.1, y: 0.1 }], anchors: [{ x: 0.2, y: 0.2 }] }) + "\n```";
    expect(parseFigure(raw)?.name).toBe("atom");
  });

  it("clamps out-of-range coords to 0..1 and drops non-finite points", () => {
    const raw = JSON.stringify({ name: "x", outline: [{ x: 2, y: -1 }, { x: "bad", y: 0.5 }], anchors: [{ x: 0.5, y: 0.5 }] });
    const f = parseFigure(raw)!;
    expect(f.outline).toEqual([{ x: 1, y: 0 }]); // second point dropped (non-finite x)
  });

  it("returns null on garbage", () => {
    expect(parseFigure("not json at all")).toBeNull();
  });

  it("returns null when outline or anchors are empty", () => {
    expect(parseFigure(JSON.stringify({ name: "x", outline: [], anchors: [{ x: 0.5, y: 0.5 }] }))).toBeNull();
  });
});

describe("assignAnchors", () => {
  it("zips node ids to anchors in order", () => {
    const out = assignAnchors(["n1", "n2"], [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }]);
    expect(out).toEqual({ n1: { x: 0.1, y: 0.1 }, n2: { x: 0.2, y: 0.2 } });
  });

  it("leaves surplus nodes unassigned and ignores surplus anchors", () => {
    const out = assignAnchors(["n1", "n2", "n3"], [{ x: 0.1, y: 0.1 }]);
    expect(out).toEqual({ n1: { x: 0.1, y: 0.1 } });
  });
});

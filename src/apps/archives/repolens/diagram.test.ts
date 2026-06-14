import { describe, it, expect } from "vitest";
import { lineageLayout, loopLayout } from "./diagram";
import type { DeepDive } from "./types";

const atoms: DeepDive["atoms"] = [
  { id: "a", name: "Core", kind: "module", purpose: "", files: [] },
  { id: "b", name: "API", kind: "module", purpose: "", files: [] },
  { id: "c", name: "UI", kind: "module", purpose: "", files: [] },
];
const links: DeepDive["lineage"]["links"] = [
  { from: "a", to: "b", relation: "enables", why: "" },
  { from: "b", to: "c", relation: "enables", why: "" },
];

describe("diagram", () => {
  it("lineageLayout lays out a left→right DAG by depth", () => {
    const l = lineageLayout(atoms, links)!;
    expect(l.nodes.length).toBe(3);
    expect(l.edges.length).toBe(2);
    const x = Object.fromEntries(l.nodes.map((n) => [n.id, n.x]));
    expect(x.a!).toBeLessThan(x.b!);
    expect(x.b!).toBeLessThan(x.c!);
  });
  it("returns null when no valid links", () => {
    expect(lineageLayout(atoms, [])).toBeNull();
  });
  it("loopLayout places a cycle on a circle with arc edges, null when < 2", () => {
    const l = loopLayout(["X", "Y", "Z"])!;
    expect(l.pts.length).toBe(3);
    expect(l.arcs.length).toBe(3);
    expect(l.arcs[0]!.d).toMatch(/^M.*A78,78/); // SVG arc along the circle
    expect(loopLayout(["only"])).toBeNull();
  });
});

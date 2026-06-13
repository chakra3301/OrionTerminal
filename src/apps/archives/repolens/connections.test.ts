import { describe, it, expect } from "vitest";
import { egoLayout, buildConnections } from "./connections";

const lib = [
  { repo_id: "me/center", analysis: { capabilities: ["rag", "embeddings"] } },
  { repo_id: "a/related", analysis: { capabilities: ["rag"] } }, // exact tag overlap
  { repo_id: "b/layer", analysis: { capabilities: ["evaluation"] } }, // same 'ml' layer
  { repo_id: "c/none", analysis: { capabilities: ["ui-rendering"] } }, // unrelated
];

describe("connections", () => {
  it("ranks neighbors by capability overlap, drops unrelated", () => {
    const n = buildConnections({ repoId: "me/center", capabilities: ["rag", "embeddings"] }, lib);
    const ids = n.map((x) => x.repoId);
    expect(ids).toContain("a/related");
    expect(ids).toContain("b/layer");
    expect(ids).not.toContain("c/none");
    // exact-tag match outranks layer-only match
    expect(ids.indexOf("a/related")).toBeLessThan(ids.indexOf("b/layer"));
    expect(ids).not.toContain("me/center"); // self excluded
  });
  it("egoLayout puts center at ring 0 and neighbors on a ring", () => {
    const nodes = egoLayout("me/center", [{ id: "a" }, { id: "b" }]);
    expect(nodes[0]).toMatchObject({ id: "me/center", ring: 0 });
    expect(nodes.filter((n) => n.ring === 1).length).toBe(2);
  });
});

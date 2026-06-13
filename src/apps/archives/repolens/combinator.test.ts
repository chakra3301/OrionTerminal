import { describe, it, expect } from "vitest";
import { scoreCombo, combineCandidates, buildCombinatorPrompt, parseCombinator } from "./combinator";

const rows = [
  { repoId: "a/vec", capabilities: ["vector-index"], eli5: "a vector db" },
  { repoId: "b/ui", capabilities: ["ui-rendering"], eli5: "a ui lib" },
  { repoId: "c/rag", capabilities: ["rag"], eli5: "a rag pipeline" },
];

describe("combinator ranking", () => {
  it("scores a combo with adjacency/disjointness/spread", () => {
    const s = scoreCombo([rows[0]!, rows[2]!], 0);
    expect(s.disjointness).toBeGreaterThan(0);
    expect(typeof s.score).toBe("number");
  });
  it("combineCandidates returns ranked combos of size 2-3", () => {
    const c = combineCandidates(rows, { topK: 6 });
    expect(c.length).toBeGreaterThan(0);
    expect(c[0]!.repoIds.length).toBeGreaterThanOrEqual(2);
    // sorted best-first
    expect(c[0]!.score).toBeGreaterThanOrEqual(c[c.length - 1]!.score);
  });
  it("seed appears in every candidate when given", () => {
    const c = combineCandidates(rows, { seed: "a/vec", topK: 6 });
    expect(c.every((x) => x.repoIds.includes("a/vec"))).toBe(true);
  });
});

describe("combinator synthesis", () => {
  it("builds a prompt listing each repo + capabilities", () => {
    const p = buildCombinatorPrompt(rows);
    expect(p).toContain("a/vec [vector-index]");
    expect(p).toContain("fuses these repositories");
  });
  it("parses + clamps scores + filters contributions to inputs", () => {
    const r = parseCombinator(
      JSON.stringify({
        title: "T",
        pitch: "P",
        novelty: 9,
        feasibility: -2,
        first_step: "go",
        contributions: [
          { repoId: "a/vec", role: "storage" },
          { repoId: "x/ghost", role: "nope" },
        ],
      }),
      ["a/vec", "c/rag"],
    );
    expect(r.title).toBe("T");
    expect(r.novelty).toBe(5);
    expect(r.feasibility).toBe(0);
    expect(r.contributions).toEqual([{ repoId: "a/vec", role: "storage" }]);
  });
});

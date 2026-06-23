import { describe, it, expect } from "vitest";
import { parseGraphSpec, parseLesson } from "./learnTypes";

describe("parseGraphSpec", () => {
  it("parses a fenced JSON graph", () => {
    const raw = "```json\n" + JSON.stringify({
      summary: "Learn photography",
      nodes: [
        { key: "a", title: "Exposure", objective: "Be able to set exposure", bloom_level: "apply", level: "basics" },
        { key: "b", title: "Composition", objective: "Compose shots", bloom_level: "create", level: "intermediate", prereqs: ["a"] },
      ],
    }) + "\n```";
    const g = parseGraphSpec(raw);
    expect(g.nodes).toHaveLength(2);
    expect(g.nodes[1]!.prereqs).toEqual(["a"]);
    expect(g.summary).toBe("Learn photography");
  });

  it("salvages prose-wrapped JSON and coerces missing arrays", () => {
    const raw = 'Sure! Here is your tree: {"nodes":[{"key":"x","title":"X","level":"basics"}]} hope it helps';
    const g = parseGraphSpec(raw);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]!.prereqs).toEqual([]);
  });

  it("returns an empty graph on garbage", () => {
    expect(parseGraphSpec("no json here").nodes).toEqual([]);
  });
});

describe("parseLesson", () => {
  it("parses a lesson and coerces all arrays", () => {
    const raw = JSON.stringify({
      objective: "Balance the exposure triangle",
      concept_chunks: [{ tag: "Concept", body: "Light is a bucket." }],
      worked_example: { title: "Sunset", steps: [{ text: "Set f/11", why: "deep DoF" }] },
      key_terms: ["Aperture", "ISO"],
      suggested_resources: [{ type: "video", title: "Exposure 101", search_query: "exposure triangle" }],
      recall_check: [{ prompt: "Widen aperture — fix shutter how?", expected: "speed it up", concept: "reciprocity" }],
    });
    const l = parseLesson(raw);
    expect(l.concept_chunks).toHaveLength(1);
    expect(l.recall_check[0]!.concept).toBe("reciprocity");
  });

  it("never throws; missing fields become safe empties", () => {
    const l = parseLesson("{}");
    expect(l.objective).toBe("");
    expect(l.concept_chunks).toEqual([]);
    expect(l.recall_check).toEqual([]);
    expect(l.worked_example).toBeNull();
    expect(l.visuals).toEqual([]);
  });
});

describe("parseLesson visuals", () => {
  it("parses each visual kind and keeps only its payload", () => {
    const raw = JSON.stringify({
      visuals: [
        { kind: "flow", title: "Pipeline", chunk: 0, caption: "x", steps: [{ label: "A", detail: "first" }, { label: "B", detail: "second" }] },
        { kind: "tree", title: "Taxonomy", chunk: 1, nodes: [{ label: "Root", detail: "", parent: null }, { label: "Child", detail: "", parent: 0 }] },
        { kind: "compare", title: "A vs B", chunk: 2, leftLabel: "A", rightLabel: "B", rows: [{ aspect: "speed", left: "fast", right: "slow" }] },
        { kind: "analogy", title: "Map", chunk: 0, leftLabel: "Bucket", rightLabel: "Memory", pairs: [{ familiar: "water", concept: "data", note: "flows in" }] },
        { kind: "timeline", title: "History", chunk: 3, steps: [{ label: "1990", detail: "start" }, { label: "2000", detail: "grew" }] },
      ],
    });
    const l = parseLesson(raw);
    expect(l.visuals.map((v) => v.kind)).toEqual(["flow", "tree", "compare", "analogy", "timeline"]);
    expect(l.visuals[1]!.nodes[1]!.parent).toBe(0);
    expect(l.visuals[3]!.pairs[0]!.note).toBe("flows in");
  });

  it("drops unknown kinds and payload-less visuals", () => {
    const raw = JSON.stringify({
      visuals: [
        { kind: "pie-chart", title: "nope", steps: [] },
        { kind: "flow", title: "too short", steps: [{ label: "only one", detail: "" }] },
        { kind: "compare", title: "empty", rows: [] },
        { kind: "cycle", title: "ok", steps: [{ label: "A", detail: "" }, { label: "B", detail: "" }] },
      ],
    });
    const l = parseLesson(raw);
    expect(l.visuals).toHaveLength(1);
    expect(l.visuals[0]!.kind).toBe("cycle");
  });

  it("defaults chunk to -1 when missing", () => {
    const raw = JSON.stringify({ visuals: [{ kind: "flow", title: "t", steps: [{ label: "A" }, { label: "B" }] }] });
    expect(parseLesson(raw).visuals[0]!.chunk).toBe(-1);
  });
});

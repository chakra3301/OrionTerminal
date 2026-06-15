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
  });
});

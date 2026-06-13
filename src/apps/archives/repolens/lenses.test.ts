import { describe, it, expect } from "vitest";
import { parseAtoms, parseLineage, parseFeynman, parseSktpg } from "./lenses";

describe("deepdive parsers", () => {
  it("parseAtoms fills ids + defaults", () => {
    const r = parseAtoms(JSON.stringify({ atoms: [{ name: "Core", purpose: "p" }] }));
    expect(r.atoms[0]!.id).toBe("atom-1");
    expect(r.atoms[0]!.kind).toBe("module");
    expect(r.atoms[0]!.files).toEqual([]);
  });
  it("parseLineage drops links missing from/to", () => {
    const r = parseLineage(
      JSON.stringify({ links: [{ from: "a", to: "b" }, { from: "a" }], roots: ["a"], leaves: ["b"] }),
    );
    expect(r.links.length).toBe(1);
    expect(r.links[0]!.relation).toBe("depends-on");
  });
  it("parseFeynman shapes questions + confidence", () => {
    const r = parseFeynman(
      JSON.stringify({ explanation: "e", questions: [{ q: "Q", a: "A" }], confidence: [{ claim: "c" }] }),
    );
    expect(r.explanation).toBe("e");
    expect(r.questions[0]!.q).toBe("Q");
    expect(r.confidence[0]!.level).toBe("medium");
  });
  it("salvages fenced JSON", () => {
    expect(parseAtoms("```json\n{\"atoms\":[]}\n```").atoms).toEqual([]);
  });
});

describe("sktpg parser", () => {
  it("clamps score 0-100 + derives band", () => {
    const r = parseSktpg(JSON.stringify({ score: { value: 250 }, thesis: { becoming: "x" } }));
    expect(r.score.value).toBe(100);
    expect(r.score.band).toBe("Urgent");
    expect(r.thesis.becoming).toBe("x");
  });
  it("defaults evidence to Unknown", () => {
    const r = parseSktpg(JSON.stringify({ base_rate: { evidence: "bogus" } }));
    expect(r.base_rate.evidence).toBe("Unknown");
  });
});

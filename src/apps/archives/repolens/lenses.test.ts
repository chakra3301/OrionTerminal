import { describe, it, expect } from "vitest";
import { parseAtoms, parseLineage, parseFeynman } from "./lenses";

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

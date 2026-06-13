import { describe, it, expect } from "vitest";
import {
  parseAtoms,
  parseLineage,
  parseFeynman,
  parseSktpg,
  buildSynergiesPrompt,
  parseSynergies,
  buildVersusPrompt,
  parseVersus,
  buildTagPrompt,
  parseTags,
} from "./lenses";
import type { RepoData } from "./types";

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

describe("synergies", () => {
  it("builds a prompt listing candidates", () => {
    const p = buildSynergiesPrompt(
      { repoId: "a/b", eli5: "x", category: "DB", language: "Rust" },
      [{ repoId: "c/d", category: "UI", eli5: "ui" }],
    );
    expect(p).toContain("a/b");
    expect(p).toContain("c/d");
  });
  it("parses synergies array", () => {
    const r = parseSynergies(
      JSON.stringify({ synergies: [{ repoId: "x/y", category: "C", synergy: "S", in_library: true }] }),
    );
    expect(r.synergies[0]!.repoId).toBe("x/y");
    expect(r.synergies[0]!.in_library).toBe(true);
  });
});

describe("versus", () => {
  const r = (id: string): RepoData => ({
    platform: "github",
    repo_id: id,
    description: "d",
    language: "TS",
    license: "MIT",
    stars: 1,
    readme: "readme",
    languages: [],
    dependencies: [],
  });
  it("builds a head-to-head prompt with both repos", () => {
    const p = buildVersusPrompt(r("a/one"), r("b/two"));
    expect(p).toContain("a/one");
    expect(p).toContain("b/two");
    expect(p).toContain("HEAD-TO-HEAD");
  });
  it("parses dimensions + clamps winner", () => {
    const v = parseVersus(
      JSON.stringify({
        summary_a: "A",
        dimensions: [{ label: "Maturity", a: "x", b: "y", winner: "bogus" }],
        verdict: "pick A",
      }),
    );
    expect(v.summary_a).toBe("A");
    expect(v.dimensions[0]!.winner).toBe("tie");
    expect(v.verdict).toBe("pick A");
  });
});

describe("retag", () => {
  it("builds a tag prompt from analysis metadata", () => {
    const p = buildTagPrompt({ repoId: "a/b", category: "DB", eli5: "a database" });
    expect(p).toContain("a/b");
    expect(p).toContain("capabilities");
  });
  it("parses + clamps capabilities to the taxonomy", () => {
    expect(parseTags('{"capabilities":["RAG","bogus","embeddings"]}')).toEqual(["rag", "embeddings"]);
  });
  it("returns [] on junk", () => {
    expect(parseTags("no json")).toEqual([]);
  });
});

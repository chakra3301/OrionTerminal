import { describe, it, expect } from "vitest";
import { extractConcepts } from "@/features/notes/visualizer/conceptExtract";

describe("extractConcepts", () => {
  it("returns empty for blank or tiny text", () => {
    expect(extractConcepts("")).toEqual({ concepts: [], links: [] });
    expect(extractConcepts("hi ok")).toEqual({ concepts: [], links: [] });
  });

  it("extracts frequent terms and drops stopwords", () => {
    const { concepts } = extractConcepts(
      "the rocket engine burned. the rocket engine roared. a rocket lifted.",
    );
    const terms = concepts.map((c) => c.term);
    expect(terms).toContain("rocket");
    expect(terms).toContain("engine");
    expect(terms).not.toContain("the");
    // rocket (3×) outranks engine (2×)
    expect(terms.indexOf("rocket")).toBeLessThan(terms.indexOf("engine"));
  });

  it("normalizes the top concept to weight 1", () => {
    const { concepts } = extractConcepts(
      "coffee coffee coffee morning. coffee ritual matters.",
    );
    expect(concepts[0]!.term).toBe("coffee");
    expect(concepts[0]!.weight).toBe(1);
  });

  it("merges consecutive capitalized words into one entity and boosts it", () => {
    const { concepts } = extractConcepts(
      "we visited New York yesterday. walking around was tiring but nice.",
    );
    const terms = concepts.map((c) => c.term);
    expect(terms).toContain("new york");
    expect(terms).not.toContain("york");
  });

  it("does not treat sentence-initial capitals as entities", () => {
    const { concepts } = extractConcepts(
      "Walking calms the mind. walking every day helps focus.",
    );
    const walking = concepts.find((c) => c.term === "walking");
    expect(walking).toBeTruthy();
  });

  it("links terms that co-occur in a sentence", () => {
    const { links } = extractConcepts(
      "the garden needs water. the garden needs water. sunlight feeds nothing here.",
    );
    const key = links.map((l) => [l.a, l.b].sort().join("|"));
    expect(key).toContain("garden|water");
  });

  it("marks terms near the end of the text as recent", () => {
    const lines = Array.from({ length: 20 }, () => "morning pages flow easily.").join(" ");
    const { concepts } = extractConcepts(`${lines} suddenly volcano appeared.`);
    const volcano = concepts.find((c) => c.term === "volcano");
    expect(volcano?.recent).toBe(true);
  });

  it("caps the number of concepts", () => {
    const text = Array.from(
      { length: 40 },
      (_, i) => `unique${i} concept${i} matters greatly.`,
    ).join(" ");
    const { concepts } = extractConcepts(text, 10);
    expect(concepts.length).toBeLessThanOrEqual(10);
  });
});

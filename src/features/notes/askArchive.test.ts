import { describe, expect, it } from "vitest";
import { buildPrompt } from "./askArchive";

describe("buildPrompt", () => {
  const sources = [
    { n: 1, title: "Trip plan", body: "Fly to Lisbon on the 3rd." },
    { n: 2, title: "Budget", body: "Saved $2000 for travel." },
  ];

  it("numbers and includes every source", () => {
    const p = buildPrompt("When do I fly?", sources);
    expect(p).toContain("[1] Trip plan");
    expect(p).toContain("Fly to Lisbon");
    expect(p).toContain("[2] Budget");
    expect(p).toContain("Saved $2000");
  });

  it("instructs citation + no-invention and includes the question", () => {
    const p = buildPrompt("When do I fly?", sources);
    expect(p.toLowerCase()).toContain("cite");
    expect(p.toLowerCase()).toContain("only the user's own notes");
    expect(p).toContain("Question: When do I fly?");
  });
});

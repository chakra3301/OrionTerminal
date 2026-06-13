import { describe, expect, it } from "vitest";
import {
  buildSelectionPrompt,
  buildContinuePrompt,
  buildSummarizeNotePrompt,
  cleanAiText,
  parseBullets,
} from "./noteInlineAi";

describe("prompt builders", () => {
  it("selection prompt carries instruction + text + output guard", () => {
    const p = buildSelectionPrompt("fix", "teh cat");
    expect(p.toLowerCase()).toContain("fix spelling");
    expect(p).toContain("teh cat");
    expect(p.toLowerCase()).toContain("output only");
  });

  it("continue prompt keeps only the tail and forbids repetition", () => {
    const long = "x".repeat(5000);
    const p = buildContinuePrompt(long);
    expect(p).toContain("Do NOT repeat");
    expect(p.length).toBeLessThan(2200);
  });

  it("summarize prompt asks for bullets", () => {
    expect(buildSummarizeNotePrompt("body").toLowerCase()).toContain("bullet");
  });
});

describe("cleanAiText", () => {
  it("strips a surrounding code fence", () => {
    expect(cleanAiText("```\nhello\n```")).toBe("hello");
    expect(cleanAiText("```ts\ncode()\n```")).toBe("code()");
  });
  it("strips wrapping quotes", () => {
    expect(cleanAiText('"quoted"')).toBe("quoted");
  });
  it("leaves clean text alone", () => {
    expect(cleanAiText("  just text  ")).toBe("just text");
  });
});

describe("parseBullets", () => {
  it("extracts bullet lines, stripping markers", () => {
    expect(parseBullets("- one\n- two\n* three")).toEqual(["one", "two", "three"]);
  });
  it("drops blanks and caps at six", () => {
    expect(parseBullets("- a\n\n- b\n- c\n- d\n- e\n- f\n- g")).toHaveLength(6);
  });
});

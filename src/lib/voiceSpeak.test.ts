import { describe, expect, it } from "vitest";
import { speakableText } from "@/lib/voiceSpeak";

describe("speakableText", () => {
  it("drops fenced code blocks entirely", () => {
    const input = "Here is code:\n```ts\nconst x = 1;\n```\nDone.";
    const out = speakableText(input);
    expect(out).not.toContain("const x");
    expect(out).toContain("Here is code");
    expect(out).toContain("Done.");
  });

  it("unwraps inline code to its content", () => {
    expect(speakableText("run `npm test` now")).toBe("run npm test now");
  });

  it("strips emphasis + heading markers", () => {
    expect(speakableText("**bold** and _italic_")).toBe("bold and italic");
    expect(speakableText("# Heading\nbody")).toBe("Heading body");
  });

  it("strips list bullets", () => {
    expect(speakableText("- one\n- two")).toBe("one two");
  });

  it("keeps link label, drops the URL", () => {
    expect(speakableText("see [the docs](https://x.com/y)")).toBe(
      "see the docs",
    );
  });

  it("collapses whitespace + trims", () => {
    expect(speakableText("  a\n\n  b   c ")).toBe("a b c");
  });

  it("returns empty for whitespace-only / code-only input", () => {
    expect(speakableText("   ")).toBe("");
    expect(speakableText("```\njust code\n```")).toBe("");
  });
});

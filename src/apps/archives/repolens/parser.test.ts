import { describe, it, expect } from "vitest";
import { parseClaudeResponse } from "./parser";

const minimal = JSON.stringify({
  eli5: "x",
  bottom_line: "y",
  technical: "t",
  health: { score: 80, summary: "ok" },
  pros: ["p"],
  cons: ["c"],
  capabilities: ["rag", "bogus"],
  highlights: [{ text: "h", why: "w", severity: "weird", tab: "not_a_tab" }],
});

describe("parser", () => {
  it("parses clean JSON", () => {
    const a = parseClaudeResponse(minimal);
    expect(a.eli5).toBe("x");
    expect(a.health.score).toBe(80);
  });
  it("salvages fenced + prose-wrapped JSON", () => {
    const a = parseClaudeResponse("Sure!\n```json\n" + minimal + "\n```\nHope that helps");
    expect(a.bottom_line).toBe("y");
  });
  it("clamps capabilities to the taxonomy", () => {
    expect(parseClaudeResponse(minimal).capabilities).toEqual(["rag"]);
  });
  it("clamps highlight severity + tab to allow-lists", () => {
    const h = parseClaudeResponse(minimal).highlights[0]!;
    expect(h.severity).toBe("insight");
    expect(h.tab).toBe("");
  });
  it("throws on no JSON", () => {
    expect(() => parseClaudeResponse("no json here")).toThrow();
  });
});

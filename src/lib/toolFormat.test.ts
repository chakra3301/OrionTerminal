import { describe, expect, it } from "vitest";
import { prettyToolName, formatToolResult } from "@/lib/toolFormat";

describe("prettyToolName", () => {
  it("strips the mcp__<server>__ prefix", () => {
    expect(prettyToolName("mcp__orion__orion_create_note")).toBe(
      "orion_create_note",
    );
  });
  it("leaves built-in tools unchanged", () => {
    expect(prettyToolName("Bash")).toBe("Bash");
    expect(prettyToolName("Read")).toBe("Read");
  });
});

describe("formatToolResult", () => {
  it("returns empty for null/undefined", () => {
    expect(formatToolResult(undefined)).toBe("");
    expect(formatToolResult(null)).toBe("");
  });

  it("pretty-prints a JSON-string result (no escaped quotes)", () => {
    const out = formatToolResult('{"ok":true,"id":"abc"}');
    expect(out).toBe('{\n  "ok": true,\n  "id": "abc"\n}');
    expect(out).not.toContain('\\"');
  });

  it("leaves a non-JSON string as-is", () => {
    expect(formatToolResult("done — 3 files changed")).toBe(
      "done — 3 files changed",
    );
  });

  it("extracts text from claude's array-shaped content", () => {
    const out = formatToolResult([
      { type: "text", text: "line one" },
      { type: "text", text: "line two" },
    ]);
    expect(out).toBe("line one\nline two");
  });

  it("pretty-prints JSON embedded in an array text block", () => {
    const out = formatToolResult([{ type: "text", text: '{"hits":[]}' }]);
    expect(out).toBe('{\n  "hits": []\n}');
  });

  it("stringifies a plain object", () => {
    expect(formatToolResult({ ok: false })).toBe('{\n  "ok": false\n}');
  });

  it("truncates very long output", () => {
    const huge = "x".repeat(5000);
    const out = formatToolResult(huge);
    expect(out.length).toBeLessThan(2100);
    expect(out.endsWith("… (truncated)")).toBe(true);
  });
});

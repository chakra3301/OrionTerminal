import { describe, expect, it } from "vitest";
import { applyEditsToText } from "./lspWorkspaceEdit";

const r = (sl: number, sc: number, el: number, ec: number) => ({
  start: { line: sl, character: sc },
  end: { line: el, character: ec },
});

describe("applyEditsToText", () => {
  it("replaces a single span", () => {
    expect(applyEditsToText("const foo = 1;", [{ range: r(0, 6, 0, 9), newText: "bar" }])).toBe(
      "const bar = 1;",
    );
  });

  it("applies multiple non-overlapping edits regardless of order", () => {
    // Rename every `foo` -> `bar` on one line; edits given top-to-bottom.
    const text = "foo + foo";
    const edits = [
      { range: r(0, 0, 0, 3), newText: "bar" },
      { range: r(0, 6, 0, 9), newText: "bar" },
    ];
    expect(applyEditsToText(text, edits)).toBe("bar + bar");
  });

  it("handles edits across multiple lines", () => {
    const text = "line0\nline1\nline2";
    const edits = [
      { range: r(0, 0, 0, 5), newText: "L0" },
      { range: r(2, 0, 2, 5), newText: "L2" },
    ];
    expect(applyEditsToText(text, edits)).toBe("L0\nline1\nL2");
  });

  it("inserts (zero-width range)", () => {
    expect(applyEditsToText("ab", [{ range: r(0, 1, 0, 1), newText: "X" }])).toBe("aXb");
  });

  it("is stable when edits arrive bottom-to-top too", () => {
    const text = "foo + foo";
    const edits = [
      { range: r(0, 6, 0, 9), newText: "bar" },
      { range: r(0, 0, 0, 3), newText: "bar" },
    ];
    expect(applyEditsToText(text, edits)).toBe("bar + bar");
  });
});

import { describe, expect, it } from "vitest";
import {
  computeHunks,
  composeFromHunks,
  foldHunkIntoOriginal,
  dropHunkFromUpdated,
  hunkStats,
} from "./lineDiff";

const allIdx = (n: number) => new Set(Array.from({ length: n }, (_, i) => i));

describe("computeHunks", () => {
  it("returns no hunks for identical content", () => {
    expect(computeHunks("a\nb\nc", "a\nb\nc")).toEqual([]);
  });

  it("detects a single replaced line", () => {
    const h = computeHunks("a\nb\nc", "a\nX\nc");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      origStart: 1,
      origLines: ["b"],
      newStart: 1,
      newLines: ["X"],
    });
  });

  it("detects a pure insertion", () => {
    const h = computeHunks("a\nc", "a\nb\nc");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ origLines: [], newLines: ["b"] });
  });

  it("detects a pure deletion", () => {
    const h = computeHunks("a\nb\nc", "a\nc");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ origLines: ["b"], newLines: [] });
  });

  it("separates distant changes into multiple hunks", () => {
    const original = ["1", "2", "3", "4", "5", "6", "7", "8"].join("\n");
    const updated = ["1", "TWO", "3", "4", "5", "6", "SEVEN", "8"].join("\n");
    const h = computeHunks(original, updated);
    expect(h).toHaveLength(2);
    expect(h[0]?.origLines).toEqual(["2"]);
    expect(h[1]?.origLines).toEqual(["7"]);
  });

  it("handles trailing-newline differences losslessly", () => {
    const h = computeHunks("a\nb\n", "a\nb");
    expect(composeFromHunks("a\nb\n", h, allIdx(h.length))).toBe("a\nb");
    expect(composeFromHunks("a\nb\n", h, new Set())).toBe("a\nb\n");
  });

  it("handles empty original (new content)", () => {
    const h = computeHunks("", "a\nb");
    expect(composeFromHunks("", h, allIdx(h.length))).toBe("a\nb");
  });
});

describe("composeFromHunks round-trips", () => {
  const original = ["fn main() {", "  old();", "}", "", "const A = 1;"].join("\n");
  const updated = ["// header", "fn main() {", "  new();", "  extra();", "}", "", "const A = 2;"].join("\n");

  it("all hunks accepted reproduces updated exactly", () => {
    const h = computeHunks(original, updated);
    expect(composeFromHunks(original, h, allIdx(h.length))).toBe(updated);
  });

  it("no hunks accepted reproduces original exactly", () => {
    const h = computeHunks(original, updated);
    expect(composeFromHunks(original, h, new Set())).toBe(original);
  });

  it("subset acceptance keeps only chosen hunks and re-diffs cleanly", () => {
    const h = computeHunks(original, updated);
    expect(h.length).toBeGreaterThanOrEqual(2);
    const partial = composeFromHunks(original, h, new Set([0]));
    expect(partial).not.toBe(original);
    expect(partial).not.toBe(updated);
    // The partial content diffs against updated by exactly the dropped hunks.
    expect(computeHunks(partial, updated).length).toBe(h.length - 1);
  });
});

describe("fold operations", () => {
  const original = "a\nb\nc\nd\ne";
  const updated = "a\nB\nc\nD\ne";

  it("accept-fold removes the hunk from the remaining diff", () => {
    const h = computeHunks(original, updated);
    expect(h).toHaveLength(2);
    const nextOriginal = foldHunkIntoOriginal(original, h, 0);
    const remaining = computeHunks(nextOriginal, updated);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.origLines).toEqual(["d"]);
  });

  it("reject-fold reverts exactly that hunk in updated", () => {
    const h = computeHunks(original, updated);
    const nextUpdated = dropHunkFromUpdated(original, h, 1);
    expect(nextUpdated).toBe("a\nB\nc\nd\ne");
    const remaining = computeHunks(original, nextUpdated);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.newLines).toEqual(["B"]);
  });

  it("folding every hunk one way or the other converges to zero hunks", () => {
    let orig = original;
    let upd = updated;
    let hunks = computeHunks(orig, upd);
    orig = foldHunkIntoOriginal(orig, hunks, 0);
    hunks = computeHunks(orig, upd);
    upd = dropHunkFromUpdated(orig, hunks, 0);
    hunks = computeHunks(orig, upd);
    expect(hunks).toHaveLength(0);
    expect(orig).toBe(upd);
  });
});

describe("hunkStats", () => {
  it("counts added and removed lines", () => {
    const h = computeHunks("a\nb\nc", "a\nX\nY\nc");
    expect(hunkStats(h)).toEqual({ added: 2, removed: 1 });
  });
});

import { describe, expect, it } from "vitest";
import { chunkCode, looksMinified, chunkEmbedText } from "./codeChunker";

function fnBlock(name: string, bodyLines: number): string {
  return [
    `export function ${name}() {`,
    ...Array.from({ length: bodyLines }, (_, i) => `  const x${i} = ${i};`),
    "}",
    "",
  ].join("\n");
}

describe("chunkCode", () => {
  it("returns nothing for empty content", () => {
    expect(chunkCode("")).toEqual([]);
    expect(chunkCode("\n\n\n")).toEqual([]);
  });

  it("keeps a small file as one chunk", () => {
    const chunks = chunkCode(fnBlock("small", 5));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.startLine).toBe(1);
  });

  it("breaks at declaration boundaries once past the minimum", () => {
    const src = fnBlock("first", 14) + fnBlock("second", 14) + fnBlock("third", 14);
    const chunks = chunkCode(src);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Every chunk after the first starts on a declaration line.
    for (const c of chunks.slice(1)) {
      expect(src.split("\n")[c.startLine - 1]).toMatch(/^export function/);
    }
  });

  it("hard-splits runs longer than the max even without declarations", () => {
    const src = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const chunks = chunkCode(src);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.endLine - c.startLine + 1).toBeLessThanOrEqual(70);
    }
  });

  it("covers the whole file with contiguous 1-based ranges", () => {
    const src = fnBlock("a", 30) + fnBlock("b", 30) + fnBlock("c", 30);
    const chunks = chunkCode(src);
    expect(chunks[0]?.startLine).toBe(1);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]?.startLine).toBe(chunks[i - 1]!.endLine + 1);
    }
    expect(chunks[chunks.length - 1]?.endLine).toBe(src.split("\n").length);
  });

  it("recognizes rust and python declarations", () => {
    const rust = ["pub fn alpha() {", ...Array(14).fill("  let a = 1;"), "}", "fn beta() {", ...Array(14).fill("  let b = 2;"), "}"].join("\n");
    expect(chunkCode(rust).length).toBeGreaterThanOrEqual(2);
    const py = ["def alpha():", ...Array(14).fill("    a = 1"), "", "def beta():", ...Array(14).fill("    b = 2")].join("\n");
    expect(chunkCode(py).length).toBeGreaterThanOrEqual(2);
  });
});

describe("looksMinified", () => {
  it("flags single-line bundles", () => {
    expect(looksMinified(`${"x".repeat(5000)}\n`)).toBe(true);
  });
  it("passes normal source", () => {
    expect(looksMinified(fnBlock("ok", 20))).toBe(false);
  });
});

describe("chunkEmbedText", () => {
  it("prefixes the path and line range", () => {
    const [chunk] = chunkCode(fnBlock("x", 3));
    expect(chunkEmbedText("src/a.ts", chunk!)).toMatch(/^src\/a\.ts \(lines 1-/);
  });
});

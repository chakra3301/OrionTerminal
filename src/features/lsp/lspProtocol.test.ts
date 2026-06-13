import { describe, expect, it } from "vitest";
import {
  toLspPosition,
  fromLspRange,
  lspSeverityToMonaco,
  diagnosticToMarker,
  pathToUri,
  uriToPath,
  lspLanguageId,
} from "./lspProtocol";

describe("position conversions", () => {
  it("Monaco 1-based -> LSP 0-based", () => {
    expect(toLspPosition(1, 1)).toEqual({ line: 0, character: 0 });
    expect(toLspPosition(10, 5)).toEqual({ line: 9, character: 4 });
  });

  it("LSP range -> Monaco range", () => {
    expect(
      fromLspRange({ start: { line: 0, character: 0 }, end: { line: 2, character: 3 } }),
    ).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 4 });
  });
});

describe("severity + diagnostics", () => {
  it("maps LSP severities to Monaco", () => {
    expect(lspSeverityToMonaco(1)).toBe(8);
    expect(lspSeverityToMonaco(2)).toBe(4);
    expect(lspSeverityToMonaco(3)).toBe(2);
    expect(lspSeverityToMonaco(4)).toBe(1);
    expect(lspSeverityToMonaco(undefined)).toBe(8);
  });

  it("converts a diagnostic to a marker", () => {
    const m = diagnosticToMarker({
      range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } },
      severity: 1,
      message: "Cannot find name 'foo'.",
      source: "ts",
      code: 2304,
    });
    expect(m).toEqual({
      startLineNumber: 5,
      startColumn: 3,
      endLineNumber: 5,
      endColumn: 9,
      message: "Cannot find name 'foo'.",
      severity: 8,
      source: "ts",
      code: "2304",
    });
  });
});

describe("uri round-trip", () => {
  it("encodes and decodes paths with spaces", () => {
    const p = "/Users/x/my project/src/a b.ts";
    expect(uriToPath(pathToUri(p))).toBe(p);
  });
  it("keeps slashes unescaped", () => {
    expect(pathToUri("/a/b.ts")).toBe("file:///a/b.ts");
  });
});

describe("lspLanguageId", () => {
  it("maps known extensions", () => {
    expect(lspLanguageId("a.ts")).toBe("typescript");
    expect(lspLanguageId("a.tsx")).toBe("typescriptreact");
    expect(lspLanguageId("a.py")).toBe("python");
    expect(lspLanguageId("a.rs")).toBe("rust");
  });
  it("returns null for unsupported", () => {
    expect(lspLanguageId("a.css")).toBeNull();
    expect(lspLanguageId("README")).toBeNull();
  });
});

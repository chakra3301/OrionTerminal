import { expect, it } from "vitest";
import { validateHtmlArtifact } from "./htmlArtifactData";

it("migrates legacy defaults without changing HTML text", () => {
  const html = "<!doctype html><h1>你好 🛰️</h1><script>let n = 47;</script>";
  expect(validateHtmlArtifact({ html }, true)).toEqual({ version: 1, html, title: "Untitled page", open: false });
});

it("requires supported typed persisted data, preserving malformed and future data for review", () => {
  for (const value of [null, [], {}, { version: 2, html: "page", title: "title", open: true },
    { version: 1, html: "page", title: 47, open: true }, { version: 1, html: "page", title: "title", open: "yes" }]) {
    expect(() => validateHtmlArtifact(value)).toThrow(/invalid, unsupported/);
  }
});

it("enforces the existing preview UTF-8 byte limit, not JavaScript character count", () => {
  expect(() => validateHtmlArtifact({ version: 1, html: "🚀".repeat(6_250_001), title: "Large", open: true })).toThrow(/25 MB/);
});

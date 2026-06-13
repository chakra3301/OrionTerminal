import { describe, it, expect } from "vitest";
import { tokens, rankRepos, findSimilar } from "./search";

describe("search", () => {
  it("tokens lowercases, splits, keeps +#., drops stopwords", () => {
    expect(tokens("A Node.js CLI for C++")).toEqual(["node.js", "cli", "c++"]);
  });
  it("rankRepos ranks by BM25 + excludes self", () => {
    const rows = [
      { repoId: "me/self", language: "Rust", category: "CLI Tool" },
      { repoId: "a/rustcli", language: "Rust", category: "CLI Tool" },
      { repoId: "b/jsui", language: "JavaScript", category: "UI Framework" },
    ];
    const out = rankRepos(rows, "Rust CLI Tool", { excludeId: "me/self", topK: 3 });
    expect(out[0]!.repoId).toBe("a/rustcli");
    expect(out.find((r) => r.repoId === "me/self")).toBeUndefined();
  });
  it("findSimilar builds a lang+category query over the library", () => {
    const lib = [
      { repo_id: "me/self", analysis: { language: "Go", category: "Database" } },
      { repo_id: "a/godb", analysis: { language: "Go", category: "Database" } },
      { repo_id: "b/other", analysis: { language: "Python", category: "ML" } },
    ];
    const out = findSimilar({ repoId: "me/self", language: "Go", category: "Database" }, lib, 5);
    expect(out[0]!.repoId).toBe("a/godb");
  });
});

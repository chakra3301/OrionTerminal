import { describe, it, expect } from "vitest";
import {
  buildFrameworkPrompt,
  parseFramework,
  ALL_FRAMEWORKS,
  frameworkLabel,
  isFrameworkKey,
} from "./frameworks";
import type { RepoData, RepoSource } from "./types";

const repo: RepoData = {
  platform: "github",
  repo_id: "a/b",
  description: "d",
  language: "TS",
  license: "MIT",
  stars: 1,
  readme: "r",
  languages: [],
  dependencies: [],
};
const source: RepoSource = { tree: [], files: [], degraded: true };

describe("frameworks", () => {
  it("exposes 10 frameworks across 3 groups", () => {
    expect(ALL_FRAMEWORKS.length).toBe(10);
    expect(isFrameworkKey("toc")).toBe(true);
    expect(isFrameworkKey("nope")).toBe(false);
    expect(frameworkLabel("pareto")).toBe("Pareto (80/20)");
  });
  it("builds the right prompt for a key, embedding repo context", () => {
    const p = buildFrameworkPrompt("toc", repo, source);
    expect(p).toContain("THEORY OF CONSTRAINTS");
    expect(p).toContain("a/b");
  });
  it("falls back to toc for an unknown key", () => {
    expect(buildFrameworkPrompt("bogus", repo, source)).toContain("THEORY OF CONSTRAINTS");
  });
  it("parses arbitrary framework JSON generically", () => {
    expect(parseFramework('```json\n{"vital_few":[{"factor":"x"}]}\n```')).toEqual({
      vital_few: [{ factor: "x" }],
    });
  });
});

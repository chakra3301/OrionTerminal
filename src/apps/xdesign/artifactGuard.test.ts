import { describe, expect, it } from "vitest";
import {
  inspectArtifact,
  isShippable,
  externalImageRefs,
  summarizeIssues,
  buildRepairPrompt,
} from "./artifactGuard";

const GOOD = `<!doctype html><html><head><title>Acme</title><meta name="viewport" content="width=device-width"></head><body><h1>Ship it</h1><input placeholder="Email"></body></html>`;

describe("inspectArtifact", () => {
  it("passes a complete, real page (placeholder attr is fine)", () => {
    expect(inspectArtifact(GOOD)).toEqual([]);
    expect(isShippable(GOOD)).toBe(true);
  });

  it("flags missing scaffolding", () => {
    const issues = inspectArtifact(`<html><body>hi</body></html>`);
    expect(issues.some((i) => i.code === "malformed")).toBe(true);
  });

  it("flags lorem ipsum and {{tokens}} and [INSERT]", () => {
    expect(inspectArtifact(`${GOOD}<p>Lorem ipsum dolor</p>`).some((i) => i.code === "placeholder")).toBe(true);
    expect(inspectArtifact(`${GOOD}<p>{{hero}}</p>`).some((i) => i.code === "placeholder")).toBe(true);
    expect(inspectArtifact(`${GOOD}<p>[INSERT NAME]</p>`).some((i) => i.code === "placeholder")).toBe(true);
  });

  it("does NOT flag the bare word placeholder in an input attr", () => {
    const issues = inspectArtifact(GOOD);
    expect(issues.find((i) => i.code === "placeholder")).toBeUndefined();
  });

  it("flags external image URLs (img + background) but not data/fonts", () => {
    expect(externalImageRefs(`<img src="https://cdn.x/p.png">`)).toHaveLength(1);
    expect(externalImageRefs(`<div style="background-image:url('http://x/y.jpg')">`)).toHaveLength(1);
    expect(externalImageRefs(`<img src="data:image/png;base64,AAA">`)).toHaveLength(0);
    expect(externalImageRefs(`<link href="https://fonts.googleapis.com/x">`)).toHaveLength(0);
  });

  it("flags a stub regression only on refine vs a large prior", () => {
    const prior = "x".repeat(5000);
    const tiny = GOOD; // far smaller than 5000 * 0.5
    expect(inspectArtifact(tiny, { isRefine: true, prior }).some((i) => i.code === "stub")).toBe(true);
    // not a refine → no stub check
    expect(inspectArtifact(tiny, { isRefine: false, prior }).some((i) => i.code === "stub")).toBe(false);
    // small prior → ignored
    expect(inspectArtifact(tiny, { isRefine: true, prior: "x".repeat(100) }).some((i) => i.code === "stub")).toBe(false);
  });
});

describe("buildRepairPrompt", () => {
  it("lists issues and embeds the current doc", () => {
    const issues = inspectArtifact(`<html>{{hero}}<img src="https://x/y.png"></html>`);
    const p = buildRepairPrompt(issues, "<html>…</html>");
    expect(p).toContain("must be fixed");
    expect(p).toContain("CURRENT DOCUMENT");
    expect(p).toContain("<html>…</html>");
    expect(summarizeIssues(issues)).toContain("placeholder");
  });
});

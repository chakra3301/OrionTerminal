import { describe, it, expect } from "vitest";
import {
  parseArtifacts,
  artifactLabel,
  isImageArtifact,
  splitArtifactBlock,
  pathSegment,
  ARTIFACT_MARKER,
} from "./ccArtifacts";

describe("ccArtifacts", () => {
  it("returns a single text segment when there are no artifacts", () => {
    expect(parseArtifacts("just a plain report")).toEqual([
      { type: "text", value: "just a plain report" },
    ]);
  });

  it("extracts an absolute project path as a reveal artifact", () => {
    const segs = parseArtifacts(
      "Built it at /Users/luca/projects/saas-landing and done.",
    );
    const path = segs.find((s) => s.type === "path");
    expect(path).toEqual({
      type: "path",
      value: "/Users/luca/projects/saas-landing",
      open: "reveal",
    });
  });

  it("treats html/png paths as openable files", () => {
    const segs = parseArtifacts("see /tmp/staging/index.html for the build");
    const p = segs.find((s) => s.type === "path");
    expect(p?.type === "path" && p.open).toBe("file");
  });

  it("extracts http(s) urls", () => {
    const segs = parseArtifacts("Dev server: http://localhost:5173 — open it");
    const url = segs.find((s) => s.type === "url");
    expect(url).toEqual({ type: "url", value: "http://localhost:5173" });
  });

  it("preserves surrounding text order", () => {
    const segs = parseArtifacts("a /Users/x/y.png b");
    expect(segs.map((s) => s.type)).toEqual(["text", "path", "text"]);
    expect(segs[0]).toEqual({ type: "text", value: "a " });
    expect(segs[2]).toEqual({ type: "text", value: " b" });
  });

  it("does not double-capture a path inside a localhost url", () => {
    const segs = parseArtifacts("http://localhost:5173/Users/fake/path");
    expect(segs.filter((s) => s.type === "path")).toHaveLength(0);
    expect(segs.filter((s) => s.type === "url")).toHaveLength(1);
  });

  it("flags image paths as renderable, non-images not", () => {
    const img = parseArtifacts("/Users/x/.previews/desktop.png").find(
      (s) => s.type === "path",
    )!;
    const dir = parseArtifacts("/Users/x/projects/site").find(
      (s) => s.type === "path",
    )!;
    expect(isImageArtifact(img)).toBe(true);
    expect(isImageArtifact(dir)).toBe(false);
    expect(isImageArtifact({ type: "url", value: "http://x.com/a.png" })).toBe(
      false,
    );
  });

  it("splits an auto-attached artifact block (paths may contain spaces)", () => {
    const body = `Done.\n\n${ARTIFACT_MARKER}\n/Users/x/Application Support/app/hero.html\n/Users/x/Application Support/app/.previews/d.png`;
    const { prose, artifacts } = splitArtifactBlock(body);
    expect(prose).toBe("Done.");
    expect(artifacts).toEqual([
      "/Users/x/Application Support/app/hero.html",
      "/Users/x/Application Support/app/.previews/d.png",
    ]);
  });

  it("no marker -> all prose, no artifacts", () => {
    expect(splitArtifactBlock("plain")).toEqual({
      prose: "plain",
      artifacts: [],
    });
  });

  it("pathSegment classifies image vs reveal even with spaces", () => {
    expect(pathSegment("/a b/x.png").open).toBe("file");
    expect(isImageArtifact(pathSegment("/a b/x.png"))).toBe(true);
    expect(pathSegment("/a b/proj").open).toBe("reveal");
  });

  it("labels paths by basename and urls by host", () => {
    expect(
      artifactLabel({
        type: "path",
        value: "/Users/x/saas-landing",
        open: "reveal",
      }),
    ).toBe("saas-landing");
    expect(artifactLabel({ type: "url", value: "http://localhost:5173" })).toBe(
      "localhost:5173",
    );
  });
});

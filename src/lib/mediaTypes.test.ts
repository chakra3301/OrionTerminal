import { describe, expect, it } from "vitest";
import { extensionOf, mediaTypeForPath } from "@/lib/mediaTypes";

describe("extensionOf", () => {
  it("extracts the lowercased extension from a basename", () => {
    expect(extensionOf("/a/b/logo.PNG")).toBe("png");
    expect(extensionOf("C:\\x\\clip.MP4")).toBe("mp4");
  });
  it("returns '' for dotfiles and extensionless names", () => {
    expect(extensionOf("/repo/.gitignore")).toBe("");
    expect(extensionOf("/repo/Makefile")).toBe("");
    expect(extensionOf("README")).toBe("");
  });
  it("is not fooled by dots in directory names", () => {
    expect(extensionOf("/my.assets/icon")).toBe("");
    expect(extensionOf("/my.assets/icon.svg")).toBe("svg");
  });
});

describe("mediaTypeForPath", () => {
  it("classifies images with the right mime", () => {
    expect(mediaTypeForPath("a.png")).toEqual({ kind: "image", mime: "image/png" });
    expect(mediaTypeForPath("a.JPG")).toEqual({ kind: "image", mime: "image/jpeg" });
    expect(mediaTypeForPath("icon.webp")).toEqual({ kind: "image", mime: "image/webp" });
  });
  it("leaves SVG as text (editable XML source), not an image", () => {
    expect(mediaTypeForPath("logo.svg")).toBeNull();
  });
  it("classifies video / audio / pdf", () => {
    expect(mediaTypeForPath("clip.mov")).toEqual({
      kind: "video",
      mime: "video/quicktime",
    });
    expect(mediaTypeForPath("song.mp3")).toEqual({ kind: "audio", mime: "audio/mpeg" });
    expect(mediaTypeForPath("doc.pdf")).toEqual({
      kind: "pdf",
      mime: "application/pdf",
    });
  });
  it("returns null for source/text files and unknown extensions", () => {
    expect(mediaTypeForPath("index.ts")).toBeNull();
    expect(mediaTypeForPath("notes.md")).toBeNull();
    expect(mediaTypeForPath("archive.zip")).toBeNull();
    expect(mediaTypeForPath("/repo/.gitignore")).toBeNull();
    expect(mediaTypeForPath("Makefile")).toBeNull();
  });
});

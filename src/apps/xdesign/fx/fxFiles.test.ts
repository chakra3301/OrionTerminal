import { describe, expect, it } from "vitest";
import { fxImagePaths, imageMimeForPath, isFxImagePath } from "./fxFiles";

describe("FX image files", () => {
  it("accepts the image formats the FX rasterizer supports", () => {
    expect(isFxImagePath("/Users/me/Desktop/photo.JPG")).toBe(true);
    expect(isFxImagePath("/tmp/art.avif?cache=1")).toBe(true);
    expect(isFxImagePath("/tmp/clip.mp4")).toBe(false);
  });

  it("filters Finder drops without changing their order", () => {
    expect(fxImagePaths(["/a/readme.txt", "/a/one.png", "/a/two.webp"])).toEqual([
      "/a/one.png",
      "/a/two.webp",
    ]);
  });

  it("maps local files to data URL media types", () => {
    expect(imageMimeForPath("photo.jpeg")).toBe("image/jpeg");
    expect(imageMimeForPath("art.webp")).toBe("image/webp");
    expect(imageMimeForPath("mask.png")).toBe("image/png");
  });
});

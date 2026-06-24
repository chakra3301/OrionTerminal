import { describe, expect, it } from "vitest";
import { pickVideoMime } from "./recordCanvas";

describe("pickVideoMime", () => {
  it("prefers mp4 when supported", () => {
    const r = pickVideoMime((m) => m.startsWith("video/mp4"));
    expect(r).toEqual({ mime: "video/mp4;codecs=h264", ext: "mp4" });
  });

  it("falls back to webm when only webm is supported", () => {
    const r = pickVideoMime((m) => m.startsWith("video/webm"));
    expect(r?.ext).toBe("webm");
  });

  it("returns null when nothing is supported", () => {
    expect(pickVideoMime(() => false)).toBeNull();
  });

  it("tolerates a thrower", () => {
    expect(pickVideoMime(() => { throw new Error("x"); })).toBeNull();
  });
});

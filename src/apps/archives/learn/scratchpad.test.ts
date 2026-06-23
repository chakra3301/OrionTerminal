import { describe, it, expect } from "vitest";
import { scratchpadToNote, clampPos } from "./scratchpad";

describe("scratchpadToNote", () => {
  it("titles the note after the topic and keeps lines as paragraphs", () => {
    const { title, blocks } = scratchpadToNote("Linux", "first line\nsecond line");
    expect(title).toBe("Linux — Notes");
    expect(blocks).toHaveLength(2);
    expect((blocks[0] as any).content[0].text).toBe("first line");
  });

  it("handles empty text and CRLF", () => {
    expect(scratchpadToNote("Chess", "   ").blocks).toEqual([]);
    expect(scratchpadToNote("Chess", "a\r\nb").blocks).toHaveLength(2);
  });

  it("falls back to a generic base when topic is blank", () => {
    expect(scratchpadToNote("", "x").title).toBe("Learning — Notes");
  });
});

describe("clampPos", () => {
  it("keeps the widget inside its container", () => {
    const size = { w: 300, h: 200 };
    const bounds = { w: 1000, h: 600 };
    expect(clampPos({ x: -50, y: -50 }, size, bounds)).toEqual({ x: 0, y: 0 });
    expect(clampPos({ x: 9999, y: 9999 }, size, bounds)).toEqual({ x: 700, y: 400 });
    expect(clampPos({ x: 100, y: 100 }, size, bounds)).toEqual({ x: 100, y: 100 });
  });

  it("clamps to 0 when the widget is larger than the container", () => {
    expect(clampPos({ x: 50, y: 50 }, { w: 500, h: 500 }, { w: 300, h: 300 })).toEqual({ x: 0, y: 0 });
  });
});

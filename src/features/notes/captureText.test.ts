import { describe, expect, it } from "vitest";
import { parseCapture } from "./captureText";

describe("parseCapture", () => {
  it("makes a one-liner the title with no body", () => {
    expect(parseCapture("buy milk")).toEqual({ title: "buy milk", blocks: [] });
  });

  it("trims surrounding whitespace", () => {
    expect(parseCapture("  hello  ")).toEqual({ title: "hello", blocks: [] });
  });

  it("empty capture falls back to a default title", () => {
    expect(parseCapture("   ")).toEqual({ title: "Quick note", blocks: [] });
  });

  it("keeps first line as title, rest as body paragraphs", () => {
    const { title, blocks } = parseCapture("Meeting notes\nfollow up with Sam\nship the thing");
    expect(title).toBe("Meeting notes");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "follow up with Sam" }],
    });
  });

  it("drops a blank line between title and body", () => {
    const { title, blocks } = parseCapture("Title\n\nbody line");
    expect(title).toBe("Title");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ content: [{ text: "body line" }] });
  });

  it("truncates an over-long title with an ellipsis", () => {
    const long = "x".repeat(200);
    expect(parseCapture(long).title).toBe(`${"x".repeat(120)}…`);
  });
});

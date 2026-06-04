import { describe, expect, it } from "vitest";
import { walkBlocksToPlaintext } from "./plaintext";

// Fixture mirrors the shape BlockNote emits via editor.document:
// blocks have type/props/content, content is an array of inline nodes
// (text + styles, link wrapping more inline content), code blocks store
// a string in content, list items nest children.
const FIXTURE = [
  {
    id: "h1",
    type: "heading",
    props: { level: 1 },
    content: [
      { type: "text", text: "Quarterly review", styles: { bold: true } },
    ],
    children: [],
  },
  {
    id: "p1",
    type: "paragraph",
    props: {},
    content: [
      { type: "text", text: "Shipping was ", styles: {} },
      { type: "text", text: "ahead of plan", styles: { italic: true } },
      { type: "text", text: ". See ", styles: {} },
      {
        type: "link",
        href: "https://example.com",
        content: [{ type: "text", text: "the dashboard", styles: {} }],
      },
      { type: "text", text: ".", styles: {} },
    ],
    children: [],
  },
  {
    id: "bl",
    type: "bulletListItem",
    props: {},
    content: [{ type: "text", text: "First bullet", styles: {} }],
    children: [
      {
        id: "bl-nested",
        type: "bulletListItem",
        props: {},
        content: [{ type: "text", text: "Nested bullet", styles: {} }],
        children: [],
      },
    ],
  },
  {
    id: "code",
    type: "codeBlock",
    props: { language: "ts" },
    content: "const x = 1;\nconst y = 2;",
    children: [],
  },
  {
    id: "empty",
    type: "paragraph",
    props: {},
    content: [],
    children: [],
  },
];

describe("walkBlocksToPlaintext", () => {
  it("returns empty string for non-array input", () => {
    expect(walkBlocksToPlaintext(null)).toBe("");
    expect(walkBlocksToPlaintext(undefined)).toBe("");
    expect(walkBlocksToPlaintext({})).toBe("");
  });

  it("flattens headings, paragraphs, lists, links, and code blocks", () => {
    const result = walkBlocksToPlaintext(FIXTURE);
    expect(result).toBe(
      [
        "Quarterly review",
        "Shipping was ahead of plan. See the dashboard.",
        "First bullet",
        "Nested bullet",
        "const x = 1;\nconst y = 2;",
      ].join("\n"),
    );
  });

  it("strips empty/whitespace-only blocks", () => {
    const doc = [
      { type: "paragraph", content: [] },
      { type: "paragraph", content: [{ type: "text", text: "   " }] },
      { type: "paragraph", content: [{ type: "text", text: "real content" }] },
    ];
    expect(walkBlocksToPlaintext(doc)).toBe("real content");
  });

  it("handles unknown block types by reading their content", () => {
    const doc = [
      {
        type: "callout",
        content: [{ type: "text", text: "still extracted" }],
      },
    ];
    expect(walkBlocksToPlaintext(doc)).toBe("still extracted");
  });

  it("returns empty string for an empty document", () => {
    expect(walkBlocksToPlaintext([])).toBe("");
  });

  it("preserves hard line break inline nodes between text runs", () => {
    const doc = [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "first line", styles: {} },
          { type: "hardBreak" },
          { type: "text", text: "second line", styles: {} },
        ],
      },
    ];
    expect(walkBlocksToPlaintext(doc)).toBe("first line\nsecond line");
  });

  it("ignores style metadata", () => {
    const doc = [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "bold text",
            styles: { bold: true, textColor: "red" },
          },
        ],
      },
    ];
    expect(walkBlocksToPlaintext(doc)).toBe("bold text");
  });
});

import { describe, expect, it } from "vitest";
import { extractNoteLinks, computeBacklinks, type LinkNote } from "./noteLinks";

function linkBlock(href: string, text = "link") {
  return { type: "paragraph", content: [{ type: "link", href, content: [{ type: "text", text }] }] };
}

describe("extractNoteLinks", () => {
  it("finds orion://note links in content", () => {
    expect(extractNoteLinks([linkBlock("orion://note/abc")])).toEqual(["abc"]);
  });
  it("ignores non-note links", () => {
    expect(extractNoteLinks([linkBlock("https://x.com"), linkBlock("orion://asset/z")])).toEqual([]);
  });
  it("dedupes + walks nested children", () => {
    const blocks = [
      { type: "x", content: [], children: [linkBlock("orion://note/a"), linkBlock("orion://note/a")] },
      linkBlock("orion://note/b"),
    ];
    expect(extractNoteLinks(blocks).sort()).toEqual(["a", "b"]);
  });
  it("handles empty/garbage input", () => {
    expect(extractNoteLinks(null)).toEqual([]);
    expect(extractNoteLinks([{ type: "p" }])).toEqual([]);
  });
});

describe("computeBacklinks", () => {
  const target = { id: "t", title: "Trip Plan" };
  const notes: LinkNote[] = [
    { id: "a", title: "A", plaintext: "see trip plan notes", blocks: [linkBlock("orion://note/t")] },
    { id: "b", title: "B", plaintext: "talking about the Trip Plan today", blocks: [] },
    { id: "c", title: "C", plaintext: "unrelated", blocks: [] },
    { id: "t", title: "Trip Plan", plaintext: "self", blocks: [] },
  ];

  it("separates linked vs unlinked mentions, excluding self", () => {
    const { linked, unlinked } = computeBacklinks(notes, target);
    expect(linked.map((n) => n.id)).toEqual(["a"]);
    expect(unlinked.map((n) => n.id)).toEqual(["b"]); // c=no mention, a=already linked, t=self
  });

  it("skips unlinked mentions for very short titles", () => {
    const { unlinked } = computeBacklinks(
      [{ id: "x", title: "x", plaintext: "go go go", blocks: [] }],
      { id: "t", title: "go" },
    );
    expect(unlinked).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  buildBrainGraph,
  neighborsOf,
  type BrainInputs,
  type BrainNoteInput,
} from "@/apps/archives/brain/graphBuild";

function note(over: Partial<BrainNoteInput> & { id: string }): BrainNoteInput {
  return {
    title: "",
    kind: "note",
    plaintext: "",
    blocks: [],
    parentId: null,
    collectionId: null,
    tags: [],
    updatedAt: 0,
    ...over,
  };
}

function inputs(over?: Partial<BrainInputs>): BrainInputs {
  return {
    notes: [],
    chats: [],
    assets: [],
    boards: [],
    boardMembers: new Map(),
    collections: [],
    vectors: [],
    ...over,
  };
}

/** Unit vector along one of two orthogonal axes — dot(u(0),u(0))=1,
 * dot(u(0),u(1))=0. `mix` blends between them for mid similarities. */
function vec(axis: 0 | 1, mix = 1): Float32Array {
  const v = new Float32Array(4);
  const other = axis === 0 ? 1 : 0;
  v[axis] = mix;
  v[other] = Math.sqrt(1 - mix * mix);
  return v;
}

const wikilinkBlocks = (targetId: string) => [
  {
    content: [{ type: "link", href: `orion://note/${targetId}`, content: [] }],
    children: [],
  },
];

describe("buildBrainGraph", () => {
  it("creates nodes for every entity kind", () => {
    const g = buildBrainGraph(
      inputs({
        notes: [
          note({ id: "n1", title: "Alpha" }),
          note({ id: "j1", title: "Day one", kind: "journal" }),
          note({ id: "p1", title: "Big project", kind: "project" }),
        ],
        chats: [{ id: "c1", title: "Chat", updatedAt: 1 }],
        assets: [{ id: "a1", title: "Pic", tags: ["moody"], createdAt: 1 }],
        boards: [{ id: "b1", title: "Board", updatedAt: 1 }],
        collections: [{ id: "col1", name: "Work" }],
      }),
    );
    const types = new Set(g.nodes.map((n) => n.type));
    expect(types).toEqual(
      new Set(["note", "journal", "project", "chat", "asset", "board", "tag", "collection"]),
    );
  });

  it("links wikilinks, parents, tags, collections, and board members", () => {
    const g = buildBrainGraph(
      inputs({
        notes: [
          note({ id: "n1", title: "Alpha", blocks: wikilinkBlocks("n2"), tags: ["idea"] }),
          note({ id: "n2", title: "Beta", parentId: "n1", collectionId: "col1" }),
        ],
        assets: [{ id: "a1", title: "Pic", tags: ["idea"], createdAt: 1 }],
        boards: [{ id: "b1", title: "Board", updatedAt: 1 }],
        boardMembers: new Map([["b1", ["a1"]]]),
        collections: [{ id: "col1", name: "Work" }],
      }),
    );
    const kinds = g.edges.map((e) => e.kind).sort();
    // n1↔n2 dedupes to one edge (wikilink wins over parent — added first).
    expect(kinds).toEqual(["board", "collection", "tag", "tag", "wikilink"]);
    // Shared #idea tag transitively connects the note and the asset.
    expect(neighborsOf(g, "tag:idea").sort()).toEqual(["asset:a1", "note:n1"]);
  });

  it("detects unlinked title mentions between notes", () => {
    const g = buildBrainGraph(
      inputs({
        notes: [
          note({ id: "n1", title: "Quantum", plaintext: "nothing here" }),
          note({ id: "n2", title: "Log", plaintext: "thinking about quantum stuff" }),
        ],
      }),
    );
    expect(g.edges).toEqual([
      { a: "note:n1", b: "note:n2", kind: "mention", weight: 1 },
    ]);
  });

  it("ignores short titles for mention scanning", () => {
    const g = buildBrainGraph(
      inputs({
        notes: [
          note({ id: "n1", title: "ab" }),
          note({ id: "n2", title: "x", plaintext: "ab ab ab" }),
        ],
      }),
    );
    expect(g.edges).toEqual([]);
  });

  it("adds semantic edges above the threshold only", () => {
    const g = buildBrainGraph(
      inputs({
        notes: [note({ id: "n1", title: "One" }), note({ id: "n2", title: "Two" })],
        chats: [{ id: "c1", title: "Chat", updatedAt: 1 }],
        vectors: [
          { kind: "note", id: "n1", vector: vec(0) },
          { kind: "note", id: "n2", vector: vec(0, 0.9) }, // dot = 0.9 → edge
          { kind: "chat", id: "c1", vector: vec(1) }, // orthogonal-ish → no edge to n1
        ],
      }),
      { semanticThreshold: 0.75 },
    );
    const semantic = g.edges.filter((e) => e.kind === "semantic");
    expect(semantic).toHaveLength(1);
    expect(semantic[0]!.a).toBe("note:n1");
    expect(semantic[0]!.b).toBe("note:n2");
    expect(semantic[0]!.weight).toBeCloseTo(0.9, 5);
  });

  it("never lets a semantic edge overwrite an explicit link", () => {
    const g = buildBrainGraph(
      inputs({
        notes: [
          note({ id: "n1", title: "One", blocks: wikilinkBlocks("n2") }),
          note({ id: "n2", title: "Two" }),
        ],
        vectors: [
          { kind: "note", id: "n1", vector: vec(0) },
          { kind: "note", id: "n2", vector: vec(0) },
        ],
      }),
    );
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]!.kind).toBe("wikilink");
  });

  it("skips vectors whose entity is not in the graph", () => {
    const g = buildBrainGraph(
      inputs({
        notes: [note({ id: "n1", title: "One" })],
        vectors: [
          { kind: "note", id: "n1", vector: vec(0) },
          { kind: "note", id: "ghost", vector: vec(0) },
        ],
      }),
    );
    expect(g.edges).toEqual([]);
  });

  it("computes degrees", () => {
    const g = buildBrainGraph(
      inputs({
        notes: [
          note({ id: "n1", title: "Hub", tags: ["a", "b"] }),
          note({ id: "n2", title: "Leaf", parentId: "n1" }),
        ],
      }),
    );
    const hub = g.nodes.find((n) => n.id === "note:n1")!;
    expect(hub.degree).toBe(3); // 2 tags + child
  });
});

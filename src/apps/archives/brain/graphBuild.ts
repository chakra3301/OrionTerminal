/** Brain graph builder (Archives → Brain). Pure — no stores, no DB — so the
 * whole linking model is unit-testable. Takes a snapshot of everything in
 * Orion Terminal (notes, chats, assets, boards, tags, collections, stored
 * embedding vectors) and produces a deduped node+edge set.
 *
 * Link sources, in order of confidence:
 *   wikilink   explicit orion://note links inside note bodies
 *   parent     note/project hierarchy (parentId)
 *   board      mood-board membership (board ↔ asset)
 *   collection note ↔ its collection
 *   tag        note/asset ↔ each of its tags
 *   mention    note A's plaintext contains note B's title (unlinked mention)
 *   semantic   cosine similarity between stored embeddings (the "automatic
 *              Obsidian" part — links notes/chats/assets nobody hand-wired)
 */
import { extractNoteLinks } from "@/features/notes/noteLinks";

export type BrainNodeType =
  | "note"
  | "journal"
  | "project"
  | "chat"
  | "asset"
  | "board"
  | "tag"
  | "collection";

export type BrainNode = {
  /** Graph id — `<type-bucket>:<entityId>` (tags use `tag:<name>`). */
  id: string;
  type: BrainNodeType;
  /** Underlying entity id (note id, chat id, tag name, …). */
  refId: string;
  label: string;
  updatedAt: number;
  /** Filled by buildBrainGraph — number of incident edges. */
  degree: number;
};

export type BrainEdgeKind =
  | "wikilink"
  | "parent"
  | "board"
  | "collection"
  | "tag"
  | "mention"
  | "semantic";

export type BrainEdge = {
  /** Node ids, ordered so a < b (canonical for dedupe). */
  a: string;
  b: string;
  kind: BrainEdgeKind;
  /** 0..1 — semantic edges carry their cosine score, others are 1. */
  weight: number;
};

export type BrainGraph = { nodes: BrainNode[]; edges: BrainEdge[] };

export type BrainNoteInput = {
  id: string;
  title: string;
  kind: "note" | "journal" | "project";
  plaintext: string;
  blocks: unknown;
  parentId: string | null;
  collectionId: string | null;
  tags: string[];
  updatedAt: number;
};

export type BrainInputs = {
  notes: BrainNoteInput[];
  chats: Array<{ id: string; title: string; updatedAt: number }>;
  assets: Array<{ id: string; title: string; tags: string[]; createdAt: number }>;
  boards: Array<{ id: string; title: string; updatedAt: number }>;
  /** boardId → member asset ids. */
  boardMembers: Map<string, string[]>;
  collections: Array<{ id: string; name: string }>;
  /** Stored embedding vectors (L2-normalized — cosine = dot product). */
  vectors: Array<{ kind: "note" | "chat" | "asset"; id: string; vector: Float32Array }>;
};

export type BrainOptions = {
  /** Min cosine similarity for an automatic semantic edge. */
  semanticThreshold?: number;
  /** Max semantic edges kept per node (best-first). */
  semanticTopK?: number;
  /** Skip the O(n²) unlinked-mention scan above this many notes. */
  mentionNoteCap?: number;
  /** Cap on vectors considered for semantic pairing (most recent first). */
  semanticVectorCap?: number;
};

const DEFAULTS: Required<BrainOptions> = {
  semanticThreshold: 0.55,
  semanticTopK: 3,
  mentionNoteCap: 1500,
  semanticVectorCap: 1200,
};

export function nodeIdFor(kind: "note" | "chat" | "asset", entityId: string): string {
  return `${kind}:${entityId}`;
}

function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

export function buildBrainGraph(
  inputs: BrainInputs,
  options?: BrainOptions,
): BrainGraph {
  const opt = { ...DEFAULTS, ...options };
  const nodes = new Map<string, BrainNode>();
  // key `${a}|${b}` (a<b) → edge. First (highest-confidence) kind wins;
  // semantic never overwrites an explicit edge.
  const edges = new Map<string, BrainEdge>();

  const addNode = (n: BrainNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const addEdge = (a: string, b: string, kind: BrainEdgeKind, weight = 1) => {
    if (a === b || !nodes.has(a) || !nodes.has(b)) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    const key = `${lo}|${hi}`;
    if (!edges.has(key)) edges.set(key, { a: lo, b: hi, kind, weight });
  };

  // ── Nodes ───────────────────────────────────────────────────────────
  const tagNames = new Set<string>();
  for (const n of inputs.notes) {
    addNode({
      id: nodeIdFor("note", n.id),
      type: n.kind,
      refId: n.id,
      label: n.title || "Untitled",
      updatedAt: n.updatedAt,
      degree: 0,
    });
    for (const t of n.tags) tagNames.add(t);
  }
  for (const c of inputs.chats) {
    addNode({
      id: nodeIdFor("chat", c.id),
      type: "chat",
      refId: c.id,
      label: c.title || "Untitled chat",
      updatedAt: c.updatedAt,
      degree: 0,
    });
  }
  for (const a of inputs.assets) {
    addNode({
      id: nodeIdFor("asset", a.id),
      type: "asset",
      refId: a.id,
      label: a.title || "Untitled",
      updatedAt: a.createdAt,
      degree: 0,
    });
    for (const t of a.tags) tagNames.add(t);
  }
  for (const b of inputs.boards) {
    addNode({
      id: `board:${b.id}`,
      type: "board",
      refId: b.id,
      label: b.title || "Untitled board",
      updatedAt: b.updatedAt,
      degree: 0,
    });
  }
  for (const c of inputs.collections) {
    addNode({
      id: `collection:${c.id}`,
      type: "collection",
      refId: c.id,
      label: c.name,
      updatedAt: 0,
      degree: 0,
    });
  }
  for (const t of tagNames) {
    addNode({ id: `tag:${t}`, type: "tag", refId: t, label: `#${t}`, updatedAt: 0, degree: 0 });
  }

  // ── Explicit edges ──────────────────────────────────────────────────
  for (const n of inputs.notes) {
    const self = nodeIdFor("note", n.id);
    for (const target of extractNoteLinks(n.blocks)) {
      addEdge(self, nodeIdFor("note", target), "wikilink");
    }
    if (n.parentId) addEdge(self, nodeIdFor("note", n.parentId), "parent");
    if (n.collectionId) addEdge(self, `collection:${n.collectionId}`, "collection");
    for (const t of n.tags) addEdge(self, `tag:${t}`, "tag");
  }
  for (const a of inputs.assets) {
    for (const t of a.tags) addEdge(nodeIdFor("asset", a.id), `tag:${t}`, "tag");
  }
  for (const [boardId, memberIds] of inputs.boardMembers) {
    for (const assetId of memberIds) {
      addEdge(`board:${boardId}`, nodeIdFor("asset", assetId), "board");
    }
  }

  // ── Unlinked mentions (note title appears in another note's text) ───
  if (inputs.notes.length <= opt.mentionNoteCap) {
    const lowered = inputs.notes.map((n) => ({
      id: n.id,
      text: (n.plaintext ?? "").toLowerCase(),
    }));
    for (const target of inputs.notes) {
      const title = target.title.trim().toLowerCase();
      if (title.length < 3) continue;
      for (const src of lowered) {
        if (src.id === target.id) continue;
        if (src.text.includes(title)) {
          addEdge(nodeIdFor("note", src.id), nodeIdFor("note", target.id), "mention");
        }
      }
    }
  }

  // ── Semantic edges (the automatic part) ─────────────────────────────
  // Vectors are L2-normalized so cosine = dot. Pairing is O(n²); above the
  // cap we keep only the most recently-updated entities so the scan stays
  // bounded (~1200² · 384 dims ≈ fast enough for a view open).
  let vecs = inputs.vectors.filter((v) => nodes.has(nodeIdFor(v.kind, v.id)));
  if (vecs.length > opt.semanticVectorCap) {
    vecs = [...vecs]
      .sort(
        (a, b) =>
          (nodes.get(nodeIdFor(b.kind, b.id))?.updatedAt ?? 0) -
          (nodes.get(nodeIdFor(a.kind, a.id))?.updatedAt ?? 0),
      )
      .slice(0, opt.semanticVectorCap);
  }
  if (vecs.length > 1) {
    type Cand = { j: number; score: number };
    const best: Cand[][] = vecs.map(() => []);
    for (let i = 0; i < vecs.length; i++) {
      for (let j = i + 1; j < vecs.length; j++) {
        const score = dot(vecs[i]!.vector, vecs[j]!.vector);
        if (score < opt.semanticThreshold) continue;
        best[i]!.push({ j, score });
        best[j]!.push({ j: i, score });
      }
    }
    for (let i = 0; i < vecs.length; i++) {
      const top = best[i]!.sort((x, y) => y.score - x.score).slice(0, opt.semanticTopK);
      for (const c of top) {
        addEdge(
          nodeIdFor(vecs[i]!.kind, vecs[i]!.id),
          nodeIdFor(vecs[c.j]!.kind, vecs[c.j]!.id),
          "semantic",
          c.score,
        );
      }
    }
  }

  // ── Degrees ─────────────────────────────────────────────────────────
  for (const e of edges.values()) {
    const na = nodes.get(e.a);
    const nb = nodes.get(e.b);
    if (na) na.degree++;
    if (nb) nb.degree++;
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Neighbor node ids of `nodeId`, best-connected first. */
export function neighborsOf(graph: BrainGraph, nodeId: string): string[] {
  const out: string[] = [];
  for (const e of graph.edges) {
    if (e.a === nodeId) out.push(e.b);
    else if (e.b === nodeId) out.push(e.a);
  }
  return out;
}

/** Knowledge-graph helpers (Phase 2.4): extract outgoing orion://note links
 * from a BlockNote document, and compute backlinks + unlinked mentions across
 * a note set. Pure — no store/DB — so it's unit-testable. */

const NOTE_URI = /^orion:\/\/note\/([^/?#]+)/;

type InlineLink = { type?: string; href?: string; content?: unknown };
type BlockLike = { content?: unknown; children?: unknown };

/** All note ids this document links to (deduped). Walks block content +
 * nested children for inline link items with an orion://note href. */
export function extractNoteLinks(blocks: unknown): string[] {
  const ids = new Set<string>();
  const visitInline = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const it of items as InlineLink[]) {
      if (it && it.type === "link" && typeof it.href === "string") {
        const m = it.href.match(NOTE_URI);
        if (m) ids.add(m[1]!);
      }
    }
  };
  const visitBlock = (b: BlockLike) => {
    if (!b || typeof b !== "object") return;
    visitInline(b.content);
    if (Array.isArray(b.children)) for (const c of b.children) visitBlock(c as BlockLike);
  };
  if (Array.isArray(blocks)) for (const b of blocks as BlockLike[]) visitBlock(b);
  return [...ids];
}

export type LinkNote = {
  id: string;
  title: string;
  plaintext: string;
  blocks: unknown;
};

export type Backlinks<T> = { linked: T[]; unlinked: T[] };

/** Split a note set into those that LINK to `target` (via orion://note) and
 * those that merely MENTION its title in plaintext (unlinked mentions). The
 * target itself is always excluded; a title shorter than 3 chars yields no
 * unlinked mentions (too noisy). */
export function computeBacklinks<T extends LinkNote>(
  notes: T[],
  target: { id: string; title: string },
): Backlinks<T> {
  const linked: T[] = [];
  const unlinked: T[] = [];
  const title = target.title.trim().toLowerCase();
  const linkedIds = new Set<string>();

  for (const n of notes) {
    if (n.id === target.id) continue;
    if (extractNoteLinks(n.blocks).includes(target.id)) {
      linked.push(n);
      linkedIds.add(n.id);
    }
  }
  if (title.length >= 3) {
    for (const n of notes) {
      if (n.id === target.id || linkedIds.has(n.id)) continue;
      if ((n.plaintext ?? "").toLowerCase().includes(title)) unlinked.push(n);
    }
  }
  return { linked, unlinked };
}

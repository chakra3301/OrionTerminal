import {
  getDb,
  searchArchive,
  type SearchHit,
  type NoteKind,
  type SearchEntityType,
} from "@/lib/db";
import { semanticSearch, type SemanticHit } from "@/lib/semanticSearch";

/** Minimum cosine score for a semantic-only hit to surface. The query
 * embedding is L2-normalized so this is a dot product; ~0.35 keeps loose
 * conceptual matches while filtering noise. */
const SEMANTIC_FLOOR = 0.35;

type EnrichRow = {
  id: string;
  entity_type: SearchEntityType;
  title: string;
  body_excerpt: string;
  note_kind: NoteKind | null;
};

/** Pull title + a short body excerpt for a batch of semantic-only hits so
 * they render with proper UI affordance alongside FTS5 results. Reads from
 * the canonical tables (notes / chats / assets) rather than search_index so
 * we get full plaintext (not just the FTS-tokenized columns). */
async function enrichSemanticHits(
  hits: SemanticHit[],
): Promise<Map<string, EnrichRow>> {
  if (hits.length === 0) return new Map();
  const db = await getDb();
  const byKind = new Map<SearchEntityType, string[]>();
  for (const h of hits) {
    const arr = byKind.get(h.kind) ?? [];
    arr.push(h.id);
    byKind.set(h.kind, arr);
  }
  const out = new Map<string, EnrichRow>();
  const noteIds = byKind.get("note") ?? [];
  if (noteIds.length > 0) {
    const placeholders = noteIds.map((_, i) => `$${i + 1}`).join(",");
    const rows = await db.select<
      Array<{
        id: string;
        title: string;
        plaintext: string;
        kind: NoteKind;
      }>
    >(
      `SELECT id, title, plaintext, kind
         FROM notes
        WHERE id IN (${placeholders})`,
      noteIds,
    );
    for (const r of rows) {
      out.set(`note:${r.id}`, {
        id: r.id,
        entity_type: "note",
        title: r.title || "Untitled",
        body_excerpt: (r.plaintext ?? "").slice(0, 160),
        note_kind: r.kind,
      });
    }
  }
  const chatIds = byKind.get("chat") ?? [];
  if (chatIds.length > 0) {
    const placeholders = chatIds.map((_, i) => `$${i + 1}`).join(",");
    const rows = await db.select<
      Array<{ id: string; title: string; searchable_text: string }>
    >(
      `SELECT id, title, searchable_text
         FROM chats
        WHERE id IN (${placeholders})`,
      chatIds,
    );
    for (const r of rows) {
      out.set(`chat:${r.id}`, {
        id: r.id,
        entity_type: "chat",
        title: r.title || "Untitled chat",
        body_excerpt: (r.searchable_text ?? "").slice(0, 160),
        note_kind: null,
      });
    }
  }
  const assetIds = byKind.get("asset") ?? [];
  if (assetIds.length > 0) {
    const placeholders = assetIds.map((_, i) => `$${i + 1}`).join(",");
    const rows = await db.select<
      Array<{ id: string; title: string | null; original_name: string }>
    >(
      `SELECT id, title, original_name
         FROM assets
        WHERE id IN (${placeholders})`,
      assetIds,
    );
    for (const r of rows) {
      out.set(`asset:${r.id}`, {
        id: r.id,
        entity_type: "asset",
        title: r.title || r.original_name || "Asset",
        body_excerpt: "",
        note_kind: null,
      });
    }
  }
  return out;
}

/** Run keyword (FTS5) + semantic searches in parallel, then merge: FTS hits
 * come first (keyword precision wins for exact-name queries), then any
 * semantic-only candidates that cleared the score floor. Caps at `limit`. */
export async function searchHybrid(
  query: string,
  limit = 20,
): Promise<SearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const [ftsHits, semHits] = await Promise.all([
    searchArchive(trimmed, limit),
    semanticSearch(trimmed, limit, SEMANTIC_FLOOR),
  ]);

  const seen = new Set<string>();
  const merged: SearchHit[] = [];
  for (const h of ftsHits) {
    const key = `${h.entityType}:${h.entityId}`;
    seen.add(key);
    merged.push(h);
  }
  if (merged.length >= limit) return merged.slice(0, limit);

  // Fill remaining slots with semantic-only hits, enriched with the same
  // shape the FTS path produces so UI rendering doesn't branch.
  const semOnly = semHits.filter(
    (h) => !seen.has(`${h.kind}:${h.id}`),
  );
  if (semOnly.length === 0) return merged;

  const enriched = await enrichSemanticHits(semOnly);
  for (const h of semOnly) {
    if (merged.length >= limit) break;
    const e = enriched.get(`${h.kind}:${h.id}`);
    if (!e) continue;
    merged.push({
      entityId: e.id,
      entityType: e.entity_type,
      title: e.title,
      snippet: e.body_excerpt,
      noteKind: e.note_kind,
    });
  }
  return merged;
}

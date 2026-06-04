import {
  listNotes,
  listAllChats,
  listAssets,
  listAllAssetTags,
  listEmbeddingHashes,
  upsertEmbedding,
  deleteEmbedding,
  type NoteRow,
  type ChatRow,
  type AssetRow,
  type EmbeddingKind,
} from "@/lib/db";
import {
  embed,
  hashText,
  serializeVector,
  warmEmbeddings,
} from "@/lib/embeddings";
import { invalidateSemanticCache } from "@/lib/semanticSearch";
import { log } from "@/lib/log";

type IndexTask = {
  kind: EmbeddingKind;
  id: string;
  text: string;
};

function noteText(n: NoteRow): string {
  return `${n.title || "Untitled"}\n${n.plaintext || ""}`.trim();
}

function chatText(c: ChatRow): string {
  return `${c.title || "Untitled chat"}\n${c.searchable_text || ""}`.trim();
}

function assetText(a: AssetRow, tags: string[]): string {
  return [a.title ?? "", a.original_name ?? "", ...tags]
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Walk every indexable entity, hash its current text, compare against the
 * stored embedding hash, and re-embed when the text has changed (or no row
 * exists yet). Runs serially with a small per-item delay so the WebView's
 * main thread stays responsive — the model occupies ~30ms per text and we
 * don't want to lock up scroll while backfilling. */
export async function runEmbeddingBackfill(): Promise<{
  embedded: number;
  skipped: number;
}> {
  let embedded = 0;
  let skipped = 0;
  try {
    const [notes, chats, assets, assetTagMap, hashes] = await Promise.all([
      listNotes(),
      listAllChats(500),
      listAssets(2000),
      listAllAssetTags(),
      listEmbeddingHashes(),
    ]);

    const tasks: IndexTask[] = [
      ...notes.map((n) => ({
        kind: "note" as const,
        id: n.id,
        text: noteText(n),
      })),
      ...chats.map((c) => ({
        kind: "chat" as const,
        id: c.id,
        text: chatText(c),
      })),
      ...assets.map((a) => ({
        kind: "asset" as const,
        id: a.id,
        text: assetText(a, assetTagMap.get(a.id) ?? []),
      })),
    ].filter((t) => t.text.length > 0);

    if (tasks.length === 0) return { embedded: 0, skipped: 0 };

    // Warm the model first. If it fails (e.g., offline), skip the whole
    // pass — the search layer falls back to FTS5 cleanly.
    await warmEmbeddings();

    for (const t of tasks) {
      const key = `${t.kind}:${t.id}`;
      const currentHash = await hashText(t.text);
      if (hashes.get(key) === currentHash) {
        skipped++;
        continue;
      }
      const vec = await embed(t.text);
      if (!vec) {
        // Model load failed mid-pass; bail out — try again next boot.
        break;
      }
      await upsertEmbedding(
        t.kind,
        t.id,
        serializeVector(vec),
        currentHash,
      );
      embedded++;
      // Yield to keep the UI responsive.
      await new Promise((r) => setTimeout(r, 0));
    }

    if (embedded > 0) {
      invalidateSemanticCache();
      log.info(`embedding indexer: embedded ${embedded}, skipped ${skipped}`);
    }
  } catch (err) {
    log.warn("embedding backfill failed", err);
  }
  return { embedded, skipped };
}

/** Re-embed a single entity right after it changes (note save, chat
 * exchange, asset ingest). Hashes the text first so a no-op save doesn't
 * trigger a model run. */
export async function reindexEntity(
  kind: EmbeddingKind,
  id: string,
  text: string,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    const hash = await hashText(trimmed);
    const hashes = await listEmbeddingHashes();
    if (hashes.get(`${kind}:${id}`) === hash) return;
    const vec = await embed(trimmed);
    if (!vec) return;
    await upsertEmbedding(kind, id, serializeVector(vec), hash);
    invalidateSemanticCache();
  } catch (err) {
    log.warn("reindex failed", err);
  }
}

/** Drop an entity's embedding row when its source is deleted. Cheap no-op
 * if no row exists. */
export async function removeEntityEmbedding(
  kind: EmbeddingKind,
  id: string,
): Promise<void> {
  try {
    await deleteEmbedding(kind, id);
    invalidateSemanticCache();
  } catch (err) {
    log.warn("remove embedding failed", err);
  }
}

// Per-(kind:id) debounce. Multiple writes within the same window collapse
// into a single embed pass that reads the freshest text via the resolver.
const REINDEX_DEBOUNCE_MS = 2000;
const reindexTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Schedule a reindex for an entity. The `getText` resolver is invoked when
 * the timer fires, so the embedded text always reflects the freshest state
 * (not whatever the caller had at scheduling time). Safe to call on every
 * keystroke. */
export function scheduleReindex(
  kind: EmbeddingKind,
  id: string,
  getText: () => string | null,
): void {
  const key = `${kind}:${id}`;
  const existing = reindexTimers.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    reindexTimers.delete(key);
    const text = getText();
    if (text == null) return;
    void reindexEntity(kind, id, text);
  }, REINDEX_DEBOUNCE_MS);
  reindexTimers.set(key, t);
}

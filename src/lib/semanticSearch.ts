import {
  embed,
  cosineSimilarity,
  deserializeVector,
} from "@/lib/embeddings";
import {
  listEmbeddings,
  type EmbeddingKind,
  type StoredEmbedding,
} from "@/lib/db";
import { log } from "@/lib/log";

/** In-memory cache of every embedding row, parsed once and reused across
 * searches. Invalidated whenever the indexer upserts something so subsequent
 * queries see fresh vectors. */
type CachedVector = {
  kind: EmbeddingKind;
  id: string;
  vector: Float32Array;
};

let cache: CachedVector[] | null = null;
let cachePromise: Promise<CachedVector[]> | null = null;

function parseRows(rows: StoredEmbedding[]): CachedVector[] {
  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    vector: deserializeVector(r.vector),
  }));
}

async function loadCache(): Promise<CachedVector[]> {
  if (cache) return cache;
  if (cachePromise) return cachePromise;
  cachePromise = (async () => {
    const rows = await listEmbeddings();
    const parsed = parseRows(rows);
    cache = parsed;
    cachePromise = null;
    return parsed;
  })();
  return cachePromise;
}

/** Drop the in-memory cache. The indexer calls this after a batch of
 * upserts so the next query reads fresh data. */
export function invalidateSemanticCache(): void {
  cache = null;
  cachePromise = null;
}

export type SemanticHit = {
  kind: EmbeddingKind;
  id: string;
  score: number;
};

/** Embed the query, rank every stored vector by cosine similarity, return
 * the top-K. Vectors are already L2-normalized so cosine = dot product.
 * Returns an empty list (not an error) when the model fails to load — the
 * caller falls back to FTS5 in that case. */
export async function semanticSearch(
  query: string,
  limit = 12,
  threshold = 0.2,
): Promise<SemanticHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  try {
    const [queryVec, vectors] = await Promise.all([
      embed(trimmed),
      loadCache(),
    ]);
    if (!queryVec || vectors.length === 0) return [];
    const scored: SemanticHit[] = [];
    for (const v of vectors) {
      const score = cosineSimilarity(queryVec, v.vector);
      if (score >= threshold) {
        scored.push({ kind: v.kind, id: v.id, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  } catch (err) {
    log.warn("semantic search failed", err);
    return [];
  }
}

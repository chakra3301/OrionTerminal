// Pure client-side BM25 ranker — powers "Similar repos". Ported from store/search.js.
// Scores saved repo payloads against a "<language> <category>"-style query.

const STOP = new Set(["", "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with", "is"]);

/** Lowercase, split on non-word chars (keep +#. for c++/c#/node.js), drop stopwords. */
export function tokens(s: unknown): string[] {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t && !STOP.has(t));
}

export type SearchRow = {
  repoId: string;
  category?: string;
  capabilities?: string[];
  tags?: string[];
  language?: string;
  eli5?: string;
};

const FIELD_WEIGHTS: [keyof SearchRow, number][] = [
  ["category", 3],
  ["capabilities", 3],
  ["tags", 3],
  ["language", 2],
  ["repoId", 2],
  ["eli5", 1],
];
const K1 = 1.5;
const B = 0.75;

function docTokens(r: SearchRow): string[] {
  const bag: string[] = [];
  for (const [field, weight] of FIELD_WEIGHTS) {
    const v = r[field];
    const raw = Array.isArray(v) ? v.join(" ") : v;
    const toks = tokens(raw);
    for (let i = 0; i < weight; i++) bag.push(...toks);
  }
  return bag;
}

export function rankRepos(
  rows: SearchRow[],
  query: string,
  { excludeId = null, topK = 3 }: { excludeId?: string | null; topK?: number } = {},
): SearchRow[] {
  const qTerms = [...new Set(tokens(query))];
  if (!qTerms.length) return [];

  const docs: { r: SearchRow; tf: Map<string, number>; len: number }[] = [];
  for (const r of rows) {
    if (!r || !r.repoId) continue;
    if (excludeId && r.repoId === excludeId) continue;
    const bag = docTokens(r);
    const tf = new Map<string, number>();
    for (const t of bag) tf.set(t, (tf.get(t) || 0) + 1);
    docs.push({ r, tf, len: bag.length });
  }
  if (!docs.length) return [];

  const N = docs.length;
  const avgdl = docs.reduce((sum, d) => sum + d.len, 0) / N || 1;

  const df = new Map<string, number>();
  for (const t of qTerms) {
    let count = 0;
    for (const d of docs) if (d.tf.has(t)) count++;
    df.set(t, count);
  }

  const scored: { r: SearchRow; score: number }[] = [];
  for (const d of docs) {
    let score = 0;
    for (const t of qTerms) {
      const f = d.tf.get(t) || 0;
      if (!f) continue;
      const dft = df.get(t) || 0;
      const idf = Math.log(1 + (N - dft + 0.5) / (dft + 0.5));
      score += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * d.len) / avgdl));
    }
    if (score > 0) scored.push({ r: d.r, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.r);
}

type LibRow = {
  repo_id: string;
  analysis: {
    category?: string;
    capabilities?: string[];
    tags?: string[];
    language?: string;
    eli5?: string;
  };
};

/** Library repos closest to the open repo, by language + category + capability tokens. */
export function findSimilar(
  center: { repoId: string; language?: string; category?: string },
  library: LibRow[],
  topK = 5,
): SearchRow[] {
  const rows: SearchRow[] = library.map((r) => ({
    repoId: r.repo_id,
    category: r.analysis.category,
    capabilities: r.analysis.capabilities,
    tags: r.analysis.tags,
    language: r.analysis.language,
    eli5: r.analysis.eli5,
  }));
  const query = `${center.language ?? ""} ${center.category ?? ""}`;
  return rankRepos(rows, query, { excludeId: center.repoId, topK });
}

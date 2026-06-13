// Combinator — fuse 2–3 repos into one new project idea. Two parts: a pure
// ranking engine (which combos are worth proposing) ported from combinator.js,
// and the synthesis prompt/parser ported from combinator-prompt.js. The ranking
// scores combos by adjacency (coherent) × disjointness (novel) × layer spread.

import { layerOf, layersAdjacent } from "./taxonomy";

export type ComboRow = { repoId: string; name?: string; capabilities?: string[]; eli5?: string };
export type Candidate = {
  repoIds: string[];
  rows: ComboRow[];
  score: number;
  adjacency: number;
  disjointness: number;
  spread: number;
};

function layersOf(caps?: string[]): Set<string> {
  return new Set((caps || []).map(layerOf));
}

function pairAdjacent(a: ComboRow, b: ComboRow): boolean {
  const la = layersOf(a.capabilities),
    lb = layersOf(b.capabilities);
  if (!la.size || !lb.size) return false;
  for (const x of la) for (const y of lb) if (layersAdjacent(x, y)) return true;
  return false;
}

function disjointness(combo: ComboRow[]): number {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const r of combo)
    for (const t of r.capabilities || []) {
      counts[t] = (counts[t] || 0) + 1;
      total++;
    }
  if (!total) return 0;
  const shared = Object.values(counts)
    .filter((c) => c > 1)
    .reduce((s, c) => s + c, 0);
  return 1 - shared / total;
}

function adjacency(combo: ComboRow[]): number {
  let pairs = 0,
    adj = 0;
  for (let i = 0; i < combo.length; i++)
    for (let j = i + 1; j < combo.length; j++) {
      pairs++;
      if (pairAdjacent(combo[i]!, combo[j]!)) adj++;
    }
  return pairs ? adj / pairs : 0;
}

function distinctLayers(combo: ComboRow[]): number {
  const set = new Set<string>();
  for (const r of combo) for (const t of r.capabilities || []) set.add(layerOf(t));
  return set.size;
}

function spread(combo: ComboRow[]): number {
  return combo.length ? distinctLayers(combo) / combo.length : 0;
}

export function scoreCombo(combo: ComboRow[], wildness = 0) {
  const a = adjacency(combo),
    d = disjointness(combo),
    s = spread(combo);
  const coherence = (1 - wildness) * a + wildness * (1 - a);
  return { score: coherence * d * s, adjacency: a, disjointness: d, spread: s };
}

export function diversifyTopK(
  ranked: Candidate[],
  { seed = null, topK = 6, penalty = 0.7 }: { seed?: string | null; topK?: number; penalty?: number } = {},
): Candidate[] {
  const pool = ranked.slice();
  const picked: Candidate[] = [];
  const used = new Set<string>();
  while (picked.length < topK && pool.length) {
    let bestIdx = 0,
      bestAdj = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const others = pool[i]!.repoIds.filter((r) => r !== seed);
      const reused = others.length ? others.filter((r) => used.has(r)).length / others.length : 0;
      const adj = pool[i]!.score * (1 - penalty * reused);
      if (adj > bestAdj) {
        bestAdj = adj;
        bestIdx = i;
      }
    }
    const [chosen] = pool.splice(bestIdx, 1);
    picked.push(chosen!);
    for (const r of chosen!.repoIds) if (r !== seed) used.add(r);
  }
  return picked;
}

function combosOf<T>(arr: T[], k: number): T[][] {
  const res: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) {
      res.push(acc.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      acc.push(arr[i]!);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return res;
}

export function combineCandidates(
  rows: ComboRow[],
  {
    seed = null,
    sizes = [2, 3],
    wildness = 0,
    topK = 6,
  }: { seed?: string | null; sizes?: number[]; wildness?: number; topK?: number } = {},
): Candidate[] {
  const byId = new Map(rows.map((r) => [r.repoId, r]));
  const seedRow = seed ? byId.get(seed) : null;
  if (seed && !seedRow) return [];
  const pool = rows.filter((r) => r.repoId !== seed);

  const out: Candidate[] = [];
  const seen = new Set<string>();
  const extraSizes = seed ? sizes.map((s) => s - 1) : sizes;
  for (const k of extraSizes) {
    if (k < 1) continue;
    for (const c of combosOf(pool, k)) {
      const combo = seed ? [seedRow!, ...c] : c;
      const key = combo
        .map((r) => r.repoId)
        .slice()
        .sort()
        .join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const sc = scoreCombo(combo, wildness);
      out.push({ repoIds: combo.map((r) => r.repoId), rows: combo, ...sc });
    }
  }
  out.sort(
    (x, y) =>
      y.score - x.score ||
      y.disjointness - x.disjointness ||
      x.repoIds.join().localeCompare(y.repoIds.join()),
  );
  return diversifyTopK(out, { seed, topK });
}

// ─── synthesis (combinator-prompt.js) ───────────────────────────────────────

export function buildCombinatorPrompt(repos: ComboRow[]): string {
  const block = repos
    .map((r) => `- ${r.repoId} [${(r.capabilities || []).join(", ")}]: ${r.eli5 || ""}`)
    .join("\n");

  return `Invent ONE concrete project that fuses these repositories into something none of them is alone. Be specific and buildable — name what each one actually contributes. Reward genuine novelty, but stay grounded: it should be something a capable team could start this week.

${block}

Return ONLY a valid JSON object. No markdown fences, no explanation — raw JSON only.
{
  "title": "Short, memorable product name.",
  "pitch": "One vivid sentence: what you'd build and why this combination is new.",
  "contributions": [ { "repoId": "owner/name", "role": "What this repo provides in the combo." } ],
  "novelty": 0,
  "feasibility": 0,
  "first_step": "The single most concrete first thing to build."
}`;
}

export type CombinatorResult = {
  title: string;
  pitch: string;
  contributions: { repoId: string; role: string }[];
  novelty: number;
  feasibility: number;
  first_step: string;
};

export function parseCombinator(rawText: string, inputRepoIds: string[] = []): CombinatorResult {
  const text = String(rawText).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{"),
    end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in combinator response");
  const data: any = JSON.parse(text.slice(start, end + 1));
  const clamp = (n: unknown) => Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  const idset = new Set(inputRepoIds);
  return {
    title: String(data.title ?? ""),
    pitch: String(data.pitch ?? ""),
    contributions: Array.isArray(data.contributions)
      ? data.contributions
          .filter((c: any) => c && idset.has(c.repoId))
          .map((c: any) => ({ repoId: c.repoId, role: String(c.role ?? "") }))
      : [],
    novelty: clamp(data.novelty),
    feasibility: clamp(data.feasibility),
    first_step: String(data.first_step ?? ""),
  };
}

/** Concept extraction for the blueprint visualizer. Pure + local (no AI,
 * no DB) so it can run on every keystroke debounce: pulls the significant
 * terms out of what you're writing — frequency-scored, proper-noun-boosted,
 * recency-weighted so the drawing follows where the text is going — plus
 * sentence-level co-occurrence links between them. */

export type Concept = {
  term: string;
  /** 0..1 — normalized prominence (frequency · entity boost · recency). */
  weight: number;
  /** True when the term appears near the end of the text (being written now). */
  recent: boolean;
};

export type ConceptLink = { a: string; b: string; strength: number };

export type ConceptMap = { concepts: Concept[]; links: ConceptLink[] };

const STOPWORDS = new Set(
  (
    "the a an and or but if then else when while for nor so yet of in on at to from by with about into over after " +
    "under again further once here there all any both each few more most other some such only own same than too very " +
    "can will just should now this that these those i me my we our you your he him his she her it its they them their " +
    "what which who whom is are was were be been being have has had having do does did doing would could ought im ive " +
    "id youre youve theyre weve isnt arent wasnt dont doesnt didnt not no also get got like one two how why out up down " +
    "off because as until against between through during before above below again really thing things going want wanted " +
    "make made need needs lot bit still even much many able way today yesterday tomorrow"
  ).split(/\s+/),
);

type TermStat = {
  term: string;
  count: number;
  entity: boolean;
  lastPos: number; // 0..1 position of last occurrence
};

/** Tokenize one sentence into terms, merging runs of capitalized words into
 * a single entity ("Orion Terminal"). Returns lowercase terms + entity flag. */
function termsOfSentence(sentence: string): Array<{ term: string; entity: boolean }> {
  const raw = sentence.match(/[A-Za-z][A-Za-z'-]*|\d{4}/g) ?? [];
  const out: Array<{ term: string; entity: boolean }> = [];
  let i = 0;
  while (i < raw.length) {
    const w = raw[i]!;
    const isCap = /^[A-Z]/.test(w) && i > 0; // sentence-initial caps don't count
    if (isCap) {
      // Merge consecutive capitalized words into one entity.
      let j = i;
      const parts: string[] = [];
      while (j < raw.length && /^[A-Z]/.test(raw[j]!)) {
        parts.push(raw[j]!);
        j++;
      }
      const joined = parts.join(" ").toLowerCase();
      if (!STOPWORDS.has(joined) && joined.length >= 3) {
        out.push({ term: joined, entity: true });
      }
      i = j;
      continue;
    }
    const lower = w.toLowerCase();
    if (lower.length >= 3 && !STOPWORDS.has(lower)) {
      out.push({ term: lower, entity: false });
    }
    i++;
  }
  return out;
}

export function extractConcepts(text: string, maxConcepts = 12): ConceptMap {
  const trimmed = text.trim();
  if (trimmed.length < 8) return { concepts: [], links: [] };

  const sentences = trimmed
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (sentences.length === 0) return { concepts: [], links: [] };

  const stats = new Map<string, TermStat>();
  const sentenceTerms: string[][] = [];
  const total = sentences.length;

  sentences.forEach((sentence, si) => {
    const pos = total <= 1 ? 1 : si / (total - 1);
    const terms = termsOfSentence(sentence);
    const seen: string[] = [];
    for (const { term, entity } of terms) {
      const stat = stats.get(term);
      if (stat) {
        stat.count++;
        stat.entity = stat.entity || entity;
        stat.lastPos = pos;
      } else {
        stats.set(term, { term, count: 1, entity, lastPos: pos });
      }
      if (!seen.includes(term)) seen.push(term);
    }
    sentenceTerms.push(seen);
  });

  // Score: frequency (log-damped) · entity boost · recency tilt.
  const scored = [...stats.values()]
    .map((s) => ({
      stat: s,
      score:
        (1 + Math.log2(s.count)) *
        (s.entity ? 1.7 : 1) *
        (0.7 + 0.3 * s.lastPos),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxConcepts);
  if (scored.length === 0) return { concepts: [], links: [] };

  const maxScore = scored[0]!.score;
  const picked = new Set(scored.map((s) => s.stat.term));
  const concepts: Concept[] = scored.map((s) => ({
    term: s.stat.term,
    weight: s.score / maxScore,
    recent: s.stat.lastPos >= 0.85,
  }));

  // Sentence co-occurrence links between picked terms.
  const linkCounts = new Map<string, number>();
  for (const terms of sentenceTerms) {
    const present = terms.filter((t) => picked.has(t));
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const a = present[i]!;
        const b = present[j]!;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
      }
    }
  }
  let maxLink = 0;
  for (const c of linkCounts.values()) maxLink = Math.max(maxLink, c);
  const links: ConceptLink[] = [...linkCounts.entries()].map(([key, count]) => {
    const [a, b] = key.split("|") as [string, string];
    return { a, b, strength: maxLink > 0 ? count / maxLink : 0 };
  });

  return { concepts, links };
}

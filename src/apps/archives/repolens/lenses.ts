// Lens prompt builders + parsers, ported from deepdive.js / sktpg.js /
// synergies.js. Source fetching (the file tree + key files) is done in Rust
// (repolens_fetch_source); these builders take the already-fetched RepoSource.

import { TAXONOMY, normalizeCapabilities } from "./taxonomy";
import type { RepoData, RepoSource, DeepDive, Sktpg, Synergies, Versus } from "./types";

/** Extract the first JSON object from a model response (tolerates code fences). */
export function extractJsonObject(rawText: string): any {
  let text = (rawText || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object found in response");
  return JSON.parse(text.slice(start, end + 1));
}

// ─── Deep Dive ────────────────────────────────────────────────────────────────

/** A compact "measured facts" block; '' when no runner facts (always null here). */
export function factsBlock(facts: any): string {
  if (!facts) return "";
  const langs = (facts.languages || []).slice(0, 6).map((l: any) => `${l.name} ${l.code}`).join(", ");
  const dep = (k: string) => (facts.dependencies && facts.dependencies[k]) || [];
  const depLine = ["npm", "cargo", "pip", "go"]
    .filter((k) => dep(k).length)
    .map((k) => `${k}: ${dep(k).slice(0, 12).join(", ")}`)
    .join("; ");
  const lines = [
    `- ${facts.fileCount} files. LOC by language: ${langs || "—"}.`,
    `- Manifests: ${(facts.manifests || []).join(", ") || "none"}.${depLine ? ` Direct deps — ${depLine}.` : ""}`,
    `- Tests: ${facts.tests && facts.tests.present ? "present" : "none detected"}. CI: ${
      facts.ci && facts.ci.present ? (facts.ci.files || []).join(", ") : "none detected"
    }.`,
  ];
  return `\nMEASURED FACTS (from a real checkout via the runner — ground truth; prefer these over inference):\n${lines.join(
    "\n",
  )}\n`;
}

export function buildAtomsPrompt(repoData: RepoData, source: RepoSource, facts: any): string {
  const treeBlock = source.tree.length
    ? `File tree (truncated):\n${source.tree.join("\n")}`
    : "(no file tree available — work from the README + description)";
  const filesBlock = source.files.length
    ? source.files.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n")
    : "(no source files available)";

  return `You are reverse-engineering a software repository into its ATOMIC SEMANTIC UNITS — the smallest set of self-contained concepts/subsystems that, taken together, explain how the project works.

Repository: ${repoData.repo_id}
Description: ${repoData.description || "—"}
Language: ${repoData.language || "Unknown"}

${treeBlock}

Key source files:
${filesBlock}
${factsBlock(facts)}
Decompose the project into 5–10 atomic units. For each, give a stable short id (kebab-case), a human name, a kind, a one-sentence purpose, and the files/paths it lives in.

Return ONLY valid JSON, no markdown fences:
{
  "atoms": [
    { "id": "kebab-id", "name": "Human Name", "kind": "subsystem|module|concept|entrypoint|data", "purpose": "One sentence on what it does and why it exists.", "files": ["path/one", "path/two"] }
  ]
}`;
}

export function parseAtoms(rawText: string): { atoms: DeepDive["atoms"] } {
  const data = extractJsonObject(rawText);
  const atoms = Array.isArray(data.atoms) ? data.atoms : [];
  return {
    atoms: atoms.map((a: any, i: number) => ({
      id: a.id || `atom-${i + 1}`,
      name: a.name || a.id || `Unit ${i + 1}`,
      kind: a.kind || "module",
      purpose: a.purpose || "",
      files: Array.isArray(a.files) ? a.files : [],
    })),
  };
}

export function buildLineagePrompt(atoms: DeepDive["atoms"]): string {
  const list = atoms.map((a) => `- ${a.id}: ${a.name} — ${a.purpose}`).join("\n");
  return `Given these atomic units of a software project, map the CAUSAL LINEAGE between them — the directed cause→effect / dependency relationships.

Atomic units:
${list}

For every meaningful relationship, emit a directed link using the unit ids above. Identify the "roots" (foundational units everything traces back to) and "leaves" (user-facing outcomes that depend on the rest).

Return ONLY valid JSON, no markdown fences:
{
  "links": [ { "from": "id", "to": "id", "relation": "depends-on|enables|triggers|derives-from", "why": "One clause explaining the link." } ],
  "roots": ["id"],
  "leaves": ["id"]
}`;
}

export function parseLineage(rawText: string): DeepDive["lineage"] {
  const data = extractJsonObject(rawText);
  const links = Array.isArray(data.links) ? data.links : [];
  return {
    links: links
      .filter((l: any) => l && l.from && l.to)
      .map((l: any) => ({ from: l.from, to: l.to, relation: l.relation || "depends-on", why: l.why || "" })),
    roots: Array.isArray(data.roots) ? data.roots : [],
    leaves: Array.isArray(data.leaves) ? data.leaves : [],
  };
}

export function buildFeynmanPrompt(
  repoData: RepoData,
  atoms: DeepDive["atoms"],
  lineage: DeepDive["lineage"],
): string {
  const atomList = atoms.map((a) => `- ${a.name}: ${a.purpose}`).join("\n");
  const linkList = lineage.links.map((l) => `- ${l.from} ${l.relation} ${l.to} (${l.why})`).join("\n");
  return `Apply the FEYNMAN PROTOCOL to validate an understanding of ${repoData.repo_id}.

Atomic units:
${atomList}

Causal lineage:
${linkList}

Do four things:
1. explanation — explain the whole project from scratch in plain language a smart beginner would follow (3–5 sentences). No jargon left unexplained.
2. gaps — list the points where this explanation is weakest or where the model lacks evidence.
3. assumptions — list claims that are inferred rather than directly verified from the source.
4. questions — 3 self-test questions (with answers) a reader could use to check their own understanding.
Then rate confidence per major claim.

Return ONLY valid JSON, no markdown fences:
{
  "explanation": "Plain-language explanation.",
  "gaps": ["..."],
  "assumptions": ["..."],
  "questions": [ { "q": "Question?", "a": "Answer." } ],
  "confidence": [ { "claim": "...", "level": "high|medium|low", "note": "Why." } ]
}`;
}

export function parseFeynman(rawText: string): DeepDive["feynman"] {
  const data = extractJsonObject(rawText);
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  return {
    explanation: data.explanation || "",
    gaps: arr(data.gaps),
    assumptions: arr(data.assumptions),
    questions: arr(data.questions).map((q: any) => ({ q: q.q || "", a: q.a || "" })),
    confidence: arr(data.confidence).map((c: any) => ({
      claim: c.claim || "",
      level: c.level || "medium",
      note: c.note || "",
    })),
  };
}

// ─── SKTPG ("Skate Where The Puck Is Going") ────────────────────────────────

export const SKTPG_BANDS = ["Noise", "Interesting", "Watchlist", "Actionable", "Urgent"];

function sourceContext(repoData: RepoData, source: RepoSource): string {
  const tree = source?.tree?.length
    ? `File tree (truncated):\n${source.tree.join("\n")}`
    : "(no file tree — work from the README + description)";
  const files = source?.files?.length
    ? source.files.map((f) => `=== ${f.path} ===\n${f.content}`).join("\n\n")
    : "(no source files available)";
  return `Repository: ${repoData.repo_id}
Description: ${repoData.description || "—"}
Language: ${repoData.language || "Unknown"}

${tree}

Key source files:
${files}`;
}

export function buildSktpgPrompt(repoData: RepoData, source: RepoSource): string {
  return `${sourceContext(repoData, source)}

Apply the SKTPG protocol ("Skate Where The Puck Is Going") to this repository. Do NOT summarize what it is — answer what it is BECOMING, what it forces next, what that unlocks, and what to do before the market sees it.

Reason through this chain: outside-view base rate → weak signals → hype vs real motion → bottleneck shift → 6–18 month forecast → what becomes obvious later → action map → pre-mortem (argue the bear case as hard as the bull case) → tracking signals → thesis.

Rules:
- Outside view FIRST: anchor on how often things of this reference class actually pan out; the default prior is usually low. Signals adjust the prior, they don't override a bad base rate.
- Classify evidence as one of: Confirmed, Likely, Speculative, Contradicted, Unknown.
- The pre-mortem must bite: list real kill-paths. If 2+ high-likelihood kill-paths are unaddressed, cap the score.
- Use directional language ("the evidence suggests…", "this becomes interesting if…"), never "this will definitely / guaranteed / the future".
- Score 0–100 and assign a band: Noise (0–20), Interesting (21–40), Watchlist (41–60), Actionable (61–80), Urgent (81–100).

Return ONLY valid JSON, no markdown fences:
{
  "thesis": { "becoming": "This is becoming…", "forced_next": "The forced next move is…", "opportunity": "The non-obvious opportunity is…", "before_consensus": "The thing to do before consensus is…", "wrong_if": "The forecast is wrong if…" },
  "score": { "value": 0, "band": "Noise|Interesting|Watchlist|Actionable|Urgent" },
  "base_rate": { "reference_class": "The honest comparison set.", "rate": "e.g. ~15% become what the bull case claims", "cause_of_death": "How things in this class normally die.", "prior": "low|moderate|high", "evidence": "Confirmed|Likely|Speculative|Contradicted|Unknown" },
  "weak_signals": [ { "signal": "…", "why": "Why it matters.", "evidence": "Likely", "forces_next": "What it may force." } ],
  "hype_vs_motion": [ { "claim": "A narrative claim.", "verdict": "Hype|Motion|Mixed", "evidence": "Why." } ],
  "bottleneck": { "current": "The bottleneck limiting adoption now.", "weakening": "What's weakening it.", "next": "The next bottleneck if it succeeds.", "who_profits": "Who profits from solving that next one." },
  "forecast": { "base": "Base case.", "bull": "Bull case.", "bear": "Bear case.", "wildcard": "The surprising event that changes the trajectory." },
  "becomes_obvious": ["What becomes obvious 6–18 months out that's non-obvious today."],
  "actions": [ { "action": "…", "timeframe": "24h|7d|30d|pre-consensus", "why_now": "Why now." } ],
  "premortem": [ { "kill_path": "A concrete failure mechanism.", "likelihood": "low|moderate|high", "survives": false } ],
  "tracking": [ { "signal": "What to watch.", "flag": "green|yellow|red", "why": "Why it matters." } ]
}`;
}

const SKTPG_EVIDENCE = new Set(["Confirmed", "Likely", "Speculative", "Contradicted", "Unknown"]);
const SKTPG_FLAGS = new Set(["green", "yellow", "red"]);
const sktpgEvidence = (v: any) => (SKTPG_EVIDENCE.has(v) ? v : "Unknown");

export function parseSktpg(rawText: string): Sktpg {
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const obj = (v: any) => (v && typeof v === "object" ? v : {});
  const d = extractJsonObject(rawText);
  const t = obj(d.thesis),
    s = obj(d.score),
    b = obj(d.base_rate),
    bn = obj(d.bottleneck),
    fc = obj(d.forecast);
  let value = Number(s.value);
  if (!Number.isFinite(value)) value = 0;
  value = Math.max(0, Math.min(100, Math.round(value)));
  const band = SKTPG_BANDS.includes(s.band) ? s.band : SKTPG_BANDS[Math.min(4, Math.floor(value / 20.0001))]!;

  return {
    thesis: {
      becoming: t.becoming || "",
      forced_next: t.forced_next || "",
      opportunity: t.opportunity || "",
      before_consensus: t.before_consensus || "",
      wrong_if: t.wrong_if || "",
    },
    score: { value, band },
    base_rate: {
      reference_class: b.reference_class || "",
      rate: b.rate || "",
      cause_of_death: b.cause_of_death || "",
      prior: b.prior || "low",
      evidence: sktpgEvidence(b.evidence),
    },
    weak_signals: arr(d.weak_signals).map((w: any) => ({
      signal: w.signal || "",
      why: w.why || "",
      evidence: sktpgEvidence(w.evidence),
      forces_next: w.forces_next || "",
    })),
    hype_vs_motion: arr(d.hype_vs_motion).map((h: any) => ({
      claim: h.claim || "",
      verdict: h.verdict || "Mixed",
      evidence: h.evidence || "",
    })),
    bottleneck: {
      current: bn.current || "",
      weakening: bn.weakening || "",
      next: bn.next || "",
      who_profits: bn.who_profits || "",
    },
    forecast: { base: fc.base || "", bull: fc.bull || "", bear: fc.bear || "", wildcard: fc.wildcard || "" },
    becomes_obvious: arr(d.becomes_obvious).map(String),
    actions: arr(d.actions).map((a: any) => ({
      action: a.action || "",
      timeframe: a.timeframe || "",
      why_now: a.why_now || "",
    })),
    premortem: arr(d.premortem).map((p: any) => ({
      kill_path: p.kill_path || "",
      likelihood: p.likelihood || "moderate",
      survives: p.survives === true,
    })),
    tracking: arr(d.tracking).map((t2: any) => ({
      signal: t2.signal || "",
      flag: SKTPG_FLAGS.has(t2.flag) ? t2.flag : "yellow",
      why: t2.why || "",
    })),
  };
}

// ─── Synergies (complementary repos, grounded in the saved library) ─────────

type SynergyTarget = {
  repoId: string;
  eli5?: string;
  description?: string;
  category?: string;
  language?: string;
};
type SynergyCandidate = { repoId: string; category?: string; eli5?: string };

export function buildSynergiesPrompt(repoData: SynergyTarget, candidates: SynergyCandidate[]): string {
  const lib = candidates.length
    ? candidates.map((c) => `- ${c.repoId}${c.category ? ` (${c.category})` : ""}: ${c.eli5 || ""}`).join("\n")
    : "(the user has not saved many repos yet)";

  return `Find COMPLEMENTARY repositories that work WELL TOGETHER with ${repoData.repoId} — tools you'd reach for ALONGSIDE it, not alternatives that replace it.

Target repo: ${repoData.repoId}
What it is: ${repoData.eli5 || repoData.description || "—"}
Category: ${repoData.category || "?"} · Language: ${repoData.language || "?"}

Repos already in the user's saved library (prefer these where they genuinely pair):
${lib}

Identify 4–8 synergies. For each: the repo (use a library repoId when it fits, otherwise suggest a well-known complementary tool), its role/category, how it pairs with the target (the synergy — what the combination unlocks), and whether it's already in the user's library.

Return ONLY valid JSON, no markdown fences:
{
  "synergies": [
    { "repoId": "owner/name or tool name", "category": "e.g. State management", "synergy": "How they pair and what the combo unlocks.", "in_library": true }
  ]
}`;
}

export function parseSynergies(rawText: string): Synergies {
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const d = extractJsonObject(rawText);
  return {
    synergies: arr(d.synergies).map((s: any) => ({
      repoId: s.repoId || "",
      category: s.category || "",
      synergy: s.synergy || "",
      in_library: s.in_library === true,
    })),
  };
}

// ─── Versus (head-to-head comparison of two repos) ──────────────────────────

export function buildVersusPrompt(a: RepoData, b: RepoData): string {
  const block = (r: RepoData) => `${r.repo_id}
Description: ${r.description || "—"} · Language: ${r.language || "Unknown"} · Stars: ${r.stars ?? "?"}
README (excerpt):
${(r.readme || "(none)").slice(0, 2000)}`;

  return `Compare these two repositories HEAD-TO-HEAD for a developer deciding between them. Be honest and specific — no "it depends" cop-outs.

=== Repo A ===
${block(a)}

=== Repo B ===
${block(b)}

Compare across 4–6 decision dimensions (e.g. maturity, ecosystem, performance, learning curve, flexibility, ideal fit). For each dimension give A's position, B's position, and who wins it (a / b / tie). Then say when to pick each, and a final verdict that names the single deciding factor.

Return ONLY valid JSON, no markdown fences:
{
  "summary_a": "One line characterizing A.",
  "summary_b": "One line characterizing B.",
  "dimensions": [ { "label": "Maturity", "a": "A's position.", "b": "B's position.", "winner": "a|b|tie" } ],
  "pick_a_when": ["A concrete reason to choose A."],
  "pick_b_when": ["A concrete reason to choose B."],
  "verdict": "Overall recommendation and the deciding factor."
}`;
}

export function parseVersus(rawText: string): Omit<Versus, "target"> {
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const d = extractJsonObject(rawText);
  return {
    summary_a: d.summary_a || "",
    summary_b: d.summary_b || "",
    dimensions: arr(d.dimensions).map((x: any) => ({
      label: x.label || "",
      a: x.a || "",
      b: x.b || "",
      winner: (["a", "b", "tie"].includes(x.winner) ? x.winner : "tie") as "a" | "b" | "tie",
    })),
    pick_a_when: arr(d.pick_a_when).map(String),
    pick_b_when: arr(d.pick_b_when).map(String),
    verdict: d.verdict || "",
  };
}

// ─── Re-tag (backfill capability tags from the controlled taxonomy) ─────────

export function buildTagPrompt(meta: {
  repoId?: string;
  category?: string;
  eli5?: string;
  compare_hooks?: string;
}): string {
  const tagList = Object.values(TAXONOMY).flat().join(", ");
  return `Tag what this software project DOES with 2–5 capability labels chosen ONLY from this list (use the closest fits, "other" if none apply): ${tagList}.

Project: ${meta.repoId || ""}
Category: ${meta.category || "—"}
What it is: ${meta.eli5 || meta.compare_hooks || "—"}

Return ONLY a JSON object, no prose: { "capabilities": ["tag", "tag"] }`;
}

export function parseTags(rawText: string): string[] {
  const text = String(rawText).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{"),
    end = text.lastIndexOf("}");
  let data: any = {};
  if (start !== -1 && end !== -1) {
    try {
      data = JSON.parse(text.slice(start, end + 1));
    } catch {
      data = {};
    }
  }
  return normalizeCapabilities(data.capabilities);
}

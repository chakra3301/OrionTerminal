// Lens prompt builders + parsers, ported from deepdive.js / sktpg.js /
// synergies.js. Source fetching (the file tree + key files) is done in Rust
// (repolens_fetch_source); these builders take the already-fetched RepoSource.

import type { RepoData, RepoSource, DeepDive } from "./types";

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

// (SKTPG + Synergies appended in later phases.)

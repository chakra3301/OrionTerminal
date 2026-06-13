// Framework lenses — apply a structured thinking framework to the repo.
// Three groups (Systems / Ideate / Prioritize), 10 frameworks. Ported verbatim
// from systems.js / ideate.js / heuristics.js. Each is one AI call; results are
// parsed generically (the prompts vary in shape) and rendered by FrameworkPanel.

import { extractJsonObject } from "./lenses";
import type { RepoData, RepoSource } from "./types";

export type Framework = { key: string; label: string; blurb: string };
export type FrameworkGroup = { group: string; label: string; frameworks: Framework[] };

export const FRAMEWORK_GROUPS: FrameworkGroup[] = [
  {
    group: "systems",
    label: "Systems",
    frameworks: [
      { key: "toc", label: "Theory of Constraints", blurb: "Find & break the single bottleneck." },
      { key: "loops", label: "Feedback Loops", blurb: "Reinforcing vs balancing loops." },
      { key: "pdca", label: "PDCA", blurb: "Plan · Do · Check · Act cycle." },
      { key: "dmaic", label: "DMAIC", blurb: "Define · Measure · Analyze · Improve · Control." },
    ],
  },
  {
    group: "ideate",
    label: "Ideate",
    frameworks: [
      { key: "triz", label: "TRIZ", blurb: "Resolve a contradiction with inventive principles." },
      { key: "scamper", label: "SCAMPER", blurb: "Substitute · Combine · Adapt · Modify · Put · Eliminate · Reverse." },
      { key: "lateral", label: "Lateral Thinking", blurb: "A random provocation → a radical angle." },
      { key: "morph", label: "Morphological", blurb: "Cross every variable to find novel combos." },
    ],
  },
  {
    group: "prioritize",
    label: "Prioritize",
    frameworks: [
      { key: "pareto", label: "Pareto (80/20)", blurb: "The 20% causing 80% of the friction." },
      { key: "eisenhower", label: "Eisenhower Matrix", blurb: "Urgent × Important — do, plan, delegate, drop." },
    ],
  },
];

export const ALL_FRAMEWORKS: Framework[] = FRAMEWORK_GROUPS.flatMap((g) => g.frameworks);
export function frameworkLabel(key: string): string {
  return ALL_FRAMEWORKS.find((f) => f.key === key)?.label ?? key;
}
export function isFrameworkKey(key: string): boolean {
  return ALL_FRAMEWORKS.some((f) => f.key === key);
}

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

const FRAMEWORK_PROMPTS: Record<string, (ctx: string) => string> = {
  toc: (ctx) => `${ctx}

Apply the THEORY OF CONSTRAINTS: a system moves only as fast as its slowest part. Identify the SINGLE biggest bottleneck constraining this project (performance, architecture, or process), how to ruthlessly exploit/optimize it, and what becomes the NEXT constraint once it is resolved.

Return ONLY valid JSON, no markdown fences:
{
  "bottleneck": { "name": "The one constraint", "why": "Why it limits the whole system." },
  "exploit": ["Concrete action to relieve the constraint."],
  "next_bottleneck": { "name": "What constrains next", "why": "Why it surfaces once the first is fixed." }
}`,

  loops: (ctx) => `${ctx}

Apply SYSTEMS THINKING: map the feedback loops in this project. Reinforcing loops drive growth or collapse; balancing loops are self-stabilizing. Each loop is a cycle of 2–5 nodes that returns to its start.

Return ONLY valid JSON, no markdown fences:
{
  "loops": [
    { "type": "reinforcing", "name": "Loop name", "cycle": ["Node A", "Node B", "Node C"], "effect": "What this loop does to the system over time." }
  ]
}`,

  pdca: (ctx) => `${ctx}

Apply PDCA (the Deming cycle) to this project's continuous improvement. Describe how the project iterates — or should — across the four phases.

Return ONLY valid JSON, no markdown fences:
{
  "plan": "What gets planned each cycle (goals, hypotheses).",
  "do": "How changes are implemented / shipped.",
  "check": "How outcomes are measured and verified.",
  "act": "How learnings are standardized or rolled back."
}`,

  dmaic: (ctx) => `${ctx}

Apply DMAIC (Six Sigma) to reduce variance and defects in this project's workflow.

Return ONLY valid JSON, no markdown fences:
{
  "define": "The core goal / problem to improve.",
  "measure": ["A concrete, trackable metric."],
  "analyze": "The main sources of variance or defects.",
  "improve": ["A concrete improvement action."],
  "control": ["A mechanism to hold the gains."]
}`,

  triz: (ctx) => `${ctx}

You are inventing improvements for this project using TRIZ (Theory of Inventive Problem Solving). Identify a core engineering CONTRADICTION (something that gets worse when you improve something else, e.g. "richer analysis vs. speed"), then apply 2–4 of the 40 TRIZ inventive principles to resolve it WITHOUT compromise, and state the resulting invention.

Return ONLY valid JSON, no markdown fences:
{
  "contradiction": { "improving": "What we want to improve.", "worsening": "What that normally makes worse." },
  "principles": [ { "number": 15, "name": "Dynamics", "application": "How this principle applies here." } ],
  "idea": "The resolved inventive concept."
}`,

  scamper: (ctx) => `${ctx}

Apply SCAMPER to invent new features for this project. Give one concrete, specific idea for each of the seven lenses.

Return ONLY valid JSON, no markdown fences:
{
  "items": [
    { "lens": "Substitute", "idea": "..." },
    { "lens": "Combine", "idea": "..." },
    { "lens": "Adapt", "idea": "..." },
    { "lens": "Modify", "idea": "..." },
    { "lens": "Put to another use", "idea": "..." },
    { "lens": "Eliminate", "idea": "..." },
    { "lens": "Reverse", "idea": "..." }
  ]
}`,

  lateral: (ctx) => `${ctx}

Apply LATERAL THINKING (Edward de Bono). Introduce a deliberately RANDOM, unrelated provocation, make the lateral leap from it to this project, and propose 2–3 radical features or approaches that a straight logical analysis would never reach.

Return ONLY valid JSON, no markdown fences:
{
  "provocation": "A random, unrelated provocation.",
  "leap": "How that provocation reframes the project.",
  "ideas": ["A radical idea it unlocks."]
}`,

  morph: (ctx) => `${ctx}

Apply MORPHOLOGICAL ANALYSIS. Break this project's design space into 2–4 variables (axes), give each 2–4 options, then surface 2–3 NOVEL combinations that no one would naturally pick, with the concept each yields.

Return ONLY valid JSON, no markdown fences:
{
  "dimensions": [ { "axis": "Variable name", "options": ["option a", "option b"] } ],
  "combinations": [ { "picks": ["option per axis, in order"], "concept": "The novel solution this combo produces." } ]
}`,

  pareto: (ctx) => `${ctx}

Apply the PARETO PRINCIPLE (80/20) to this project. Identify the roughly 20% of factors — modules, dependencies, decisions, or issues — responsible for roughly 80% of the friction, risk, or value. Rank that vital few, and say what the long-tail 80% is that can safely be deprioritized.

Return ONLY valid JSON, no markdown fences:
{
  "vital_few": [ { "factor": "The high-leverage factor.", "impact": "The ~80% outcome it drives.", "share": "e.g. ~50% of the complexity" } ],
  "trivial_many": "What the remaining ~80% of factors are, and why they can wait."
}`,

  eisenhower: (ctx) => `${ctx}

Apply the EISENHOWER MATRIX to the work facing anyone building on or maintaining this project. Sort concrete tasks/concerns into four quadrants by Urgency and Importance. Remember: many urgent things are not important, and the most important work (architecture, hardening) is rarely urgent.

Return ONLY valid JSON, no markdown fences:
{
  "do": ["Important AND urgent — do now."],
  "schedule": ["Important, NOT urgent — plan it in."],
  "delegate": ["Urgent, NOT important — delegate or automate."],
  "eliminate": ["Neither — drop it."]
}`,
};

export function buildFrameworkPrompt(key: string, repoData: RepoData, source: RepoSource): string {
  const build = FRAMEWORK_PROMPTS[key] ?? FRAMEWORK_PROMPTS.toc!;
  return build(sourceContext(repoData, source));
}

/** Frameworks return varied shapes; parse generically and let the panel render it. */
export function parseFramework(rawText: string): Record<string, unknown> {
  const d = extractJsonObject(rawText);
  return d && typeof d === "object" ? d : {};
}

import type { Provider, Skill } from "./agentTypes";
import { MODELS } from "@/lib/models";

export const BUILTIN_PROVIDER: Provider = {
  id: "builtin:anthropic",
  name: "Anthropic (Claude)",
  kind: "anthropic",
  baseUrl: "",
  models: MODELS.map((m) => ({ id: m.id, label: m.label })),
  keyRef: "",
  enabled: true,
  builtin: true,
};

export const STARTER_SKILLS: Skill[] = [
  { id: "builtin:web-research", name: "Web Research", icon: "", accent: "#00e0ff", instructions: "Search the web for primary, current sources. Prefer official docs and firsthand reports over summaries.", tools: [{ kind: "builtin", name: "WebSearch" }], builtin: true },
  { id: "builtin:cite-sources", name: "Cite Sources", icon: "", accent: "#00e0ff", instructions: "Back every non-obvious claim with a citation. Use [n] markers and list sources at the end.", tools: [], builtin: true },
  { id: "builtin:code-reviewer", name: "Code Reviewer", icon: "", accent: "#39ff88", instructions: "Review code for correctness, edge cases, and security. Report only high-confidence issues, most important first.", tools: [{ kind: "builtin", name: "Read" }, { kind: "builtin", name: "Grep" }, { kind: "builtin", name: "Glob" }], builtin: true },
  { id: "builtin:summarizer", name: "Summarizer", icon: "", accent: "#b14cff", instructions: "Produce tight, faithful summaries. Lead with the conclusion, then the few facts that support it. No filler.", tools: [], builtin: true },
  { id: "builtin:data-analyst", name: "Data Analyst", icon: "", accent: "#e6ff3a", instructions: "Reason quantitatively. Show the steps, state assumptions explicitly, and sanity-check results.", tools: [{ kind: "builtin", name: "Bash" }, { kind: "builtin", name: "Read" }], builtin: true },
  { id: "builtin:note-taker", name: "Note-Taker", icon: "", accent: "#39ff88", instructions: "Capture decisions, action items, and open questions as clean structured notes.", tools: [], builtin: true },
];

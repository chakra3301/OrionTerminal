// Tone — the voice the AI writes the analysis in. A setting injected as a
// preamble into every analysis prompt (core + all lenses). Affects prose
// wording only; the requested JSON shape is unchanged. Ported from tone.js.

export const DEFAULT_TONE = "neutral";

export const TONES: { key: string; label: string; blurb: string }[] = [
  { key: "neutral", label: "Default", blurb: "Clear and balanced — no special voice." },
  { key: "director", label: "Authoritative", blurb: "Firm, structured, confident — The Director." },
  { key: "catalyst", label: "Enthusiastic", blurb: "High energy, contagious — The Catalyst." },
  { key: "guide", label: "Socratic", blurb: "Curious, question-led — The Guide." },
  { key: "nurturer", label: "Empathetic", blurb: "Warm, patient, supportive — The Nurturer." },
  { key: "copilot", label: "Facilitative", blurb: "Casual, collaborative — The Co-Pilot." },
];

export function isTone(key: string): boolean {
  return TONES.some((t) => t.key === key);
}

const DIRECTIVES: Record<string, string> = {
  director:
    "an authoritative Director — firm, clear and structured. State things as confident, non-negotiable facts in direct, declarative sentences. No hedging.",
  catalyst:
    "an enthusiastic Catalyst — high-energy and genuinely excited about the material. Use vivid, dynamic language that pulls the reader in.",
  guide:
    "a Socratic Guide — curious and investigative. Frame insights as lines of inquiry, pose probing questions, and invite the reader to reason it through rather than handing down verdicts.",
  nurturer:
    "an empathetic Nurturer — warm, patient and supportive. Acknowledge difficulty, reassure, and break things down gently.",
  copilot:
    "a Facilitative Co-Pilot — casual and collaborative, like talking it through with a colleague over coffee. Use an easygoing, peer-to-peer register.",
};

/** Preamble injected ahead of an analysis prompt to set the writing voice. */
export function tonePreamble(toneKey: string): string {
  const d = DIRECTIVES[toneKey];
  if (!d) return ""; // neutral / unknown → no voice instruction
  return `Voice & tone: write ALL explanatory prose as ${d} Apply this to the wording only — keep the required JSON structure, keys and formatting exactly as specified.\n\n`;
}

/** Prepend the tone preamble to a built prompt. */
export function withTone(toneKey: string, prompt: string): string {
  return tonePreamble(toneKey) + prompt;
}

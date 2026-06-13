import { ipc } from "@/lib/ipc";

/** Inline AI actions for the note editor (BlockNote). Subscription CLI, same
 * as the rest of Archives AI. Prompt builders are pure + tested; the runners
 * live in the editor components where they touch the BlockNote document. */

export type SelectionAction = "improve" | "fix" | "shorter" | "longer" | "summarize";

const SELECTION_INSTRUCTIONS: Record<SelectionAction, string> = {
  improve: "Improve the clarity and flow of this text. Keep its meaning and roughly its length.",
  fix: "Fix spelling, grammar, and punctuation. Change nothing else.",
  shorter: "Make this more concise while keeping the key points.",
  longer: "Expand this with more useful detail.",
  summarize: "Summarize this in one or two sentences.",
};

export const SELECTION_ACTION_LABELS: Record<SelectionAction, string> = {
  improve: "Improve writing",
  fix: "Fix spelling & grammar",
  shorter: "Make shorter",
  longer: "Make longer",
  summarize: "Summarize",
};

export function buildSelectionPrompt(action: SelectionAction, text: string): string {
  return `${SELECTION_INSTRUCTIONS[action]} Output ONLY the resulting text — no preamble, no quotes, no markdown fences.\n\n${text}`;
}

export function buildContinuePrompt(precedingText: string): string {
  return [
    "Continue writing this note naturally from where it leaves off. Match the voice and tone. Do NOT repeat the existing text. Output ONLY the continuation (a sentence or two).",
    "",
    precedingText.slice(-2000),
  ].join("\n");
}

export function buildSummarizeNotePrompt(noteText: string): string {
  return [
    "Summarize this note as 2-4 short bullet points. Output ONLY the bullets, one per line, each starting with '- '. No preamble.",
    "",
    noteText.slice(0, 6000),
  ].join("\n");
}

/** Strip a stray surrounding code fence / wrapping quotes the model may add
 * despite instructions, so replacements stay clean. */
export function cleanAiText(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  if (fence) s = fence[1]!.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s.trim();
}

export async function runOneshot(prompt: string): Promise<string> {
  const reply = await ipc.claudeOneshot(prompt);
  return cleanAiText(reply);
}

/** Parse "- bullet" lines from a summarize reply into plain strings. */
export function parseBullets(reply: string): string[] {
  return cleanAiText(reply)
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 6);
}

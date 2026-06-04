/** Wake-word trigger phrases + matcher. Pure — no audio/store deps — so it
 * can be unit-tested and reused. Whisper transcribes "Rosie" inconsistently,
 * so we accept common phonetic spellings; "jarvis" is a thematic alias. */
export const TRIGGERS = [
  "hey rosie",
  "okay rosie",
  "ok rosie",
  "hey rosy",
  "rosie",
  "rosy",
  "rosey",
  "rozy",
  "jarvis",
];

/** If `text` opens with a trigger phrase, return the remainder (the command
 * after the wake word); otherwise null. Lowercases + strips leading
 * non-letters first ("Core," / "...rosie" etc. Whisper sometimes emits). */
export function matchTrigger(text: string): { remainder: string } | null {
  const normalized = text.toLowerCase().replace(/^[^a-z]+/i, "");
  for (const trig of TRIGGERS) {
    if (normalized.startsWith(trig)) {
      const rest = normalized.slice(trig.length).replace(/^[\s,.:;!?-]+/, "");
      return { remainder: rest };
    }
  }
  return null;
}

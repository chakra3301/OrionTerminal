import type { NoteBlocks } from "@/store/notesStore";

const TITLE_MAX = 120;

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text, styles: {} }] };
}

/** Turn raw quick-capture text into a note title + BlockNote body. A single
 * line becomes the title with no body (Notion-style one-liner); multi-line
 * text keeps the first line as the title and the rest as paragraphs, so
 * nothing is duplicated. */
export function parseCapture(raw: string): { title: string; blocks: NoteBlocks } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return { title: "Quick note", blocks: [] };

  const lines = text.split("\n");
  const first = lines[0]!.trim();
  const title = first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX)}…` : first;

  const rest = lines.slice(1);
  // Drop a leading blank line between title and body, keep internal structure.
  while (rest.length && rest[0]!.trim() === "") rest.shift();
  if (rest.length === 0) return { title, blocks: [] };

  const blocks: NoteBlocks = rest.map((l) => paragraph(l));
  return { title, blocks };
}

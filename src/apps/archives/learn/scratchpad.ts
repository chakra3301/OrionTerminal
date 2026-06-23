// Pure helpers for the Learn scratchpad widget — note-building + drag clamping.
import type { NoteBlocks } from "@/store/notesStore";

const TITLE_MAX = 120;

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text, styles: {} }] };
}

/**
 * Turn raw scratchpad text into an Archives note (title + BlockNote body),
 * titled after the topic being studied so it's findable later.
 */
export function scratchpadToNote(topicTitle: string, raw: string): { title: string; blocks: NoteBlocks } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  const base = topicTitle.trim() || "Learning";
  const title = (`${base} — Notes`).slice(0, TITLE_MAX);
  if (!text) return { title, blocks: [] };
  const blocks: NoteBlocks = text.split("\n").map((l) => paragraph(l));
  return { title, blocks };
}

/** Clamp a widget position so it stays fully inside its container. */
export function clampPos(
  pos: { x: number; y: number },
  size: { w: number; h: number },
  bounds: { w: number; h: number },
): { x: number; y: number } {
  const maxX = Math.max(0, bounds.w - size.w);
  const maxY = Math.max(0, bounds.h - size.h);
  return {
    x: Math.min(Math.max(0, pos.x), maxX),
    y: Math.min(Math.max(0, pos.y), maxY),
  };
}

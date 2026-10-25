/** Inputs that take typed text and own their own ⌘Z. Range, colour, checkbox
 * and buttons keep focus after a drag/click but have no text undo, so they
 * must not swallow the shortcut. */
const TEXT_INPUT = /^(text|number|search|email|url|tel|password|date|time|datetime-local|month|week)$/;

/** Maps a keydown to an FX history action, or null when it is not ours:
 * wrong chord, or focus is somewhere that has its own undo (text fields,
 * selects, contenteditable, the Monaco shader editor). */
export function fxHistoryShortcut(e: KeyboardEvent): "undo" | "redo" | null {
  if (e.isComposing || e.altKey || !(e.metaKey || e.ctrlKey)) return null;
  if (e.key.toLowerCase() !== "z") return null;
  const el = e.target instanceof Element ? e.target : null;
  if (el?.closest("textarea, select, [contenteditable]:not([contenteditable=false]), .monaco-editor")) {
    return null;
  }
  const input = el?.closest("input");
  if (input && TEXT_INPUT.test(input.type)) return null;
  return e.shiftKey ? "redo" : "undo";
}

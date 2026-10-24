import type { Editor } from "@open-pencil/core/editor";
import type { UndoEntry } from "@open-pencil/scene-graph/undo";
import { unreferencedImages } from "./graphDocument";

// Every photo edit keeps its preview alive for undo (~9MB encoded plus ~12MB decoded by
// the renderer at 2048px), so only the latest few stay undoable. History below the oldest
// kept photo edit becomes the base state, like OpenPencil's own 200-entry trim.
export const PHOTO_UNDO_LIMIT = 5;

type Tracker = { records: UndoEntry[]; steps: WeakMap<UndoEntry, number>; seen: Map<string, number>; step: number; base: number };
const trackers = new WeakMap<Editor, Tracker>();

// OpenPencil keeps its stacks private (and replaces the array on clear) with no API to drop entries.
const undoStack = (editor: Editor) => (editor.undo as unknown as { undoStack?: UndoEntry[] }).undoStack;

function stepOf(t: Tracker, top: UndoEntry | undefined): number {
  if (!top) return t.base;
  let step = t.steps.get(top);
  if (step === undefined) t.steps.set(top, step = ++t.step);
  return step;
}

// Undo and redo only revisit the state left by the top entry when it was recorded, so a
// preview last seen in a state below the trim point can never come back.
function tracker(editor: Editor): Tracker {
  let t = trackers.get(editor);
  if (t) return t;
  const created: Tracker = t = { records: [], steps: new WeakMap(), seen: new Map(), step: 0, base: 0 };
  editor.onEditorEvent("history:changed", () => {
    if (!created.seen.size) return;
    const step = stepOf(created, undoStack(editor)?.at(-1));
    for (const node of editor.graph.nodes.values()) for (const { imageHash } of node.fills)
      if (imageHash && (created.seen.get(imageHash) ?? Infinity) < step) created.seen.set(imageHash, step);
  });
  trackers.set(editor, t);
  return t;
}

/** Call right after a photo edit's undo entry was committed at the top level. */
export function capPhotoUndo(editor: Editor, hash: string): void {
  const stack = undoStack(editor), entry = stack?.at(-1);
  if (!stack || !entry || editor.undo.isBatching) return;
  const t = tracker(editor), step = stepOf(t, entry);
  t.seen.set(hash, Math.max(step, t.seen.get(hash) ?? 0));
  const live = new Set(stack);
  t.records = [...t.records.filter(record => live.has(record) && record !== entry), entry];
  const cut = t.records.splice(0, Math.max(0, t.records.length - PHOTO_UNDO_LIMIT)).at(-1);
  if (!cut) return;
  stack.splice(0, stack.indexOf(cut) + 1);
  t.base = stepOf(t, cut);
  const stale = [...t.seen].filter(([, seen]) => seen < t.base).map(([key]) => key);
  for (const key of stale.length ? unreferencedImages(editor.graph, stale) : []) {
    editor.graph.images.delete(key);
    t.seen.delete(key);
    for (const renderer of editor.canvasRenderers) {
      renderer.imageCache.get(key)?.delete();
      renderer.imageCache.delete(key);
    }
  }
}

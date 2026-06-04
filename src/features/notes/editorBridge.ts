// Lightweight bridge so the link-insert command can reach the currently
// mounted note editor. NoteEditor registers itself on mount, unregisters
// on unmount. Only one entry can be active at a time (we open one note
// editor per active tab — different tabs unmount when not active).

type NoteEditorHandle = {
  insertLink: (href: string, text: string) => void;
  focus: () => void;
};

const handles = new Map<string, NoteEditorHandle>();
let activeNoteId: string | null = null;

export function registerNoteEditor(noteId: string, handle: NoteEditorHandle) {
  handles.set(noteId, handle);
  activeNoteId = noteId;
}

export function unregisterNoteEditor(noteId: string) {
  handles.delete(noteId);
  if (activeNoteId === noteId) activeNoteId = null;
}

export function getActiveNoteEditor(): {
  id: string;
  handle: NoteEditorHandle;
} | null {
  if (!activeNoteId) return null;
  const handle = handles.get(activeNoteId);
  if (!handle) return null;
  return { id: activeNoteId, handle };
}

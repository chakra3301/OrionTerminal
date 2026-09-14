import { useNotesStore } from "@/store/notesStore";

export function NoteSaveStatus({ noteId }: { noteId: string }) {
  const pending = useNotesStore((s) => s.pendingWrites.has(noteId));
  const saving = useNotesStore((s) => s.saving.has(noteId));
  const error = useNotesStore((s) => s.saveErrors.get(noteId));
  if (!pending) return null;
  return <div className="note-save-status" role="status">
    <span title={error}>{error ? "Changes not saved" : saving ? "Saving…" : "Unsaved changes"}</span>
    <button type="button" disabled={saving}
      onClick={() => { void useNotesStore.getState().flushNote(noteId).catch(() => {}); }}>
      {error ? "Retry save" : "Save now"}
    </button>
  </div>;
}

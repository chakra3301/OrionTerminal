import { useContext } from "react";
import { createPortal } from "react-dom";
import { useNotesStore } from "@/store/notesStore";
import { WindowTitleStatusContext } from "@/shell/WindowTitleStatusContext";

export function NoteSaveStatus({ noteId }: { noteId: string }) {
  const target = useContext(WindowTitleStatusContext);
  const pending = useNotesStore((s) => s.pendingWrites.has(noteId));
  const saving = useNotesStore((s) => s.saving.has(noteId));
  const error = useNotesStore((s) => s.saveErrors.get(noteId));
  const deleting = useNotesStore((s) => s.deleting.has(noteId));
  if (!target && !pending) return null;

  const status = <span className="note-save-status" data-error={error ? "true" : undefined}
    role="status" aria-live="off" data-no-drag>
    <span title={error ?? (saving ? "Saving note…" : "Note save status")}>status : {pending ? "unsaved" : "saved"}</span>
    {pending && <button type="button" disabled={saving || deleting}
      aria-label={error ? "Retry save" : "Save now"}
      title={error ?? "Save now"}
      onClick={() => { void useNotesStore.getState().flushNote(noteId).catch(() => {}); }}>
      {error ? "retry" : "save"}
    </button>}
  </span>;

  return target ? createPortal(status, target) : status;
}

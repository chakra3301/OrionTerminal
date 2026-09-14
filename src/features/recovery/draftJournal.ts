import { useNotesStore } from "@/store/notesStore";
import { useTabsStore } from "@/store/tabsStore";

export type RecoveryItem =
  | { kind: "file"; path: string; contents: string }
  | { kind: "note"; id: string; title: string; blocksJson: string; plaintext: string; noteKind: "note" | "journal" | "project" };
export type RecoverySession = { session: string; revision: number; updated: number; items: string[]; error: string | null };

export function collectDrafts(): string {
  const items: RecoveryItem[] = [];
  const notes = useNotesStore.getState();
  for (const id of notes.drafts.keys()) {
    const note = notes.notes.get(id);
    if (note && !note.readError) items.push({ kind: "note", id, title: note.title, blocksJson: JSON.stringify(note.blocks), plaintext: note.plaintext, noteKind: note.kind });
  }
  for (const [path, buffer] of Object.entries(useTabsStore.getState().fileBuffers)) {
    if (buffer.loaded && buffer.contents !== buffer.original) items.push({ kind: "file", path, contents: buffer.contents });
  }
  return JSON.stringify(items);
}

export function createDraftWriter(write: (revision: number, json: string) => Promise<void>, status: (pending: boolean, error: string | null) => void) {
  let wanted = "[]", saved = "[]", revision = 0, busy = false, disposed = false, failed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drain = async () => {
    if (disposed || busy || (wanted === saved && !failed)) return;
    busy = true; const snapshot = wanted; status(true, null);
    try {
      await write(++revision, snapshot);
      saved = snapshot; failed = false;
      if (!disposed) status(wanted !== saved, null);
    } catch {
      failed = true;
      if (!disposed) status(true, "The latest note/file recovery copy was not written. Save your work normally or retry; older recovery copies may be incomplete.");
      return;
    } finally { busy = false; }
    if (!disposed && wanted !== saved) void drain();
  };
  return {
    update(json: string) {
      if (disposed || json === wanted) return;
      wanted = json; status(wanted !== saved || busy, null);
      clearTimeout(timer); timer = setTimeout(() => { void drain(); }, 150);
    },
    isPending() { return busy || failed || wanted !== saved; },
    retry() { clearTimeout(timer); void drain(); },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}

import { create } from "zustand";
import { useNotesStore } from "@/store/notesStore";
import { useCollectionsStore } from "@/store/collectionsStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useShell } from "@/shell/store/useShell";
import { toast } from "@/store/toastStore";
import { parseCapture } from "./captureText";
import { log } from "@/lib/log";

const INBOX_NAME = "Inbox";
const INBOX_COLOR = "#39ff88";

type QuickCaptureState = {
  open: boolean;
  show: () => void;
  hide: () => void;
};

export const useQuickCapture = create<QuickCaptureState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

/** The Inbox collection captures land in (created on first use). */
export async function ensureInboxCollection(): Promise<string> {
  const cs = useCollectionsStore.getState();
  const existing = [...cs.collections.values()].find(
    (c) => c.name.toLowerCase() === INBOX_NAME.toLowerCase(),
  );
  if (existing) return existing.id;
  const created = await cs.create(INBOX_NAME, INBOX_COLOR);
  return created.id;
}

/**
 * Capture text into a fresh note filed under Inbox. Returns the note id.
 * `open` routes Archives to the new note; otherwise it stays out of the way
 * (frictionless capture — the whole point is not to break flow).
 */
export async function captureNote(
  text: string,
  opts: { open?: boolean } = {},
): Promise<string | null> {
  const { title, blocks } = parseCapture(text);
  try {
    const notes = useNotesStore.getState();
    const note = await notes.create(null, "note");
    await notes.saveTitle(note.id, title);
    if (blocks.length > 0) await notes.saveBlocks(note.id, blocks);
    try {
      const inbox = await ensureInboxCollection();
      await notes.saveCollection(note.id, inbox);
    } catch (e) {
      log.warn("inbox filing failed (note still saved)", e);
    }
    if (opts.open) {
      const a = useArchives.getState();
      a.setView("notes");
      a.setOpenNoteId(note.id);
      useShell.getState().openApp("archives");
      toast.success("Captured — opened", { body: title });
    } else {
      toast.success("Captured to Inbox", {
        body: title,
        action: {
          label: "Open",
          run: () => {
            const a = useArchives.getState();
            a.setView("notes");
            a.setOpenNoteId(note.id);
            useShell.getState().openApp("archives");
          },
        },
      });
    }
    return note.id;
  } catch (e) {
    log.error("quick capture failed", e);
    toast.error("Capture failed", {
      body: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

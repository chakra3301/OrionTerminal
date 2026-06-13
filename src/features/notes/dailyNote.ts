import { useNotesStore } from "@/store/notesStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useShell } from "@/shell/store/useShell";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Friendly date-key title for a daily note, e.g. "Friday, June 13, 2026". */
export function dailyTitle(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Open today's daily note, creating it (a dated journal entry) if it doesn't
 * exist yet. Date-keyed by creation day so re-invoking always lands on the
 * same entry — the ritual that anchors a personal journal.
 */
export async function openDailyNote(): Promise<void> {
  const notes = useNotesStore.getState();
  const today = startOfDay(Date.now());

  const existing = [...notes.notes.values()].find(
    (n) => n.kind === "journal" && startOfDay(n.createdAt) === today,
  );

  const goto = (id: string) => {
    useArchives.getState().setSelectedNoteId(id);
    useArchives.getState().setView("journal");
    useShell.getState().openApp("archives");
  };

  if (existing) {
    goto(existing.id);
    return;
  }

  try {
    const note = await notes.create(null, "journal");
    await notes.saveTitle(note.id, dailyTitle(new Date()));
    goto(note.id);
    toast.success("Started today's note");
  } catch (e) {
    log.error("daily note failed", e);
    toast.error("Couldn't open today's note", {
      body: e instanceof Error ? e.message : String(e),
    });
  }
}

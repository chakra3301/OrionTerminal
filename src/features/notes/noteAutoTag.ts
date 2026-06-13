import { useNotesStore } from "@/store/notesStore";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

/** Conservative note auto-tagging (the assets path has had this since launch;
 * notes never did). Fires only when a note has SETTLED (debounced), has
 * real content, and has NO tags yet — so it never fights manual tags and
 * never re-runs once tags exist. Subscription CLI, fire-and-forget. */

const MIN_CHARS = 280;
const SETTLE_MS = 8000;
const MAX_TAGS = 5;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const attempted = new Set<string>();
const inFlight = new Set<string>();

function buildPrompt(title: string, body: string): string {
  return [
    "Suggest 3-5 short lowercase topic tags for this note. Single words or short hyphenated phrases. No #, no explanation — output ONLY a comma-separated list.",
    "",
    `Title: ${title || "Untitled"}`,
    "",
    body.slice(0, 4000),
  ].join("\n");
}

export function parseTags(reply: string): string[] {
  return reply
    .replace(/^[^a-z0-9]*tags?:?/i, "")
    .split(/[,\n]/)
    .map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/[.;]+$/, ""))
    .filter((t) => t.length > 0 && t.length <= 30 && !/\s{2,}/.test(t))
    .slice(0, MAX_TAGS);
}

async function run(id: string): Promise<void> {
  const note = useNotesStore.getState().notes.get(id);
  if (!note) return;
  if (note.tags.length > 0) return; // never fight manual/existing tags
  if ((note.plaintext ?? "").trim().length < MIN_CHARS) return;
  if (inFlight.has(id) || attempted.has(id)) return;

  inFlight.add(id);
  attempted.add(id);
  try {
    const reply = await ipc.claudeOneshot(buildPrompt(note.title, note.plaintext));
    const tags = parseTags(reply);
    // Re-check: the user may have added tags while we waited.
    const fresh = useNotesStore.getState().notes.get(id);
    if (!fresh || fresh.tags.length > 0) return;
    for (const tag of tags) {
      await useNotesStore.getState().addTag(id, tag);
    }
  } catch (e) {
    log.warn("note auto-tag failed", id, e);
    attempted.delete(id); // let a later settle retry
  } finally {
    inFlight.delete(id);
  }
}

/** Debounced trigger — call from the note save path. */
export function scheduleNoteAutoTag(id: string): void {
  const prev = timers.get(id);
  if (prev) clearTimeout(prev);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void run(id);
    }, SETTLE_MS),
  );
}

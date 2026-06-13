import { create } from "zustand";
import type { NoteBlocks } from "@/store/notesStore";
import type { NoteKind } from "@/lib/db";
import { useNotesStore } from "@/store/notesStore";
import { useArchives } from "@/apps/archives/useArchives";
import { useShell } from "@/shell/store/useShell";
import { toast } from "@/store/toastStore";
import { log } from "@/lib/log";

/** Expand `{{...}}` variables in template text against a moment.
 * Supported: date, time, datetime, weekday, month, year. Unknown tokens are
 * left untouched so they're visible (not silently eaten). Exported for tests. */
export function expandVars(text: string, now: Date): string {
  const map: Record<string, string> = {
    date: now.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    time: now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    datetime: now.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    weekday: now.toLocaleDateString(undefined, { weekday: "long" }),
    month: now.toLocaleDateString(undefined, { month: "long" }),
    year: String(now.getFullYear()),
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
    key in map ? map[key]! : whole,
  );
}

// ── Block builders (BlockNote shapes) ────────────────────────────────────────
type Block = Record<string, unknown>;
const t = (text: string) => [{ type: "text", text, styles: {} }];
const h = (level: 1 | 2 | 3, text: string): Block => ({
  type: "heading",
  props: { level },
  content: t(text),
});
const p = (text = ""): Block => ({
  type: "paragraph",
  content: text ? t(text) : [],
});
const li = (text: string): Block => ({ type: "bulletListItem", content: t(text) });
const todo = (text = ""): Block => ({ type: "checkListItem", content: t(text) });

export type Template = {
  id: string;
  label: string;
  blurb: string;
  kind: NoteKind;
  build: (now: Date) => { title: string; blocks: NoteBlocks };
};

const title = (raw: string, now: Date) => expandVars(raw, now);

export const TEMPLATES: Template[] = [
  {
    id: "meeting",
    label: "Meeting Notes",
    blurb: "Attendees · agenda · action items",
    kind: "note",
    build: (now) => ({
      title: title("Meeting — {{date}}", now),
      blocks: [
        h(2, "Attendees"),
        li("you"),
        h(2, "Agenda"),
        li(""),
        h(2, "Action items"),
        todo(""),
        h(2, "Notes"),
        p(),
      ],
    }),
  },
  {
    id: "daily-log",
    label: "Daily Log",
    blurb: "Today's tasks · notes · gratitude",
    kind: "journal",
    build: (now) => ({
      title: title("{{weekday}}, {{date}}", now),
      blocks: [
        h(2, "Today"),
        todo(""),
        h(2, "Notes"),
        p(),
        h(2, "Grateful for"),
        li(""),
      ],
    }),
  },
  {
    id: "project-brief",
    label: "Project Brief",
    blurb: "Goal · scope · milestones · risks",
    kind: "project",
    build: (now) => ({
      title: title("New Project — {{date}}", now),
      blocks: [
        h(2, "Goal"),
        p(),
        h(2, "Scope"),
        li(""),
        h(2, "Milestones"),
        todo(""),
        h(2, "Risks"),
        li(""),
      ],
    }),
  },
  {
    id: "reading-note",
    label: "Reading Note",
    blurb: "Source · key ideas · quotes · take",
    kind: "note",
    build: (now) => ({
      title: title("Reading — {{date}}", now),
      blocks: [
        h(2, "Source"),
        p(),
        h(2, "Key ideas"),
        li(""),
        h(2, "Quotes"),
        p(),
        h(2, "My take"),
        p(),
      ],
    }),
  },
];

type TemplatePickerState = {
  open: boolean;
  show: () => void;
  hide: () => void;
};

export const useTemplatePicker = create<TemplatePickerState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

const VIEW_FOR_KIND: Record<NoteKind, "notes" | "journal" | "projects"> = {
  note: "notes",
  journal: "journal",
  project: "projects",
};

/** Create a note from a template (variables expanded now) and open it. */
export async function applyTemplate(template: Template): Promise<void> {
  const notes = useNotesStore.getState();
  const { title: noteTitle, blocks } = template.build(new Date());
  try {
    const note = await notes.create(null, template.kind);
    await notes.saveTitle(note.id, noteTitle);
    await notes.saveBlocks(note.id, blocks);
    const a = useArchives.getState();
    a.setView(VIEW_FOR_KIND[template.kind]);
    if (template.kind === "note") a.setOpenNoteId(note.id);
    else a.setSelectedNoteId(note.id);
    if (template.kind === "project") a.setOpenProjectId(note.id);
    useShell.getState().openApp("archives");
    toast.success(`New ${template.label}`, { body: noteTitle });
  } catch (e) {
    log.error("apply template failed", e);
    toast.error("Couldn't create from template", {
      body: e instanceof Error ? e.message : String(e),
    });
  }
}

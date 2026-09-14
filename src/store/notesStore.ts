import { create } from "zustand";
import { ulid } from "ulid";
import {
  listNotes,
  insertNote,
  updateNote,
  deleteNote,
  logActivity,
  listAllNoteTags,
  attachNoteTags,
  detachNoteTagByName,
  upsertTagsByName,
  type NoteRow,
  type NoteKind,
} from "@/lib/db";
import { walkBlocksToPlaintext } from "@/features/notes/plaintext";
import { useWorkspace, allTabs } from "@/components/workspace/workspaceStore";
import { log } from "@/lib/log";
import { serialQueue } from "@/lib/serialQueue";
import { toast } from "@/store/toastStore";
import {
  scheduleReindex,
  removeEntityEmbedding,
} from "@/lib/embeddingIndexer";

export type NoteBlocks = unknown[];

export type Note = {
  id: string;
  title: string;
  blocks: NoteBlocks;
  /** Flat-text snapshot used for cards/previews — kept in sync with blocks. */
  plaintext: string;
  parentId: string | null;
  /** `note` = topic-organized knowledge (Notes view); `journal` = dated entries (Journal view); `project` = a Notion-style page in Projects. */
  kind: NoteKind;
  /** Free-text location surfaced on Journal entries (Apple-Journal-style). */
  location: string;
  /** Optional collection grouping (FK to collections.id). */
  collectionId: string | null;
  /** Manual tags attached via note_tags. Empty array if none. */
  tags: string[];
  /** Starred by the user — surfaces in the Favorites view. */
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  readError?: string;
};

export type { NoteKind };

const EMPTY_DOC: NoteBlocks = [];

function rowToNote(r: NoteRow, tags: string[] = []): Note {
  let blocks: NoteBlocks = EMPTY_DOC;
  let readError: string | undefined;
  try {
    const parsed: unknown = JSON.parse(r.blocks_json);
    if (!Array.isArray(parsed)) throw new Error("Invalid note body");
    blocks = parsed;
  } catch {
    readError = "This note's stored body is invalid. Restore a backup; it has not been replaced with an empty note.";
  }
  return {
    id: r.id,
    title: r.title,
    blocks,
    plaintext: r.plaintext ?? "",
    parentId: r.parent_id,
    kind: (r.kind ?? "note") as NoteKind,
    location: r.location ?? "",
    collectionId: r.collection_id ?? null,
    tags,
    favorite: !!r.favorite,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(readError ? { readError } : {}),
  };
}

type NotePatch = Parameters<typeof updateNote>[1];
type NoteDraft = { revision: number; patch: NotePatch };

type NotesState = {
  notes: Map<string, Note>;
  loaded: boolean;
  /** Includes staged and failed writes, not only active database requests. */
  pendingWrites: Set<string>;
  saving: Set<string>;
  deleting: Set<string>;
  drafts: Map<string, NoteDraft>;
  saveErrors: Map<string, string>;
  loadError: string | null;

  stageBlocks: (id: string, blocks: NoteBlocks) => void;
  stageTitle: (id: string, title: string) => void;
  flushNote: (id: string) => Promise<void>;
  load: () => Promise<void>;
  get: (id: string) => Note | undefined;
  list: () => Note[];
  childrenOf: (parentId: string | null) => Note[];

  create: (parentId: string | null, kind?: NoteKind) => Promise<Note>;
  saveBlocks: (id: string, blocks: NoteBlocks) => Promise<void>;
  saveTitle: (id: string, title: string) => Promise<void>;
  saveLocation: (id: string, location: string) => Promise<void>;
  saveCollection: (id: string, collectionId: string | null) => Promise<void>;
  saveParent: (id: string, parentId: string | null) => Promise<void>;
  toggleFavorite: (id: string, favorite?: boolean) => Promise<void>;
  addTag: (id: string, tagName: string) => Promise<void>;
  removeTag: (id: string, tagName: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

let revision = 0;
let loadTicket = 0;
const queues = new Map<string, ReturnType<typeof serialQueue>>();
const jobs = new Map<string, number>();

function queueFor(id: string): ReturnType<typeof serialQueue> {
  let queue = queues.get(id);
  if (!queue) { queue = serialQueue(); queues.set(id, queue); }
  return queue;
}

function stageNote(id: string, change: Partial<Note>, patch: NotePatch): void {
  const state = useNotesStore.getState(), note = state.notes.get(id);
  if (!note) throw new Error("This note no longer exists.");
  if (note.readError) throw new Error(note.readError);
  if (state.deleting.has(id)) throw new Error("This note is being deleted.");
  const notes = new Map(state.notes), drafts = new Map(state.drafts), pendingWrites = new Set(state.pendingWrites);
  notes.set(id, { ...note, ...change, updatedAt: patch.updated_at });
  drafts.set(id, { revision: ++revision, patch: { ...drafts.get(id)?.patch, ...patch } });
  pendingWrites.add(id);
  useNotesStore.setState({ notes, drafts, pendingWrites });
}

function noteJob<T>(id: string, work: () => Promise<T>): Promise<T> {
  jobs.set(id, (jobs.get(id) ?? 0) + 1);
  useNotesStore.setState((s) => ({ saving: new Set(s.saving).add(id), pendingWrites: new Set(s.pendingWrites).add(id) }));
  const result = queueFor(id)(work).finally(() => {
    const remaining = (jobs.get(id) ?? 1) - 1;
    if (remaining) jobs.set(id, remaining);
    else { jobs.delete(id); queues.delete(id); }
    useNotesStore.setState((s) => {
      const saving = new Set(s.saving), pendingWrites = new Set(s.pendingWrites);
      if (!remaining) saving.delete(id);
      if (!remaining && !s.drafts.has(id) && !s.deleting.has(id)) pendingWrites.delete(id);
      return { saving, pendingWrites };
    });
  });
  // Some command/UI callers intentionally fire and forget; awaited callers still receive rejection.
  void result.catch(() => {});
  return result;
}

function afterNoteSave(id: string, patch: NotePatch): void {
  if (useNotesStore.getState().deleting.has(id)) return;
  scheduleReindex("note", id, () => {
    const note = useNotesStore.getState().notes.get(id);
    return note ? `${note.title || "Untitled"}\n${note.plaintext}` : null;
  });
  if (patch.blocks_json === undefined) return;
  void import("@/features/notes/noteAutoTag").then((m) => m.scheduleNoteAutoTag(id))
    .catch((error) => log.warn("note tagging schedule failed", error));
  const note = useNotesStore.getState().notes.get(id);
  void logActivity({ source: "archives", kind: `${note?.kind ?? "note"}.edit`, title: note?.title || "Untitled", refId: id })
    .catch((error) => log.warn("note activity log failed", error));
}

function flushNote(id: string): Promise<void> {
  const state = useNotesStore.getState(), draft = state.drafts.get(id);
  if (!draft || state.deleting.has(id)) return Promise.resolve();
  return noteJob(id, async () => {
    if (!useNotesStore.getState().drafts.has(id)) return;
    try {
      await updateNote(id, draft.patch);
    } catch (error) {
      useNotesStore.setState((s) => ({ saveErrors: new Map(s.saveErrors).set(id, String(error)) }));
      toast.error("Note was not saved", {
        body: `${String(error)}. Your changes remain in memory; retry before quitting.`,
        dedupeKey: `note-save-${id}`,
        action: { label: "Retry save", run: () => { void flushNote(id); } },
      });
      throw error;
    }
    if (useNotesStore.getState().drafts.get(id)?.revision === draft.revision) {
      useNotesStore.setState((s) => {
        const drafts = new Map(s.drafts), saveErrors = new Map(s.saveErrors);
        drafts.delete(id); saveErrors.delete(id); return { drafts, saveErrors };
      });
      try { afterNoteSave(id, draft.patch); } catch (error) { log.warn("note post-save activity failed", error); }
    }
  });
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: new Map(),
  loaded: false,
  pendingWrites: new Set(),
  saving: new Set(),
  deleting: new Set(),
  drafts: new Map(),
  saveErrors: new Map(),
  loadError: null,
  flushNote,

  stageBlocks: (id, blocks) => {
    const blocks_json = JSON.stringify(blocks);
    const snapshot = JSON.parse(blocks_json) as unknown;
    if (!Array.isArray(snapshot)) throw new Error("Invalid note body");
    const plaintext = walkBlocksToPlaintext(snapshot);
    stageNote(id, { blocks: snapshot, plaintext }, { blocks_json, plaintext, updated_at: Date.now() });
  },
  stageTitle: (id, title) => {
    stageNote(id, { title }, { title, updated_at: Date.now() });
    syncTabLabel(id, title || "Untitled");
  },

  load: async () => {
    const ticket = ++loadTicket;
    const changed = new Set<string>();
    const off = useNotesStore.subscribe((state, previous) => {
      if (state.notes === previous.notes) return;
      for (const [id, note] of state.notes) if (previous.notes.get(id) !== note) changed.add(id);
      for (const id of previous.notes.keys()) if (!state.notes.has(id)) changed.add(id);
    });
    try {
      const [rows, tagsByNote] = await Promise.all([listNotes(), listAllNoteTags()]);
      if (ticket !== loadTicket) return;
      const notes = new Map(rows.map((r) => [r.id, rowToNote(r, tagsByNote.get(r.id) ?? [])]));
      for (const id of new Set([...changed, ...get().pendingWrites])) {
        const current = get().notes.get(id);
        if (current) notes.set(id, current);
        else notes.delete(id);
      }
      set({ notes, loaded: true, loadError: null });
    } catch (error) {
      if (ticket !== loadTicket) return;
      log.error("notes load failed", error);
      set({ loaded: true, loadError: String(error) });
      toast.error("Notes could not be loaded", { body: String(error), dedupeKey: "notes-load",
        action: { label: "Retry", run: () => get().load() } });
    } finally { off(); }
  },

  get: (id) => get().notes.get(id),

  list: () => {
    return Array.from(get().notes.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  },

  childrenOf: (parentId) => {
    return Array.from(get().notes.values())
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  create: async (parentId, kind = "note") => {
    const now = Date.now();
    const note: Note = {
      id: ulid(),
      title: "",
      blocks: EMPTY_DOC,
      plaintext: "",
      parentId,
      kind,
      location: "",
      collectionId: null,
      tags: [],
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    await insertNote({
      id: note.id,
      title: note.title,
      blocks_json: JSON.stringify(note.blocks),
      plaintext: "",
      parent_id: note.parentId,
      kind: note.kind,
      location: note.location,
      collection_id: note.collectionId,
      created_at: note.createdAt,
      updated_at: note.updatedAt,
    });
    set((s) => {
      const next = new Map(s.notes);
      next.set(note.id, note);
      return { notes: next };
    });
    return note;
  },

  saveBlocks: (id, blocks) => {
    get().stageBlocks(id, blocks);
    return flushNote(id);
  },

  saveTitle: (id, title) => {
    get().stageTitle(id, title);
    return flushNote(id);
  },

  saveLocation: (id, location) => {
    stageNote(id, { location }, { location, updated_at: Date.now() });
    return flushNote(id);
  },

  saveCollection: (id, collectionId) => {
    stageNote(id, { collectionId }, { collection_id: collectionId, updated_at: Date.now() });
    return flushNote(id);
  },

  toggleFavorite: (id, favorite) => {
    const next = favorite ?? !get().notes.get(id)?.favorite;
    stageNote(id, { favorite: next }, { favorite: next ? 1 : 0, updated_at: Date.now() });
    return flushNote(id);
  },

  saveParent: (id, parentId) => {
    stageNote(id, { parentId }, { parent_id: parentId, updated_at: Date.now() });
    return flushNote(id);
  },

  addTag: async (id, raw) => {
    const existing = get().notes.get(id);
    if (!existing) return;
    const name = raw.trim().toLowerCase().replace(/^#+/, "");
    if (!name || !/^[a-z0-9-]+$/.test(name)) return;
    if (existing.tags.includes(name)) return;
    try {
      const records = await upsertTagsByName([name]);
      await attachNoteTags(
        id,
        records.map((r) => r.id),
      );
      set((s) => {
        const note = s.notes.get(id);
        if (!note) return s;
        const next = new Map(s.notes);
        next.set(id, { ...note, tags: [...note.tags, name] });
        return { notes: next };
      });
    } catch (e) {
      log.error("addTag failed", e);
      toast.error("Note tag was not saved", { body: String(e) });
    }
  },

  removeTag: async (id, name) => {
    const existing = get().notes.get(id);
    if (!existing) return;
    try {
      await detachNoteTagByName(id, name);
      set((s) => {
        const note = s.notes.get(id);
        if (!note) return s;
        const next = new Map(s.notes);
        next.set(id, { ...note, tags: note.tags.filter((t) => t !== name) });
        return { notes: next };
      });
    } catch (e) {
      log.error("removeTag failed", e);
      toast.error("Note tag was not removed", { body: String(e) });
    }
  },

  remove: (id) => {
    if (get().deleting.has(id)) return Promise.reject(new Error("This note is already being deleted."));
    set((s) => ({ deleting: new Set(s.deleting).add(id) }));
    return noteJob(id, async () => {
      try {
        await deleteNote(id);
        set((s) => {
          const notes = new Map(s.notes), drafts = new Map(s.drafts), saveErrors = new Map(s.saveErrors);
          notes.delete(id); drafts.delete(id); saveErrors.delete(id);
          return { notes, drafts, saveErrors };
        });
        closeTabsForNote(id);
        void removeEntityEmbedding("note", id).catch((error) => log.warn("note embedding removal failed", error));
      } catch (error) {
        toast.error("Note was not deleted", { body: String(error) });
        throw error;
      } finally {
        set((s) => { const deleting = new Set(s.deleting); deleting.delete(id); return { deleting }; });
      }
    });
  },
}));

function syncTabLabel(noteId: string, label: string) {
  const ws = useWorkspace.getState();
  const all = allTabs(ws.root);
  const tab = all.find(
    (t) => t.descriptor.kind === "note" && t.descriptor.noteId === noteId,
  );
  if (tab) ws.setLabel(tab.id, label);
}

function closeTabsForNote(noteId: string) {
  const ws = useWorkspace.getState();
  const matches = allTabs(ws.root).filter(
    (t) => t.descriptor.kind === "note" && t.descriptor.noteId === noteId,
  );
  for (const t of matches) ws.closeTab(t.id);
}

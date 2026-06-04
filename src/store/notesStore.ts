import { create } from "zustand";
import { ulid } from "ulid";
import {
  listNotes,
  insertNote,
  updateNote,
  deleteNote,
  setNoteCollection as dbSetNoteCollection,
  setNoteFavorite as dbSetNoteFavorite,
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
};

export type { NoteKind };

const EMPTY_DOC: NoteBlocks = [];

function rowToNote(r: NoteRow, tags: string[] = []): Note {
  let blocks: NoteBlocks = EMPTY_DOC;
  try {
    const parsed = JSON.parse(r.blocks_json);
    if (Array.isArray(parsed)) blocks = parsed;
  } catch {
    blocks = EMPTY_DOC;
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
  };
}

type NotesState = {
  notes: Map<string, Note>;
  loaded: boolean;
  pendingWrites: Set<string>;

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

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: new Map(),
  loaded: false,
  pendingWrites: new Set(),

  load: async () => {
    try {
      const [rows, tagsByNote] = await Promise.all([
        listNotes(),
        listAllNoteTags(),
      ]);
      const map = new Map<string, Note>();
      for (const r of rows) {
        map.set(r.id, rowToNote(r, tagsByNote.get(r.id) ?? []));
      }
      set({ notes: map, loaded: true });
    } catch (e) {
      // Always flip `loaded` true so views can render their empty state
      // instead of sticking on "Loading notes…". The actual failure stays
      // visible in the logs.
      log.error("notes load failed", e);
      set({ loaded: true });
    }
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

  // The ONE write path for note bodies. Walker runs synchronously here
  // before the DB write — no other code path touches notes.blocks_json.
  saveBlocks: async (id, blocks) => {
    const existing = get().notes.get(id);
    if (!existing) {
      log.warn("saveBlocks: note not found", id);
      return;
    }
    const plaintext = walkBlocksToPlaintext(blocks);
    const updated_at = Date.now();
    set((s) => {
      const next = new Map(s.notes);
      next.set(id, { ...existing, blocks, plaintext, updatedAt: updated_at });
      const pending = new Set(s.pendingWrites);
      pending.add(id);
      return { notes: next, pendingWrites: pending };
    });
    try {
      await updateNote(id, {
        blocks_json: JSON.stringify(blocks),
        plaintext,
        updated_at,
      });
      scheduleReindex("note", id, () => {
        const n = get().notes.get(id);
        return n ? `${n.title || "Untitled"}\n${n.plaintext ?? ""}` : null;
      });
    } finally {
      set((s) => {
        const pending = new Set(s.pendingWrites);
        pending.delete(id);
        return { pendingWrites: pending };
      });
    }
  },

  saveTitle: async (id, title) => {
    const existing = get().notes.get(id);
    if (!existing) return;
    const updated_at = Date.now();
    set((s) => {
      const next = new Map(s.notes);
      next.set(id, { ...existing, title, updatedAt: updated_at });
      return { notes: next };
    });
    // Also keep the open tab label in sync (sidebar + tab strip read this).
    syncTabLabel(id, title || "Untitled");
    await updateNote(id, { title, updated_at });
    scheduleReindex("note", id, () => {
      const n = get().notes.get(id);
      return n ? `${n.title || "Untitled"}\n${n.plaintext ?? ""}` : null;
    });
  },

  saveLocation: async (id, location) => {
    const existing = get().notes.get(id);
    if (!existing) return;
    const updated_at = Date.now();
    set((s) => {
      const next = new Map(s.notes);
      next.set(id, { ...existing, location, updatedAt: updated_at });
      return { notes: next };
    });
    await updateNote(id, { location, updated_at });
  },

  saveCollection: async (id, collectionId) => {
    const existing = get().notes.get(id);
    if (!existing) return;
    const updated_at = Date.now();
    set((s) => {
      const next = new Map(s.notes);
      next.set(id, { ...existing, collectionId, updatedAt: updated_at });
      return { notes: next };
    });
    await dbSetNoteCollection(id, collectionId, updated_at);
  },

  toggleFavorite: async (id, favorite) => {
    const existing = get().notes.get(id);
    if (!existing) return;
    const next = favorite ?? !existing.favorite;
    const updated_at = Date.now();
    set((s) => {
      const map = new Map(s.notes);
      map.set(id, { ...existing, favorite: next, updatedAt: updated_at });
      return { notes: map };
    });
    await dbSetNoteFavorite(id, next, updated_at);
  },

  saveParent: async (id, parentId) => {
    const existing = get().notes.get(id);
    if (!existing) return;
    if (existing.parentId === parentId) return;
    const updated_at = Date.now();
    set((s) => {
      const next = new Map(s.notes);
      next.set(id, { ...existing, parentId, updatedAt: updated_at });
      return { notes: next };
    });
    await updateNote(id, { parent_id: parentId, updated_at });
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
    }
  },

  remove: async (id) => {
    await deleteNote(id);
    set((s) => {
      const next = new Map(s.notes);
      next.delete(id);
      return { notes: next };
    });
    closeTabsForNote(id);
    void removeEntityEmbedding("note", id);
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

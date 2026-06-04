import { create } from "zustand";
import { ulid } from "ulid";
import {
  listCollections,
  insertCollection,
  renameCollection as dbRename,
  setCollectionColor as dbSetColor,
  deleteCollection,
  type CollectionRow,
} from "@/lib/db";
import { log } from "@/lib/log";

export type Collection = {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
};

function rowToCollection(r: CollectionRow): Collection {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const COLLECTION_PALETTE = [
  "var(--neon-green)",
  "var(--neon-cyan)",
  "var(--neon-yellow)",
  "var(--neon-magenta)",
  "var(--neon-violet)",
] as const;

type State = {
  collections: Map<string, Collection>;
  loaded: boolean;
  load: () => Promise<void>;
  create: (name: string, color?: string) => Promise<Collection>;
  rename: (id: string, name: string) => Promise<void>;
  setColor: (id: string, color: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useCollectionsStore = create<State>((set, get) => ({
  collections: new Map(),
  loaded: false,

  load: async () => {
    try {
      const rows = await listCollections();
      const map = new Map<string, Collection>();
      for (const r of rows) map.set(r.id, rowToCollection(r));
      set({ collections: map, loaded: true });
    } catch (e) {
      log.error("collections load failed", e);
      set({ loaded: true });
    }
  },

  create: async (name, color) => {
    const now = Date.now();
    const palette = COLLECTION_PALETTE;
    const fallback = palette[get().collections.size % palette.length]!;
    const c: Collection = {
      id: ulid(),
      name: name.trim() || "Untitled",
      color: color || fallback,
      createdAt: now,
      updatedAt: now,
    };
    await insertCollection({
      id: c.id,
      name: c.name,
      color: c.color,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    });
    set((s) => {
      const next = new Map(s.collections);
      next.set(c.id, c);
      return { collections: next };
    });
    return c;
  },

  rename: async (id, name) => {
    const existing = get().collections.get(id);
    if (!existing) return;
    const updatedAt = Date.now();
    const trimmed = name.trim() || "Untitled";
    await dbRename(id, trimmed, updatedAt);
    set((s) => {
      const next = new Map(s.collections);
      next.set(id, { ...existing, name: trimmed, updatedAt });
      return { collections: next };
    });
  },

  setColor: async (id, color) => {
    const existing = get().collections.get(id);
    if (!existing) return;
    const updatedAt = Date.now();
    await dbSetColor(id, color, updatedAt);
    set((s) => {
      const next = new Map(s.collections);
      next.set(id, { ...existing, color, updatedAt });
      return { collections: next };
    });
  },

  remove: async (id) => {
    await deleteCollection(id);
    set((s) => {
      const next = new Map(s.collections);
      next.delete(id);
      return { collections: next };
    });
  },
}));

export function sortCollections(map: Map<string, Collection>): Collection[] {
  return Array.from(map.values()).sort(
    (a, b) => a.createdAt - b.createdAt,
  );
}

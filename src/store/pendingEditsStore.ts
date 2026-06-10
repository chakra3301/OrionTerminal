import { create } from "zustand";

export type PendingEdit = {
  path: string;
  original: string;
  updated: string;
  isNew: boolean;
  ts: number;
};

type PendingEditsState = {
  edits: Record<string, PendingEdit>;
  order: string[];
  stage: (e: {
    path: string;
    original: string;
    updated: string;
    isNew: boolean;
  }) => void;
  /** Per-hunk review folds resolved hunks into original (accept) or out of
   * updated (reject) — this updates the stored endpoints. */
  patch: (path: string, partial: Partial<Pick<PendingEdit, "original" | "updated">>) => void;
  remove: (path: string) => void;
  clear: () => void;
};

export const usePendingEdits = create<PendingEditsState>((set) => ({
  edits: {},
  order: [],
  stage: ({ path, original, updated, isNew }) =>
    set((s) => {
      const existing = s.edits[path];
      // Multiple edits to one file in a turn collapse into a single review,
      // keeping the earliest original so the diff spans original → latest.
      const merged: PendingEdit = {
        path,
        original: existing?.original ?? original,
        updated,
        isNew: existing?.isNew ?? isNew,
        ts: Date.now(),
      };
      return {
        edits: { ...s.edits, [path]: merged },
        order: s.order.includes(path) ? s.order : [...s.order, path],
      };
    }),
  patch: (path, partial) =>
    set((s) => {
      const existing = s.edits[path];
      if (!existing) return s;
      return {
        edits: { ...s.edits, [path]: { ...existing, ...partial, ts: Date.now() } },
      };
    }),
  remove: (path) =>
    set((s) => {
      const { [path]: _drop, ...rest } = s.edits;
      return { edits: rest, order: s.order.filter((p) => p !== path) };
    }),
  clear: () => set({ edits: {}, order: [] }),
}));

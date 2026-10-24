import { create } from "zustand";

export const useArchiveSearchRevision = create<{ revision: number; assetId: string | null; changed: (assetId?: string) => number }>((set, get) => ({
  revision: 0,
  assetId: null,
  changed: (assetId) => { const revision = get().revision + 1; set({ revision, assetId: assetId ?? null }); return revision; },
}));

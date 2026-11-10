import { create } from "zustand";
import { intake } from "./api";
import type { IntakeCandidate } from "./contracts";

type Collection = {
  items: IntakeCandidate[];
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  stage: (candidate: IntakeCandidate) => Promise<IntakeCandidate>;
  discard: (id: string) => Promise<void>;
};
let pending: Promise<unknown> = Promise.resolve();
function ordered<T>(task: () => Promise<T>): Promise<T> {
  const next = pending.then(task); pending = next.catch(() => undefined); return next;
}
export const useIntakeCollection = create<Collection>((set, get) => ({
  items: [], loaded: false, error: null,
  refresh: () => ordered(async () => {
    try { const items = await intake.list(); set({ items, loaded: true, error: null }); }
    catch (e) { set({ loaded: false, error: "Staged skills could not be loaded. Reload before making changes." }); throw e; }
  }),
  stage: (candidate) => ordered(async () => {
    if (!get().loaded) throw new Error("Reload staged skills before saving.");
    const saved = await intake.stage(candidate.id, candidate.artifactHash);
    set((s) => ({ items: [saved, ...s.items.filter((item) => item.id !== saved.id)], error: null }));
    return saved;
  }),
  discard: (id) => ordered(async () => {
    if (!get().loaded) throw new Error("Reload staged skills before discarding.");
    await intake.discard(id);
    set((s) => ({ items: s.items.filter((item) => item.id !== id), error: null }));
  }),
}));

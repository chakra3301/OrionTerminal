import { create } from "zustand";
import { getAppState, setAppState } from "@/lib/db";
import { parseEvidence, parseHistory, type AnalysisEvidence } from "@/features/repoAnalysis/contracts";

let queue: Promise<unknown> = Promise.resolve();
function ordered<T>(fn: () => Promise<T>): Promise<T> { const next = queue.then(fn); queue = next.catch(() => undefined); return next; }
type State = { items: AnalysisEvidence[]; loaded: boolean; error: string | null; load: () => Promise<void>; save: (e: AnalysisEvidence) => Promise<void>; remove: (id: string) => Promise<void> };
export const useAnalysisHistory = create<State>((set, get) => {
  const publish = async (items: AnalysisEvidence[]) => {
    if (!get().loaded) throw new Error("Reload analysis history before making changes.");
    try { await setAppState("intake.analysis", { version: 1, items }); set({ items, error: null }); }
    catch (e) { set({ loaded: false, error: "Analysis write could not be confirmed. Reload before retrying; the previous view is retained." }); throw e; }
  };
  return {
    items: [], loaded: false, error: null,
    load: () => ordered(async () => {
      try { const raw = await getAppState("intake.analysis", true); set({ items: raw === null ? [] : parseHistory(raw), loaded: true, error: null }); }
      catch { set({ loaded: false, error: "Analysis history is unavailable or unsupported. Stored data was not replaced." }); }
    }),
    save: (e) => { const snapshot = parseEvidence(structuredClone(e)); return ordered(async () => {
      if (!get().loaded) throw new Error("Reload analysis history before making changes.");
      const items = get().items;
      const prior = items.find((item) => item.id === snapshot.id);
      if (prior) { if (JSON.stringify(prior) !== JSON.stringify(snapshot)) throw new Error("Analysis identity conflict"); return; }
      if (items.length >= 8) throw new Error("Eight assessments are saved. Remove one before saving another.");
      await publish([...items, snapshot]);
    }); },
    remove: (id) => ordered(() => publish(get().items.filter((item) => item.id !== id))),
  };
});

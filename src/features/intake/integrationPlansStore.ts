import { create } from "zustand";
import { getAppState, setAppState } from "@/lib/db";
import { parsePlan, parsePlans, type IntegrationPlan } from "./integrationPlan";
let queue: Promise<unknown> = Promise.resolve();
function ordered<T>(fn: () => Promise<T>): Promise<T> { const next = queue.then(fn); queue = next.catch(() => undefined); return next; }
type State = { items: IntegrationPlan[]; loaded: boolean; error: string | null; load: () => Promise<void>; save: (p: IntegrationPlan) => Promise<void>; remove: (id: string) => Promise<void> };
export const useIntegrationPlans = create<State>((set, get) => {
  const publish = async (items: IntegrationPlan[]) => {
    if (!get().loaded) throw new Error("Reload plans before changing saved data.");
    try { await setAppState("intake.plans", { version: 1, items }); set({ items, error: null }); }
    catch (e) { set({ loaded: false, error: "Plan write could not be confirmed. Prior view retained; reload before retrying." }); throw e; }
  };
  return {
    items: [], loaded: false, error: null,
    load: () => ordered(async () => {
      try { const value = await getAppState("intake.plans", true); set({ items: value === null ? [] : parsePlans(value), loaded: true, error: null }); }
      catch { set({ loaded: false, error: "Plans could not be loaded or their version is unsupported. Stored data was not replaced." }); }
    }),
    save: (p) => { const snapshot = parsePlan(structuredClone(p)); return ordered(async () => {
      if (!get().loaded) throw new Error("Reload plans before changing saved data.");
      const prior = get().items.find((item) => item.id === snapshot.id);
      if (prior) { if (JSON.stringify(prior) !== JSON.stringify(snapshot)) throw new Error("Plan identity conflict"); return; }
      if (get().items.length >= 8) throw new Error("Eight plans are saved. Remove one before saving another.");
      await publish([...get().items, snapshot]);
    }); },
    remove: (id) => ordered(() => publish(get().items.filter((p) => p.id !== id))),
  };
});

import { create } from "zustand";
import { getAppState, setAppState } from "@/lib/db";
import { log } from "@/lib/log";

/** Blueprint visualizer preference — one global on/off, persisted to
 * app_state so it survives restarts. Hydrates lazily on first editor mount. */

type VizState = {
  enabled: boolean;
  hydrated: boolean;
  toggle: () => void;
  hydrate: () => Promise<void>;
};

let hydrating: Promise<void> | null = null;

export const useVisualizer = create<VizState>((set, get) => ({
  enabled: false,
  hydrated: false,

  toggle: () => {
    const enabled = !get().enabled;
    set({ enabled });
    void setAppState("note_visualizer", { enabled }).catch((e) =>
      log.warn("visualizer pref save failed", e),
    );
  },

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydrating) return hydrating;
    hydrating = (async () => {
      try {
        const saved = await getAppState<{ enabled?: boolean }>("note_visualizer");
        set({ enabled: !!saved?.enabled, hydrated: true });
      } catch (e) {
        log.warn("visualizer pref load failed", e);
        set({ hydrated: true });
      } finally {
        hydrating = null;
      }
    })();
    return hydrating;
  },
}));

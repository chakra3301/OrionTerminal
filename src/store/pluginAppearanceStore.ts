import { create } from "zustand";
import { getAppState, setAppState } from "@/lib/db";
import { serialQueue } from "@/lib/serialQueue";
import type { PluginStyleMode } from "@/plugins/pluginAppearance";
import { assertPluginId } from "@/plugins/contracts";

export function parsePluginStylePreferences(value: unknown): Record<string, PluginStyleMode> {
  if (value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid appearance preferences");
  const r = value as Record<string, unknown>;
  if (Object.keys(r).length !== 2 || r.version !== 1 || !r.modes || typeof r.modes !== "object" || Array.isArray(r.modes)) throw new Error("Unsupported appearance preferences");
  const entries = Object.entries(r.modes);
  if (entries.length > 256 || entries.some(([id, mode]) => {
    try { assertPluginId(id); } catch { return true; }
    return id.length > 256 || (mode !== "orion" && mode !== "original");
  })) throw new Error("Invalid appearance preference values");
  return Object.fromEntries(entries) as Record<string, PluginStyleMode>;
}
const ordered = serialQueue();
let loading: Promise<void> | null = null;
export const usePluginAppearance = create<{
  loaded: boolean; busy: boolean; modes: Record<string, PluginStyleMode>; error: string | null;
  load: () => Promise<void>; change: (id: string, mode: PluginStyleMode) => Promise<void>;
}>((set, get) => ({
  loaded: false, busy: false, modes: {}, error: null,
  load: () => {
    if (get().loaded) return Promise.resolve();
    if (loading) return loading;
    loading = getAppState("plugins.appearance").then(value => {
      set({ loaded: true, modes: parsePluginStylePreferences(value), error: null });
    }).catch(() => { set({ loaded: false, error: "Appearance preferences couldn't be loaded. Stored choices were not changed." }); })
      .finally(() => { loading = null; });
    return loading;
  },
  change: (id, mode) => ordered(async () => {
    if (!get().loaded) return;
    let modes: Record<string, PluginStyleMode>;
    try { modes = parsePluginStylePreferences({ version: 1, modes: { ...get().modes, [id]: mode } }); }
    catch { set({ error: "Appearance preference capacity or identity is invalid. Existing choices were not changed." }); return; }
    set({ busy: true, error: null });
    try {
      await setAppState("plugins.appearance", { version: 1, modes });
      set({ modes });
    } catch { set({ error: "Styling wasn't saved. Your previous choice is unchanged; try again." }); }
    finally { set({ busy: false }); }
  }),
}));

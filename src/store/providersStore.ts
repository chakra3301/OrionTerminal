import { create } from "zustand";
import { listProviders, upsertProvider, deleteProvider } from "@/lib/agentsDb";
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER } from "@/features/agents/seedData";
import type { Provider } from "@/features/agents/agentTypes";
import { log } from "@/lib/log";

type ProvidersState = {
  providers: Provider[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (p: Provider) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: [],
  loaded: false,
  load: async () => {
    try {
      let rows = await listProviders();
      const seeds = [BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER];
      let seeded = false;
      for (const s of seeds) {
        if (!rows.some((p) => p.id === s.id)) { await upsertProvider(s); seeded = true; }
      }
      if (seeded) rows = await listProviders();
      set({ providers: rows, loaded: true });
    } catch (e) {
      log.warn("providers load failed", e);
      set({ loaded: true });
    }
  },
  save: async (p) => { await upsertProvider(p); set({ providers: await listProviders() }); },
  remove: async (id) => { await deleteProvider(id); set({ providers: get().providers.filter((p) => p.id !== id) }); },
}));

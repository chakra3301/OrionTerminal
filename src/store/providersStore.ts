import { create } from "zustand";
import { listProviders, upsertProvider, deleteProvider } from "@/lib/agentsDb";
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, CURSOR_SDK_PROVIDER, GEMINI_CLI_PROVIDER } from "@/features/agents/seedData";
import type { Provider } from "@/features/agents/agentTypes";
import { log } from "@/lib/log";

function modelsStale(a: { id: string }[], b: { id: string }[]): boolean {
  const cur = new Set(a.map((m) => m.id));
  return b.some((m) => !cur.has(m.id)) || a.length !== b.length;
}

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
      const seeds = [BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER, CURSOR_SDK_PROVIDER];
      let seeded = false;
      for (const s of seeds) {
        const existing = rows.find((p) => p.id === s.id);
        if (!existing) {
          await upsertProvider(s);
          seeded = true;
        } else if (s.id === CURSOR_SDK_PROVIDER.id && !existing.keyRef.trim()) {
          await upsertProvider({ ...existing, keyRef: CURSOR_SDK_PROVIDER.keyRef });
          seeded = true;
        } else if (s.builtin && modelsStale(existing.models, s.models)) {
          // Builtin model lists are canonical; refresh when the seed adds or
          // renames models so existing users pick up new ones (e.g. Sonnet 5).
          await upsertProvider({ ...existing, models: s.models });
          seeded = true;
        }
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

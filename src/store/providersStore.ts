import { create } from "zustand";
import { listProviders, upsertProvider, deleteProvider } from "@/lib/agentsDb";
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, CURSOR_SDK_PROVIDER, GEMINI_CLI_PROVIDER } from "@/features/agents/seedData";
import type { Provider } from "@/features/agents/agentTypes";
import { log } from "@/lib/log";
import { serialQueue } from "@/lib/serialQueue";

const enqueue = serialQueue();

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
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
};

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: [],
  loaded: false,
  load: () => enqueue(async () => {
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
        } else if (s.builtin && (modelsStale(existing.models, s.models) || existing.name !== s.name)) {
          // Builtin identity + model lists are canonical; refresh when seeds
          // add models or clarify a provider's user-facing connection type.
          await upsertProvider({ ...existing, name: s.name, models: s.models });
          seeded = true;
        }
      }
      if (seeded) rows = await listProviders();
      set({ providers: rows, loaded: true });
    } catch (e) {
      log.warn("providers load failed", e);
      set({ loaded: true });
    }
  }),
  save: (p) => enqueue(async () => {
    const current = get().providers.find((row) => row.id === p.id);
    await upsertProvider(current ? { ...p, enabled: current.enabled } : p);
    set({ providers: await listProviders() });
  }),
  remove: (id) => enqueue(async () => { await deleteProvider(id); set({ providers: get().providers.filter((p) => p.id !== id) }); }),
  setEnabled: (id, enabled) => enqueue(async () => {
    const current = get().providers.find((p) => p.id === id);
    if (!current) throw new Error("Provider no longer exists");
    const updated = { ...current, enabled };
    await upsertProvider(updated);
    set({ providers: get().providers.map((p) => p.id === id ? updated : p) });
  }),
}));

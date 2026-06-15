import { create } from "zustand";
import { listAgents, upsertAgent, deleteAgent } from "@/lib/agentsDb";
import type { Agent } from "@/features/agents/agentTypes";
import { log } from "@/lib/log";

type AgentsState = {
  agents: Map<string, Agent>;
  loaded: boolean;
  load: () => Promise<void>;
  list: () => Agent[];
  get: (id: string) => Agent | undefined;
  save: (a: Agent) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: new Map(),
  loaded: false,
  load: async () => {
    try {
      const rows = await listAgents();
      set({ agents: new Map(rows.map((a) => [a.id, a])), loaded: true });
    } catch (e) {
      log.warn("agents load failed", e);
      set({ loaded: true });
    }
  },
  list: () => Array.from(get().agents.values()),
  get: (id) => get().agents.get(id),
  save: async (a) => {
    set((s) => { const next = new Map(s.agents); next.set(a.id, a); return { agents: next }; });
    await upsertAgent(a);
  },
  remove: async (id) => {
    set((s) => { const next = new Map(s.agents); next.delete(id); return { agents: next }; });
    await deleteAgent(id);
  },
}));

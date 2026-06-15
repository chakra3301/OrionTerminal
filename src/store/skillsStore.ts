import { create } from "zustand";
import { listSkills, upsertSkill, deleteSkill } from "@/lib/agentsDb";
import { STARTER_SKILLS } from "@/features/agents/seedData";
import type { Skill } from "@/features/agents/agentTypes";
import { log } from "@/lib/log";

type SkillsState = {
  skills: Map<string, Skill>;
  loaded: boolean;
  load: () => Promise<void>;
  list: () => Skill[];
  get: (id: string) => Skill | undefined;
  save: (s: Skill) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: new Map(),
  loaded: false,
  load: async () => {
    try {
      let rows = await listSkills();
      if (rows.length === 0) {
        for (const s of STARTER_SKILLS) await upsertSkill(s);
        rows = await listSkills();
      }
      set({ skills: new Map(rows.map((s) => [s.id, s])), loaded: true });
    } catch (e) {
      log.warn("skills load failed", e);
      set({ loaded: true });
    }
  },
  list: () => Array.from(get().skills.values()),
  get: (id) => get().skills.get(id),
  save: async (s) => {
    set((st) => { const next = new Map(st.skills); next.set(s.id, s); return { skills: next }; });
    await upsertSkill(s);
  },
  remove: async (id) => {
    set((st) => { const next = new Map(st.skills); next.delete(id); return { skills: next }; });
    await deleteSkill(id);
  },
}));

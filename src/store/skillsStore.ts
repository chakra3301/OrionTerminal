import { create } from "zustand";
import { listSkills, upsertSkill, deleteSkill } from "@/lib/agentsDb";
import { STARTER_SKILLS } from "@/features/agents/seedData";
import type { Skill } from "@/features/agents/agentTypes";
import { log } from "@/lib/log";
import { installedSkills } from "@/features/intake/installedApi";
import { assertImportedSkillsIdle } from "@/features/intake/skillRuns";
import type { InstalledSkill, IntakeCandidate } from "@/features/intake/contracts";

type SkillsState = {
  skills: Map<string, Skill>;
  packages: Map<string, InstalledSkill>;
  mutating: boolean;
  install: (candidate: IntakeCandidate, target: InstalledSkill | null, acknowledged: boolean, current?: () => boolean) => Promise<void>;
  changePackage: (id: string, expectedVersion: string, action: "enable" | "disable" | "rollback" | "remove", version?: string) => Promise<void>;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  list: () => Skill[];
  get: (id: string) => Skill | undefined;
  save: (s: Skill) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

let pending: Promise<unknown> = Promise.resolve();
function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.then(operation);
  pending = next.catch(() => undefined);
  return next;
}

async function readSkills(): Promise<Pick<SkillsState, "skills" | "packages">> {
  const packages = new Map((await installedSkills.list()).map((p) => [p.skillId, p]));
  let rows = await listSkills();
  if (rows.length === 0 && packages.size === 0) {
    for (const s of STARTER_SKILLS) await upsertSkill(s);
    rows = await listSkills();
  }
  const skills = new Map(rows.map((s): [string, Skill] => {
    const p = packages.get(s.id);
    if (s.id.startsWith("imported:")) {
      if (!p || s.builtin || s.tools.length || s.instructions || s.name !== p.active.metadata.name) throw new Error("Imported skill backing is inconsistent");
      return [s.id, { ...s, imported: { versionId: p.active.id, artifactHash: p.active.artifactHash, enabled: p.enabled } }];
    }
    if (p) throw new Error("Invalid imported identity");
    return [s.id, s];
  }));
  if ([...packages.keys()].some((id) => !skills.has(id))) throw new Error("Missing installed skill row");
  return { skills, packages };
}

export const useSkillsStore = create<SkillsState>((set, get) => {
  const mutate = (ids: string[], operation: () => Promise<unknown>, current: () => boolean = () => true) => ordered(async () => {
    if (!current()) throw new Error("Skill installation review was dismissed; nothing was sent.");
    if (!get().loaded) throw new Error("Reload skills successfully before making changes.");
    assertImportedSkillsIdle(ids);
    set({ mutating: true });
    let issued = false;
    try {
      if (!current()) throw new Error("Skill installation review was dismissed; nothing was sent.");
      issued = true; await operation();
      set({ ...await readSkills(), loaded: true, error: null });
    } catch (error) {
      if (issued) set({ loaded: false, error: "Skill change could not be confirmed. Reload before retrying; previous visible state is retained." });
      else set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally { set({ mutating: false }); }
  });
  return {
  skills: new Map(),
  packages: new Map(),
  mutating: false,
  install: (candidate, target, acknowledged, current) => {
    const { id, artifactHash } = candidate;
    const targetId = target?.skillId ?? null, expectedVersion = target?.active.id ?? null;
    return mutate(targetId ? [targetId] : [], () => installedSkills.install(id, artifactHash, targetId, expectedVersion, acknowledged), current);
  },
  changePackage: (id, expectedVersion, action, version) => mutate([id], () => installedSkills.change(id, expectedVersion, action, version)),
  loaded: false,
  error: null,
  load: () => ordered(async () => {
    try {
      set({ ...await readSkills(), loaded: true, error: null });
    } catch (e) {
      log.warn("skills load failed", e);
      set({ loaded: false, error: "Skills could not be loaded. Retry before making changes." });
    }
  }),
  list: () => Array.from(get().skills.values()),
  get: (id) => get().skills.get(id),
  save: (s) => {
    const snapshot = { ...s, tools: s.tools.map((t) => ({ ...t })) };
    return ordered(async () => {
      if (!get().loaded) throw new Error("Load skills successfully before saving.");
      if (snapshot.imported || snapshot.id.startsWith("imported:")) throw new Error("Imported originals cannot be edited in place.");
      await upsertSkill(snapshot);
      set((st) => { const next = new Map(st.skills); next.set(snapshot.id, snapshot); return { skills: next }; });
    });
  },
  remove: (id) => ordered(async () => {
    if (!get().loaded) throw new Error("Load skills successfully before removing.");
    if (id.startsWith("imported:")) throw new Error("Use the imported skill removal controls.");
    await deleteSkill(id);
    set((st) => { const next = new Map(st.skills); next.delete(id); return { skills: next }; });
  }),
};
});

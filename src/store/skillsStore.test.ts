import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), remove: vi.fn(), packages: vi.fn(), install: vi.fn(), change: vi.fn() }));
vi.mock("@/features/intake/installedApi", () => ({ installedSkills: { list: m.packages, install: m.install, change: m.change } }));
vi.mock("@/lib/agentsDb", () => ({ listSkills: m.list, upsertSkill: m.save, deleteSkill: m.remove }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn() } }));
import { useSkillsStore } from "./skillsStore";
import type { Skill } from "@/features/agents/agentTypes";
import { candidateFixture } from "@/features/intake/testFixture";
import { holdImportedSkills, releaseImportedSkills } from "@/features/intake/skillRuns";
const packageItem = { skillId: `imported:${candidateFixture.id}`, enabled: true, active: candidateFixture, versions: [candidateFixture] };
const importedRow: Skill = { id: packageItem.skillId, name: candidateFixture.metadata.name, instructions: "", tools: [], builtin: false, accent: "", icon: "" };
const original: Skill = { id: "hand-authored", name: "Original", instructions: "Keep me", tools: [], icon: "", accent: "", builtin: false };
beforeEach(() => {
  vi.resetAllMocks(); m.packages.mockResolvedValue([]); m.list.mockResolvedValue([original]); m.save.mockResolvedValue(undefined); m.remove.mockResolvedValue(undefined);
  useSkillsStore.setState({ skills: new Map([[original.id, original]]), packages: new Map(), mutating: false, loaded: true, error: null });
});
it("publishes saves only after acknowledgement and snapshots mutable inputs", async () => {
  let finish!: () => void; m.save.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
  const draft = { ...original, name: "Saved" }; const save = useSkillsStore.getState().save(draft); draft.name = "Later";
  await vi.waitFor(() => expect(m.save).toHaveBeenCalledOnce());
  expect(useSkillsStore.getState().get(original.id)?.name).toBe("Original"); finish(); await save;
  expect(useSkillsStore.getState().get(original.id)?.name).toBe("Saved");
});
it("retains old skills on failed save and remove", async () => {
  m.save.mockRejectedValueOnce(new Error("disk")); await expect(useSkillsStore.getState().save({ ...original, name: "failed" })).rejects.toThrow("disk");
  m.remove.mockRejectedValueOnce(new Error("disk")); await expect(useSkillsStore.getState().remove(original.id)).rejects.toThrow("disk");
  expect(useSkillsStore.getState().get(original.id)).toEqual(original);
});
it("blocks writes after failed hydration without replacing or seeding data", async () => {
  m.list.mockRejectedValueOnce(new Error("unreadable")); await useSkillsStore.getState().load();
  expect(useSkillsStore.getState().loaded).toBe(false); expect(useSkillsStore.getState().list()).toEqual([original]);
  await expect(useSkillsStore.getState().save(original)).rejects.toThrow("Load skills"); expect(m.save).not.toHaveBeenCalled();
  await useSkillsStore.getState().load(); await useSkillsStore.getState().save(original); expect(m.save).toHaveBeenCalledOnce();
});
it("serializes load, save and remove to prevent late-load resurrection", async () => {
  let finish!: (skills: Skill[]) => void; m.list.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  const load = useSkillsStore.getState().load(); const save = useSkillsStore.getState().save({ ...original, name: "New" }); const remove = useSkillsStore.getState().remove(original.id);
  await vi.waitFor(() => expect(m.list).toHaveBeenCalledOnce()); expect(m.save).not.toHaveBeenCalled();
  finish([original]); await Promise.all([load, save, remove]); expect(useSkillsStore.getState().list()).toEqual([]);
  expect(m.save.mock.invocationCallOrder[0]).toBeLessThan(m.remove.mock.invocationCallOrder[0]!);
});
it("publishes installed backing only after native commit and successful joint hydration", async () => {
  let finish!: () => void; m.install.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
  let live = true;
  const installing = useSkillsStore.getState().install(candidateFixture, null, true, () => live);
  await vi.waitFor(() => expect(m.install).toHaveBeenCalledOnce()); live = false;
  expect(useSkillsStore.getState().packages.size).toBe(0); expect(useSkillsStore.getState().mutating).toBe(true);
  m.packages.mockResolvedValue([packageItem]); m.list.mockResolvedValue([original, importedRow]); finish(); await installing;
  expect(useSkillsStore.getState().get(importedRow.id)?.imported?.versionId).toBe(candidateFixture.id);
  expect(useSkillsStore.getState().get(original.id)).toEqual(original);
  expect(m.install).toHaveBeenCalledWith(candidateFixture.id, candidateFixture.artifactHash, null, null, true);
});
it("a dismissed queued installation never reaches native publication or invalidates known backing", async () => {
  let finish!: (skills: Skill[]) => void; m.list.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  const loading = useSkillsStore.getState().load(); let current = true; const installing = useSkillsStore.getState().install(candidateFixture, null, true, () => current);
  const rejected = expect(installing).rejects.toThrow("dismissed"); await vi.waitFor(() => expect(m.list).toHaveBeenCalledOnce()); current = false; finish([original]); await loading; await rejected;
  expect(m.install).not.toHaveBeenCalled(); expect(useSkillsStore.getState().loaded).toBe(true); expect(useSkillsStore.getState().get(original.id)).toEqual(original);
});
it("synchronous mutation subscribers can revoke approval before irreversible skill IPC", async () => {
  let current = true; const off = useSkillsStore.subscribe((s) => { if (s.mutating) current = false; });
  try { await expect(useSkillsStore.getState().install(candidateFixture, null, true, () => current)).rejects.toThrow("dismissed"); }
  finally { off(); }
  expect(m.install).not.toHaveBeenCalled(); expect(useSkillsStore.getState().loaded).toBe(true); expect(useSkillsStore.getState().mutating).toBe(false);
});
it("ambiguous install blocks further writes, preserves prior view and reloads without reinstalling", async () => {
  m.install.mockRejectedValueOnce(new Error("connection lost after commit"));
  await expect(useSkillsStore.getState().install(candidateFixture, null, true)).rejects.toThrow("connection lost");
  expect(useSkillsStore.getState().loaded).toBe(false); expect(useSkillsStore.getState().list()).toEqual([original]);
  await expect(useSkillsStore.getState().install(candidateFixture, null, true)).rejects.toThrow("Reload");
  m.packages.mockResolvedValue([packageItem]); m.list.mockResolvedValue([original, importedRow]); await useSkillsStore.getState().load();
  expect(useSkillsStore.getState().get(importedRow.id)?.imported?.enabled).toBe(true); expect(m.install).toHaveBeenCalledOnce();
});
it("rejects imported edits/removal through legacy APIs and blocks lifecycle mutation during a turn", async () => {
  await expect(useSkillsStore.getState().save(importedRow)).rejects.toThrow("cannot be edited");
  await expect(useSkillsStore.getState().remove(importedRow.id)).rejects.toThrow("removal controls");
  holdImportedSkills("store-test", [importedRow.id]);
  try {
    await expect(useSkillsStore.getState().changePackage(importedRow.id, candidateFixture.id, "disable")).rejects.toThrow("Stop the response");
    expect(m.change).not.toHaveBeenCalled(); expect(useSkillsStore.getState().loaded).toBe(true);
  } finally { releaseImportedSkills("store-test"); }
  expect(m.save).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled();
});
it("failed package hydration never seeds or drops the existing skill view", async () => {
  m.packages.mockRejectedValueOnce(new Error("unknown schema")); await useSkillsStore.getState().load();
  expect(useSkillsStore.getState().loaded).toBe(false); expect(useSkillsStore.getState().get(original.id)).toEqual(original); expect(m.save).not.toHaveBeenCalled();
});

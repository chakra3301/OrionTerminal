import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/agentsDb", () => {
  const mem: any[] = [];
  return {
    listAgents: vi.fn(async () => mem.slice()),
    upsertAgent: vi.fn(async (a: any) => { const i = mem.findIndex((x) => x.id === a.id); if (i >= 0) mem[i] = a; else mem.push(a); }),
    deleteAgent: vi.fn(async (id: string) => { const i = mem.findIndex((x) => x.id === id); if (i >= 0) mem.splice(i, 1); }),
  };
});

import { useAgentsStore } from "./agentsStore";

beforeEach(() => { useAgentsStore.setState({ agents: new Map(), loaded: false }); });

describe("agentsStore", () => {
  it("saves an agent and lists it", async () => {
    await useAgentsStore.getState().save({
      id: "a1", name: "Atlas", role: "", accent: "", avatarAssetId: null, avatarUrl: null,
      brainModel: "claude-opus-4-8", actionModel: "", skillIds: [],
    });
    expect(useAgentsStore.getState().list().map((a) => a.id)).toEqual(["a1"]);
  });

  it("removes an agent", async () => {
    await useAgentsStore.getState().save({ id: "a1", name: "Atlas", role: "", accent: "", avatarAssetId: null, avatarUrl: null, brainModel: "x", actionModel: "", skillIds: [] });
    await useAgentsStore.getState().remove("a1");
    expect(useAgentsStore.getState().list()).toEqual([]);
  });
});

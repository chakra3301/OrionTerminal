import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: any[] = [];
vi.mock("@/lib/agentsDb", () => ({
  listProviders: vi.fn(async () => rows.slice()),
  upsertProvider: vi.fn(async (p: any) => { if (!rows.some((r) => r.id === p.id)) rows.push(p); }),
  deleteProvider: vi.fn(async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); }),
}));

import { useProvidersStore } from "./providersStore";
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER } from "@/features/agents/seedData";

beforeEach(() => { rows.length = 0; useProvidersStore.setState({ providers: [], loaded: false }); });

describe("providersStore seeding", () => {
  it("seeds anthropic + both CLI engines when DB is empty", async () => {
    await useProvidersStore.getState().load();
    const ids = useProvidersStore.getState().providers.map((p) => p.id);
    expect(ids).toContain(BUILTIN_PROVIDER.id);
    expect(ids).toContain(CODEX_CLI_PROVIDER.id);
    expect(ids).toContain(GEMINI_CLI_PROVIDER.id);
  });
  it("is idempotent — second load does not duplicate", async () => {
    await useProvidersStore.getState().load();
    await useProvidersStore.getState().load();
    const codex = useProvidersStore.getState().providers.filter((p) => p.id === CODEX_CLI_PROVIDER.id);
    expect(codex.length).toBe(1);
  });
});

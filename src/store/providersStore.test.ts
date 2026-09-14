import { describe, it, expect, vi, beforeEach } from "vitest";

const rows: any[] = [];
vi.mock("@/lib/agentsDb", () => ({
  listProviders: vi.fn(async () => rows.slice()),
  upsertProvider: vi.fn(async (p: any) => { const i = rows.findIndex((r) => r.id === p.id); if (i < 0) rows.push(p); else rows[i] = p; }),
  deleteProvider: vi.fn(async (id: string) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); }),
}));

import { useProvidersStore } from "./providersStore";
import { upsertProvider } from "@/lib/agentsDb";
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, CURSOR_SDK_PROVIDER, GEMINI_CLI_PROVIDER } from "@/features/agents/seedData";

beforeEach(() => { rows.length = 0; useProvidersStore.setState({ providers: [], loaded: false }); });

describe("providersStore seeding", () => {
  it("persists disconnect across hydration and stale metadata saves", async () => {
    await useProvidersStore.getState().load();
    const stale = useProvidersStore.getState().providers.find((p) => p.id === CODEX_CLI_PROVIDER.id)!;
    await Promise.all([
      useProvidersStore.getState().setEnabled(stale.id, false),
      useProvidersStore.getState().save({ ...stale, baseUrl: "https://example.test" }),
    ]);
    await useProvidersStore.getState().load();
    expect(useProvidersStore.getState().providers.find((p) => p.id === stale.id)?.enabled).toBe(false);
    await useProvidersStore.getState().setEnabled(stale.id, true);
    expect(useProvidersStore.getState().providers.find((p) => p.id === stale.id)?.enabled).toBe(true);
  });
  it("does not pretend a failed disconnect was saved, and retries after failure", async () => {
    await useProvidersStore.getState().load();
    vi.mocked(upsertProvider).mockRejectedValueOnce(new Error("disk full"));
    await expect(useProvidersStore.getState().setEnabled(CODEX_CLI_PROVIDER.id, false)).rejects.toThrow("disk full");
    expect(useProvidersStore.getState().providers.find((p) => p.id === CODEX_CLI_PROVIDER.id)?.enabled).toBe(true);
    await useProvidersStore.getState().setEnabled(CODEX_CLI_PROVIDER.id, false);
    await expect(useProvidersStore.getState().setEnabled("missing", false)).rejects.toThrow("no longer exists");
  });
  it("seeds anthropic + CLI engines + cursor when DB is empty", async () => {
    await useProvidersStore.getState().load();
    const ids = useProvidersStore.getState().providers.map((p) => p.id);
    expect(ids).toContain(BUILTIN_PROVIDER.id);
    expect(ids).toContain(CODEX_CLI_PROVIDER.id);
    expect(ids).toContain(GEMINI_CLI_PROVIDER.id);
    expect(ids).toContain(CURSOR_SDK_PROVIDER.id);
  });
  it("retires obsolete Codex API-only choices without re-enabling a disconnected provider", async () => {
    rows.push({ ...CODEX_CLI_PROVIDER, enabled: false, models: [{ id: "gpt-5.4-mini", label: "Mini" }] });
    await useProvidersStore.getState().load();
    const codex = useProvidersStore.getState().providers.find((p) => p.id === CODEX_CLI_PROVIDER.id)!;
    expect(codex.enabled).toBe(false);
    expect(codex.models.map((m) => m.id)).not.toContain("gpt-5.4-mini");
    expect(codex.models.map((m) => m.id)).toContain("gpt-5.6-terra");
    expect(codex.models.map((m) => m.id)).toContain("gpt-6-astra");
  });
  it("is idempotent — second load does not duplicate", async () => {
    await useProvidersStore.getState().load();
    await useProvidersStore.getState().load();
    const codex = useProvidersStore.getState().providers.filter((p) => p.id === CODEX_CLI_PROVIDER.id);
    expect(codex.length).toBe(1);
  });
});

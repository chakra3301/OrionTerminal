import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/features/agents/agentTypes";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/db", () => ({ getAppState: mocks.get, setAppState: mocks.set }));
vi.mock("@/lib/log", () => ({ log: { warn: vi.fn() } }));
const provider = (id = "api-one", kind: Provider["kind"] = "openai") => ({ id, kind } as Provider);
const snapshot = (id: string, input: number) => ({ type: "usage", usage_run_id: id, usage: { input_tokens: input, output_tokens: 10 } });
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 8, 15));
  mocks.get.mockReset().mockResolvedValue(null); mocks.set.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("run-scoped usage tracking", () => {
  it("replaces repeated snapshots, retains late usage and never crosses provider IDs", async () => {
    const m = await import("./providerUsageStore");
    const finishA = m.beginProviderUsage("a", provider(), "shared-model");
    await m.useProviderUsage.getState().load();
    m.observeProviderUsage(snapshot("a", 100)); m.observeProviderUsage(snapshot("a", 100));
    await vi.advanceTimersByTimeAsync(250); finishA();
    const finishB = m.beginProviderUsage("b", provider("api-two"), "shared-model");
    m.observeProviderUsage(snapshot("a", 200)); m.observeProviderUsage(snapshot("b", 50));
    m.observeProviderUsage(snapshot("unregistered", 999));
    await vi.advanceTimersByTimeAsync(250);
    const records = m.useProviderUsage.getState().records;
    expect(records.find(r => r.id === "a")).toMatchObject({ providerId: "api-one", tokens: { total: 210 } });
    expect(records.find(r => r.id === "b")).toMatchObject({ providerId: "api-two", tokens: { total: 60 } });
    expect(m.useProviderUsage.getState().active).toEqual({ b: "api-two" });
    finishB(); await vi.advanceTimersByTimeAsync(600);
    expect(mocks.set).toHaveBeenCalledWith("provider_usage", expect.objectContaining({ version: 1, records: expect.any(Array) }));
    await vi.advanceTimersByTimeAsync(30_000);
    m.observeProviderUsage(snapshot("a", 1000));
    expect(m.useProviderUsage.getState().records.find(r => r.id === "a")?.tokens?.total).toBe(210);
  });
  it("deduplicates Cursor event replays without losing independent equal-sized turns", async () => {
    const m = await import("./providerUsageStore");
    const finish = m.beginProviderUsage("cursor", provider("cursor", "cursor_sdk"), "composer");
    const event = { usage_run_id: "cursor", usage_sequence: 1, usage: { inputTokens: 20, outputTokens: 10, cacheReadTokens: 40, cacheWriteTokens: 5, totalTokens: 75, reasoningTokens: 8 } };
    m.observeProviderUsage(event); m.observeProviderUsage(event);
    m.observeProviderUsage({ ...event, usage_sequence: 2 }); finish();
    expect(m.useProviderUsage.getState().records[0]?.tokens).toMatchObject({ total: 150, input: 130, output: 20 });
  });
  it("preserves turns arriving while history is loading", async () => {
    let resolve!: (v: unknown) => void;
    mocks.get.mockReturnValue(new Promise(r => { resolve = r; }));
    const m = await import("./providerUsageStore");
    const finish = m.beginProviderUsage("new", provider(), "model");
    m.observeProviderUsage(snapshot("new", 100)); finish();
    resolve({ version: 1, since: Date.now() - 1000, records: [{ ...m.useProviderUsage.getState().records[0], id: "old" }] });
    await m.useProviderUsage.getState().load();
    expect(m.useProviderUsage.getState().records.map(r => r.id).sort()).toEqual(["new", "old"]);
  });
  it("does not overwrite unreadable history or treat missing tokens as zero", async () => {
    mocks.get.mockRejectedValue(new Error("unavailable"));
    const m = await import("./providerUsageStore");
    const finish = m.beginProviderUsage("a", provider(), "model");
    await m.useProviderUsage.getState().load(); finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(m.useProviderUsage.getState().saveError).toContain("not been overwritten");
    expect(m.useProviderUsage.getState().records[0]?.tokens).toBeNull();
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("surfaces a failed save without affecting the AI run", async () => {
    mocks.set.mockRejectedValue(new Error("disk full"));
    const m = await import("./providerUsageStore");
    const finish = m.beginProviderUsage("a", provider(), "model");
    await m.useProviderUsage.getState().load(); finish();
    await vi.advanceTimersByTimeAsync(600);
    expect(m.useProviderUsage.getState().saveError).toContain("wasn't saved");
    expect(m.useProviderUsage.getState().active).toEqual({});
  });
  it("leaves Claude's existing transcript measurement alone", async () => {
    const m = await import("./providerUsageStore");
    m.beginProviderUsage("claude", provider("claude", "anthropic"), "sonnet")();
    expect(m.useProviderUsage.getState().records).toEqual([]);
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

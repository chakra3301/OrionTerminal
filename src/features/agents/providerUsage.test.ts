import { describe, expect, it } from "vitest";
import { addTokenTotals, MAX_USAGE_RECORDS, parseProviderTokens, parseUsageHistory, pruneUsage, usageSummary, type UsageRecord } from "./providerUsage";
const now = Date.UTC(2026, 8, 15);
const record = (patch: Partial<UsageRecord> = {}): UsageRecord => ({ id: "run-a", providerId: "provider-a", kind: "codex_cli", model: "same-model-name", startedAt: now, updatedAt: now, endedAt: now, tokens: { input: 100, output: 20, total: 120, cached: 80, cacheWrite: null }, ...patch });

describe("provider token reports", () => {
  it("does not double-count Codex cache tokens", () => {
    expect(parseProviderTokens("codex_cli", { input_tokens: 100, output_tokens: 20, cached_input_tokens: 80 })).toEqual({ input: 100, output: 20, total: 120, cached: 80, cacheWrite: null });
  });
  it("preserves Gemini's reported total including unclassified thinking tokens", () => {
    expect(parseProviderTokens("gemini_cli", { input_tokens: 100, output_tokens: 20, total_tokens: 140, cached: 80 })?.total).toBe(140);
  });
  it("includes Cursor cache read/write once and never adds reasoning twice", () => {
    expect(parseProviderTokens("cursor_sdk", { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 10, totalTokens: 210, reasoningTokens: 15 })).toEqual({ input: 190, output: 20, total: 210, cached: 80, cacheWrite: 10 });
  });
  it("keeps absent telemetry distinct from zero", () => {
    for (const usage of [null, {}, { input_tokens: 1 }, { input_tokens: -1, output_tokens: 0 }, { input_tokens: "10", output_tokens: 0 }, { input_tokens: NaN, output_tokens: 0 }]) expect(parseProviderTokens("openai", usage)).toBeNull();
    expect(parseProviderTokens("openai", { input_tokens: 0, output_tokens: 0 })?.total).toBe(0);
    expect(parseProviderTokens("anthropic", { input_tokens: 100, output_tokens: 10 })).toBeNull();
  });
  it("adds independent Cursor turns rather than confusing them with snapshots", () => {
    const a = record().tokens!;
    expect(addTokenTotals(a, a).total).toBe(240);
    expect(addTokenTotals(a, a).cacheWrite).toBeNull();
  });
});

describe("bounded local usage history", () => {
  it("isolates provider IDs even when model names are identical", () => {
    const rows = [record(), record({ id: "b", providerId: "provider-b" }), record({ id: "c", tokens: null })];
    expect(usageSummary(rows, "provider-a", 24, now)).toMatchObject({ turns: 2, reported: 1, tokens: { total: 120 } });
    expect(usageSummary(rows, "missing", 24, now).tokens).toBeNull();
  });
  it("expires rolling windows independently", () => {
    const rows = [record({ updatedAt: now - 6 * 3_600_000 })];
    expect(usageSummary(rows, "provider-a", 5, now).turns).toBe(0);
    expect(usageSummary(rows, "provider-a", 24, now).turns).toBe(1);
  });
  it("bounds retained data and exposes incomplete windows after truncation", () => {
    const rows = Array.from({ length: MAX_USAGE_RECORDS + 5 }, (_, n) => record({ id: String(n), updatedAt: now - n }));
    const limited = pruneUsage(rows, now);
    expect(limited.records).toHaveLength(MAX_USAGE_RECORDS);
    expect(limited.limitedUntil).toBeGreaterThan(now);
    expect(pruneUsage([record({ updatedAt: now - 49 * 3_600_000 })], now).records).toEqual([]);
  });
  it("round-trips real timestamps and strips unrelated/private fields", () => {
    const parsed = parseUsageHistory({ version: 1, since: now, records: [{ ...record(), prompt: "must not persist", key: "must not persist" }] });
    expect(parsed.records).toEqual([record()]);
  });
  it("rejects corrupt history rather than silently overwriting it", () => {
    expect(() => parseUsageHistory({ version: 2, records: [] })).toThrow();
    expect(() => parseUsageHistory({ version: 1, since: now, records: [record(), record()] })).toThrow();
    expect(() => parseUsageHistory({ version: 1, since: now, records: [record({ tokens: { ...record().tokens!, total: Infinity } })] })).toThrow();
  });
});

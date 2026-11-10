import type { ProviderKind } from "./agentTypes";

export type TokenTotals = { input: number; output: number; total: number; cached: number | null; cacheWrite: number | null };
export type UsageRecord = {
  id: string; providerId: string; kind: ProviderKind; model: string;
  startedAt: number; updatedAt: number; endedAt: number | null; tokens: TokenTotals | null;
};
export const USAGE_RETENTION_MS = 48 * 3_600_000;
export const MAX_USAGE_RECORDS = 2048;
const obj = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
export const count = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 1e13 ? v : null;

/** Input includes cached input; reasoning is never added again to output. */
export function parseProviderTokens(kind: ProviderKind, value: unknown): TokenTotals | null {
  const v = obj(value);
  if (!v) return null;
  if (kind === "cursor_sdk") {
    const input = count(v.inputTokens), output = count(v.outputTokens);
    const cached = count(v.cacheReadTokens), cacheWrite = count(v.cacheWriteTokens);
    if (input == null || output == null || cached == null || cacheWrite == null) return null;
    const allInput = input + cached + cacheWrite;
    return { input: allInput, output, cached, cacheWrite, total: count(v.totalTokens) ?? allInput + output };
  }
  if (kind === "anthropic") return null;
  const input = count(v.input_tokens), output = count(v.output_tokens);
  if (input == null || output == null) return null;
  const cached = count(kind === "gemini_cli" ? v.cached : v.cached_input_tokens);
  return { input, output, cached, cacheWrite: null, total: count(v.total_tokens) ?? input + output };
}

export function addTokenTotals(a: TokenTotals | null, b: TokenTotals): TokenTotals {
  if (!a) return b;
  const sumOptional = (x: number | null, y: number | null) => x == null && y == null ? null : (x ?? 0) + (y ?? 0);
  return { input: a.input + b.input, output: a.output + b.output, total: a.total + b.total, cached: sumOptional(a.cached, b.cached), cacheWrite: sumOptional(a.cacheWrite, b.cacheWrite) };
}

export function pruneUsage(records: UsageRecord[], now: number) {
  const ordered = records.filter(r => r.updatedAt >= now - USAGE_RETENTION_MS).sort((a, b) => b.updatedAt - a.updatedAt);
  const removed = ordered.slice(MAX_USAGE_RECORDS);
  return { records: ordered.slice(0, MAX_USAGE_RECORDS), limitedUntil: removed.length ? Math.max(...removed.map(r => r.updatedAt)) + 24 * 3_600_000 : 0 };
}

export function usageSummary(records: UsageRecord[], providerId: string, hours: number, now: number) {
  const selected = records.filter(r => r.providerId === providerId && r.updatedAt >= now - hours * 3_600_000);
  const reported = selected.filter(r => r.tokens != null);
  return { turns: selected.length, reported: reported.length, tokens: reported.reduce<TokenTotals | null>((total, r) => addTokenTotals(total, r.tokens!), null) };
}

export function parseUsageHistory(value: unknown): { since: number; limitedUntil: number; records: UsageRecord[] } {
  if (value == null) return { since: Date.now(), limitedUntil: 0, records: [] };
  const v = obj(value);
  if (!v || v.version !== 1 || count(v.since) == null || !Array.isArray(v.records) || v.records.length > MAX_USAGE_RECORDS) throw new Error("Invalid usage history");
  const kinds = ["anthropic", "openai", "google", "openai_compat", "custom", "codex_cli", "gemini_cli", "cursor_sdk", "nous_oauth"];
  const ids = new Set<string>();
  const records = v.records.map(raw => {
    const r = obj(raw);
    if (!r || typeof r.id !== "string" || r.id.length > 100 || ids.has(r.id) || typeof r.providerId !== "string" || r.providerId.length > 512 || typeof r.model !== "string" || r.model.length > 256 || !kinds.includes(String(r.kind)) || count(r.startedAt) == null || count(r.updatedAt) == null || (r.endedAt != null && count(r.endedAt) == null)) throw new Error("Invalid usage record");
    ids.add(r.id);
    const t = obj(r.tokens);
    if (r.tokens != null && (!t || [t.input, t.output, t.total].some(n => count(n) == null) || [t.cached, t.cacheWrite].some(n => n != null && count(n) == null))) throw new Error("Invalid usage totals");
    return { id: r.id, providerId: r.providerId, kind: r.kind as ProviderKind, model: r.model, startedAt: r.startedAt as number, updatedAt: r.updatedAt as number, endedAt: r.endedAt as number | null, tokens: t ? { input: t.input as number, output: t.output as number, total: t.total as number, cached: t.cached as number | null, cacheWrite: t.cacheWrite as number | null } : null };
  });
  return { since: v.since as number, limitedUntil: count(v.limitedUntil) ?? 0, records };
}

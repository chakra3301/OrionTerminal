import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Provider } from "@/features/agents/agentTypes";
import type { SubscriptionQuota } from "@/lib/ipc";
import { accountDays, quotaWindowState, subscriptionQuotaCells } from "./subscriptionQuotaCells";
import type { MonitorCell } from "./monitorCells";
const now = new Date(2026, 8, 15, 12).getTime();
const provider: Provider = { id: "builtin:codex-cli", kind: "codex_cli", name: "Codex", enabled: true, builtin: true, keyRef: "", baseUrl: "", models: [] };
const cell: MonitorCell = { id: "provider:builtin%3Acodex-cli", title: "Codex usage", label: "Codex", value: "999k", percent: null, accent: "#fff", icon: null, detail: <span>Local run tokens</span> };
const snapshot = (): SubscriptionQuota => ({ status: "ok", message: null, plan: "pro_lite", fetchedAt: now, retryAt: now + 60_000,
  windows: [{ id: "primary", label: "5-hour limit", usedPercent: 100, resetAt: now + 3600000, windowSeconds: 18000 }, { id: "secondary", label: "Weekly limit", usedPercent: 38, resetAt: now + .872 * 604800000, windowSeconds: 604800 }],
  resetCredits: { availableCount: 2, expiresAt: ["2026-10-03T00:00:00Z"] },
  profile: { lifetime_tokens: 28700000, peak_daily_tokens: 21000000, longest_running_turn_sec: 120, current_streak_days: 2, longest_streak_days: 3, daily_usage_buckets: [{ start_date: "2026-09-15", tokens: 21000000 }, { start_date: "2026-09-14", tokens: 600000 }] },
});
const reading = (value: SubscriptionQuota) => ({ [provider.id]: { value, loading: false, error: null } });

describe("subscription quotas match the account rather than local tokens", () => {
  it("shows session and weekly percentage rings under one provider preference", () => {
    const rows = subscriptionQuotaCells([cell], [provider], reading(snapshot()), now, () => {});
    expect(rows.map(c => c.value)).toEqual(["100%", "38%"]);
    expect(rows.every(c => c.preferenceId === cell.id)).toBe(true);
    expect(new Set(rows.map(c => c.id)).size).toBe(2);
    const html = renderToStaticMarkup(<>{rows[1]!.detail}</>);
    for (const label of ["62%", "25.2%", "deficit", "2 unused resets", "Lifetime tokens", "28.7M", "21.0M", "21.6M", "pro lite"]) expect(html).toContain(label);
  });
  it("derives remaining and pacing only from a real window", () => {
    const state = quotaWindowState(snapshot().windows[1]!, now);
    expect(state.remaining).toBe(62); expect(state.deficit).toBeCloseTo(25.2);
    expect(quotaWindowState({ ...snapshot().windows[1]!, resetAt: null }, now).deficit).toBeNull();
  });
  it("never presents an expired window's old percentage as current", () => {
    const q = snapshot(); q.windows[0]!.resetAt = now - 1;
    const rows = subscriptionQuotaCells([cell], [provider], reading(q), now, () => {});
    expect(rows[0]?.percent).toBeNull(); expect(rows[0]?.value).toBe("—");
    expect(rows[1]?.value).toBe("38%");
  });
  it("does not replace missing account quotas with local token counts or promote extra limits", () => {
    const q = snapshot(); q.windows = [{ ...q.windows[0]!, id: "extra-spark" }];
    const rows = subscriptionQuotaCells([cell], [provider], reading(q), now, () => {});
    expect(rows[0]?.value).toBe("—");
    expect(subscriptionQuotaCells([cell], [provider], {}, now, () => {})[0]?.value).toBe("—");
  });
  it("uses actual account daily buckets, preserving an unpublished today as unknown", () => {
    const q = snapshot();
    expect(accountDays(q.profile, now)).toMatchObject({ today: 21000000, total: 21600000 });
    expect(accountDays(q.profile, now + 86400000)?.today).toBeNull();
    expect(accountDays(null, now)).toBeNull();
  });
  it("surfaces keychain permission without starting another login or model", () => {
    const q = { ...snapshot(), status: "keychain_access" as const, windows: [], message: "Permission required" };
    const rows = subscriptionQuotaCells([cell], [provider], reading(q), now, () => {});
    expect(renderToStaticMarkup(<>{rows[0]?.detail}</>)).toContain("Allow keychain access");
  });
});

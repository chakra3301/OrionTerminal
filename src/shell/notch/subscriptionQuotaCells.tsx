import type { ReactNode } from "react";
import type { Provider } from "@/features/agents/agentTypes";
import type { QuotaWindow, SubscriptionQuota } from "@/lib/ipc";
import type { MonitorCell } from "./monitorCells";
import { providerMetricId } from "./notchPreferences";
import type { QuotaReading } from "./useSubscriptionQuotas";

const tokens = (n: number | null | undefined) => n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
const pct = (n: number) => `${Math.round(n * 10) / 10}%`;
export const resetTime = (w: QuotaWindow) => w.resetAt == null ? null : new Date(w.resetAt).getTime();
export function quotaWindowState(w: QuotaWindow, now: number) {
  const reset = resetTime(w);
  const expired = reset != null && Number.isFinite(reset) && reset <= now;
  const used = Math.max(0, Math.min(100, w.usedPercent));
  const elapsed = w.windowSeconds && reset != null && Number.isFinite(reset) ? Math.max(0, Math.min(100, (1 - (reset - now) / (w.windowSeconds * 1000)) * 100)) : null;
  return { used, remaining: 100 - used, expired, deficit: !expired && elapsed != null ? used - elapsed : null };
}
function duration(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / 60000));
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
function dayKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
export function accountDays(profile: SubscriptionQuota["profile"], now: number) {
  if (!profile?.daily_usage_buckets) return null;
  const values = new Map(profile.daily_usage_buckets.map(d => [d.start_date, d.tokens]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(now); date.setDate(date.getDate() - 29 + i);
    const key = dayKey(date); return { key, value: values.get(key) ?? 0 };
  });
  return { days, today: values.get(dayKey(new Date(now))) ?? null, total: days.reduce((n, d) => n + d.value, 0) };
}
function WindowMeter({ window: w, now }: { window: QuotaWindow; now: number }) {
  const { used, remaining, expired, deficit } = quotaWindowState(w, now);
  const reset = resetTime(w);
  return <div className="ot-notch-meter ot-notch-quota-meter">
    <div className="ot-notch-row"><strong>{w.label}</strong><span className="ot-notch-reset">{reset != null && Number.isFinite(reset) ? expired ? "Reset reached" : `Resets in ${duration(reset - now)}` : "Reset not reported"}</span></div>
    <div className="ot-notch-track" role={expired ? undefined : "meter"} aria-label={`${w.label} used`} aria-valuemin={expired ? undefined : 0} aria-valuemax={expired ? undefined : 100} aria-valuenow={expired ? undefined : used}><div style={{ width: `${expired ? 0 : used}%`, background: used >= 90 ? "#ff4d00" : used >= 70 ? "#e5f52b" : undefined }} /></div>
    <div className="ot-notch-used">{expired ? "Refreshing subscription window…" : <>{pct(used)} Used · {pct(remaining)} left{deficit != null && Math.abs(deficit) >= .1 && <> · <span className={deficit > 0 ? "ot-quota-deficit" : "ot-quota-surplus"} title="Compared with the share of this window's allowance corresponding to elapsed time">{pct(Math.abs(deficit))} {deficit > 0 ? "deficit" : "surplus"}</span></>}</>}</div>
  </div>;
}
function QuotaDetail({ reading, window, now, local, allowKeychain, codex }: { reading?: QuotaReading; window?: QuotaWindow; now: number; local: ReactNode; allowKeychain: () => void; codex: boolean }) {
  const q = reading?.value;
  const profile = q?.profile;
  const days = accountDays(profile ?? null, now);
  const peak = Math.max(1, ...(days?.days.map(d => d.value) ?? []));
  const expiry = q?.resetCredits?.expiresAt.map(date => new Date(date).getTime()).filter(n => Number.isFinite(n) && n > now).sort((a, b) => a - b)[0];
  const extra = q?.windows.filter(w => w.id !== "primary" && w.id !== "secondary") ?? [];
  return <>
    {q?.plan && <div className="ot-notch-quota-plan">{q.plan.replaceAll("_", " ")}</div>}
    {window && q?.status === "ok" ? <WindowMeter window={window} now={now} /> : <p className="ot-notch-note ot-notch-note-first" role="status">{reading?.loading ? "Reading subscription limits…" : reading?.error ?? q?.message ?? (q ? "No account-wide quota window was reported." : "Waiting for subscription limits…")}</p>}
    {q?.status === "keychain_access" && <button type="button" className="ot-notch-quota-allow" disabled={reading?.loading} onClick={allowKeychain}>{reading?.loading ? "Requesting access…" : "Allow keychain access"}</button>}
    {q?.status === "rate_limited" && q.retryAt && <p className="ot-notch-note">Retrying in {duration(q.retryAt - now)}</p>}
    {codex && q?.status === "ok" && <>
      <section className="ot-notch-quota-section"><strong>Unused resets</strong><div>{q.resetCredits ? `${q.resetCredits.availableCount} unused ${q.resetCredits.availableCount === 1 ? "reset" : "resets"}` : "Not reported"}</div>{expiry && <small>Next expires {new Date(expiry).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small>}</section>
      <section className="ot-notch-quota-section">
        {[ ["Lifetime tokens", tokens(profile?.lifetime_tokens)], ["Peak tokens", tokens(profile?.peak_daily_tokens)], ["Longest chat", profile?.longest_running_turn_sec == null ? "—" : duration(profile.longest_running_turn_sec * 1000)], ["Current streak", profile?.current_streak_days == null ? "—" : `${profile.current_streak_days}d`], ["Longest streak", profile?.longest_streak_days == null ? "—" : `${profile.longest_streak_days}d`] ].map(([label, value]) => <div className="ot-notch-row" key={label}><span>{label}</span><span>{value}</span></div>)}
        {!profile && <small>Account statistics unavailable</small>}
      </section>
      <section className="ot-notch-quota-section"><div className="ot-notch-row"><span>Today</span><span>{tokens(days?.today)}</span></div><div className="ot-notch-row"><span>30-day tokens</span><span>{tokens(days?.total)}</span></div>
        {days && <div className="ot-notch-account-chart" role="img" aria-label="Account token usage for the last 30 calendar days">{days.days.map(d => <span key={d.key} title={`${d.key}: ${tokens(d.value)} tokens`} style={{ height: `${Math.max(1, d.value / peak * 100)}%`, opacity: d.value ? .65 : .12 }} />)}</div>}
      </section>
    </>}
    {extra.length > 0 && <details className="ot-notch-quota-local"><summary>Additional limits</summary>{extra.map(w => <WindowMeter key={w.id} window={w} now={now} />)}</details>}
    <div className="ot-notch-quota-footer">
      {q?.fetchedAt && q.status === "ok" && <p className="ot-notch-quota-updated" title="Last account reading">Updated · {new Date(q.fetchedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</p>}
      <details className="ot-notch-quota-local"><summary>{codex ? "Orion-only activity" : "Local CLI activity"}</summary>{local}</details>
    </div>
  </>;
}

export function subscriptionQuotaCells(cells: MonitorCell[], providers: Provider[], readings: Record<string, QuotaReading>, now: number, allowKeychain: (providerId: string) => void): MonitorCell[] {
  return cells.flatMap(cell => {
    const p = providers.find(p => p.enabled && ((p.kind === "anthropic" && cell.id === "claude") || (p.kind === "codex_cli" && cell.id === providerMetricId(p.id))));
    if (!p) return [cell];
    const reading = readings[p.id];
    const q = reading?.value;
    const main = q?.status === "ok" ? q.windows.filter(w => w.id === "primary" || w.id === "secondary") : [];
    const rows: (QuotaWindow | undefined)[] = main.length ? main : [undefined];
    return rows.map(w => {
      const state = w ? quotaWindowState(w, now) : null;
      const used = state && !state.expired ? state.used : null;
      return {
        ...cell,
        id: w ? `quota:${encodeURIComponent(p.id)}/${w.id}` : cell.id,
        preferenceId: w ? cell.id : undefined,
        title: cell.title.replace(/ usage$/, " Usage"),
        label: w?.id === "secondary" ? "Weekly used" : "Session used",
        value: used == null ? "—" : `${Math.round(used)}%`, percent: used,
        accessibleValue: w && used != null ? `${w.label}: ${pct(used)} used; ${pct(100 - used)} remaining` : "Subscription quota unavailable",
        detail: <QuotaDetail reading={reading} window={w} now={now} local={cell.detail} allowKeychain={() => allowKeychain(p.id)} codex={p.kind === "codex_cli"} />,
      } satisfies MonitorCell;
    });
  });
}

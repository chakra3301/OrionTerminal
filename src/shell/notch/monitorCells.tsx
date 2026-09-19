import { Cpu, MemoryStick } from "lucide-react";
import { ProviderLogo, providerBrand } from "./ProviderLogo";
import type { Provider } from "@/features/agents/agentTypes";
import { usageSummary, type UsageRecord } from "@/features/agents/providerUsage";
import type { ReactNode } from "react";
import type { useMonitorReadings } from "../useMonitorReadings";
import { providerMetricId, type Metric } from "./notchPreferences";

export type MonitorCell = { id: Metric; preferenceId?: Metric; title: string; label: string; value: string; percent: number | null; accent: string; icon: ReactNode; detail: ReactNode; accessibleValue?: string; active?: boolean };
const percent = (n: number | null | undefined) => n == null || !Number.isFinite(n) ? null : Math.min(100, Math.max(0, n));
const fmtPct = (n: number | null) => n == null ? "—" : `${Math.round(n)}%`;
const bytes = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
const tokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

function Meter({ label, value, reset }: { label: string; value: number | null; reset?: string | null }) {
  return <div className="ot-notch-meter">
    <div className="ot-notch-row"><span>{label}</span>{reset && <span className="ot-notch-reset">Resets {reset}</span>}</div>
    <div className="ot-notch-track" aria-hidden="true"><div style={{ width: `${value ?? 0}%`, background: value != null && value >= 90 ? "#ff4d00" : value != null && value >= 70 ? "#e5f52b" : undefined }} /></div>
    <div className="ot-notch-used">{value == null ? "Unavailable" : `${Math.round(value)}% used`}</div>
  </div>;
}

export function providerCells(providers: Provider[], records: UsageRecord[], active: Record<string, string>, now: number, saveError: string | null, limitedUntil: number): MonitorCell[] {
  return providers.filter(p => p.enabled && p.kind !== "anthropic").map(provider => {
    const day = usageSummary(records, provider.id, 24, now);
    const recent = usageSummary(records, provider.id, 5, now);
    const activeCount = Object.values(active).filter(id => id === provider.id).length;
    const name = provider.kind === "codex_cli" ? "Codex" : provider.kind === "gemini_cli" ? "Gemini" : provider.kind === "cursor_sdk" ? "Cursor" : provider.name;
    const last = records.find(r => r.providerId === provider.id);
    const icon = <ProviderLogo brand={providerBrand(provider)} name={provider.name} />;
    return {
      id: providerMetricId(provider.id), title: `${name} usage`, label: name, icon,
      value: day.tokens ? tokens(day.tokens.total) : `${day.turns} runs`, percent: null,
      accent: provider.kind === "gemini_cli" || provider.kind === "google" ? "#89aaff" : provider.kind === "cursor_sdk" ? "#eee" : "#77dfbd",
      active: activeCount > 0,
      accessibleValue: `${day.tokens ? `${tokens(day.tokens.total)} reported tokens` : `${day.turns} tracked runs`} in Orion over 24 hours; ${activeCount} active; account quota unavailable`,
      detail: <>
        <p className="ot-notch-note ot-notch-note-first">{activeCount ? `${activeCount} active ${activeCount === 1 ? "run" : "runs"} in Orion` : "Orion chat/agent activity"}</p>
        <div className="ot-notch-token-totals"><div><span>Last 5h · tokens</span><strong>{recent.tokens ? tokens(recent.tokens.total) : "—"}</strong></div><div><span>Last 24h · tokens</span><strong>{day.tokens ? tokens(day.tokens.total) : "—"}</strong></div></div>
        <div className="ot-notch-row"><span>Input / output · 24h</span><span>{day.tokens ? `${tokens(day.tokens.input)} / ${tokens(day.tokens.output)}` : "Not reported"}</span></div>
        {day.tokens?.cached != null && <div className="ot-notch-row"><span>Cached input · 24h</span><span>{tokens(day.tokens.cached)}</span></div>}
        <div className="ot-notch-row"><span>Runs with token reports</span><span>{day.reported} / {day.turns}</span></div>
        {last && <div className="ot-notch-row ot-notch-model"><span>Last model</span><span title={last.model}>{last.model}</span></div>}
        <p className="ot-notch-note">{day.turns ? "Chat/agent reports only, not a quota or bill. Image generation, inline edits and external activity aren't included." : "Tracking begins with your next Orion run. No account history is imported."}</p>
        {limitedUntil > now && <p className="ot-notch-note">History limit reached; totals cover retained runs only.</p>}
        {saveError && <p className="ot-notch-note" role="status">{saveError}</p>}
      </>,
    };
  });
}

export function monitorCells({ system, usage, limits }: ReturnType<typeof useMonitorReadings>, claudeEnabled = true): MonitorCell[] {
  const sys = system.value;
  const cpu = percent(sys?.cpu_percent);
  const memory = percent(sys && sys.mem_total > 0 ? sys.mem_used / sys.mem_total * 100 : null);
  const live = limits.value?.ok ? limits.value : null;
  const session = percent(live?.session_pct);
  const block = usage.value?.block;
  const day = usage.value?.last_24h;
  const total = (w: NonNullable<typeof block>) => w.input + w.output + w.cache_creation + w.cache_read;
  const cells: MonitorCell[] = [
    { id: "cpu", title: "CPU activity", label: "CPU", value: fmtPct(cpu), percent: cpu, accent: "var(--neon-cyan)", icon: <Cpu />, detail: <>
      <Meter label="Processor load" value={cpu} />
      <div className="ot-notch-row"><span>Logical processors</span><span>{sys?.cpu_count ?? "—"}</span></div>
      <p className="ot-notch-note">{system.status === "error" ? "Reading unavailable · retrying" : system.status === "loading" ? "Reading system activity…" : "All processes · updated every 2s"}</p>
    </> },
    { id: "memory", title: "Memory usage", label: "RAM", value: fmtPct(memory), percent: memory, accent: "var(--neon-violet)", icon: <MemoryStick />, detail: <>
      <Meter label="System memory" value={memory} />
      <div className="ot-notch-row"><span>Used / total</span><span>{sys ? `${bytes(sys.mem_used)} / ${bytes(sys.mem_total)}` : "—"}</span></div>
      <div className="ot-notch-row"><span>Remaining</span><span>{sys ? bytes(Math.max(0, sys.mem_total - sys.mem_used)) : "—"}</span></div>
      <p className="ot-notch-note">{system.status === "error" ? "Reading unavailable · retrying" : "Memory usage, not memory pressure"}</p>
    </> },
    { id: "claude", title: "Claude usage", label: session == null ? "5h tokens" : "Claude", value: session != null ? fmtPct(session) : block ? tokens(total(block)) : "—", percent: session, accent: "var(--neon-green)", icon: <ProviderLogo brand="claude" />,
      accessibleValue: session == null ? `${block ? tokens(total(block)) : "Unavailable"} local tokens; live quota unavailable` : fmtPct(session),
      detail: <>
        {live ? <>
          <Meter label="Current session" value={session} reset={live.session_reset} />
          <Meter label="All models · week" value={percent(live.week_pct)} reset={live.week_reset} />
          {live.week_sonnet_pct != null && <Meter label="Sonnet · week" value={percent(live.week_sonnet_pct)} reset={live.week_sonnet_reset} />}
        </> : <p className="ot-notch-note ot-notch-note-first">Claude Code local activity</p>}
        <div className="ot-notch-token-totals"><div><span>5h block</span><strong>{block ? tokens(total(block)) : "—"}</strong></div><div><span>Last 24h</span><strong>{day ? tokens(total(day)) : "—"}</strong></div></div>
        <div className="ot-notch-row"><span>Input / output · 5h</span><span>{block ? `${tokens(block.input)} / ${tokens(block.output)}` : "—"}</span></div>
        <div className="ot-notch-row"><span>Cache write / read</span><span>{block ? `${tokens(block.cache_creation)} / ${tokens(block.cache_read)}` : "—"}</span></div>
        <p className="ot-notch-note">{usage.status === "error" ? "Local reading unavailable · retrying" : usage.status === "loading" ? "Reading local transcripts…" : "Claude Code only. Includes cache tokens; not a billing total or quota percentage."}</p>
      </> },
  ];
  return cells.filter(cell => cell.id !== "claude" || claudeEnabled);
}

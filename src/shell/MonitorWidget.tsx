import { useEffect, useRef, useState } from "react";
import { Activity, Minus } from "lucide-react";
import { ipc, type SystemStats, type ClaudeUsage } from "@/lib/ipc";
import { getAppState, setAppState } from "@/lib/db";
import { useDraggable } from "@/shell/useDraggable";
import { log } from "@/lib/log";

const SYS_POLL_MS = 2000;
const USAGE_POLL_MS = 30_000;
const FIVE_H_MS = 5 * 3_600_000;
// Calibratable ceiling for the 5h limit gauge, in estimated USD (cost is the
// best local proxy for Anthropic's weighted limit — it discounts cache reads
// and accounts for model). No official number exists; the user tunes this by
// noting the figure when they actually hit the cap. Default is a placeholder.
const DEFAULT_BUDGET_USD = 25;

type Pos = { x: number; y: number };

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function fmtBytes(n: number): string {
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

function Bar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div className="ot-mon-bar">
      <div
        className="ot-mon-bar-fill"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: tone }}
      />
    </div>
  );
}

export function MonitorWidget() {
  const [pos, setPos] = useState<Pos | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [budget, setBudget] = useState(DEFAULT_BUDGET_USD);
  const [editingBudget, setEditingBudget] = useState(false);
  const [sys, setSys] = useState<SystemStats | null>(null);
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);
  const [now, setNow] = useState(Date.now());
  const posRef = useRef<Pos>({ x: 0, y: 0 });

  // Hydrate persisted position + collapsed + budget once.
  useEffect(() => {
    void getAppState<{ pos: Pos; collapsed?: boolean; budget?: number }>(
      "widget.monitor",
    ).then((v) => {
      const init = v?.pos ?? { x: window.innerWidth - 280, y: 52 };
      posRef.current = init;
      setPos(init);
      if (v?.collapsed) setCollapsed(true);
      if (typeof v?.budget === "number" && v.budget > 0) setBudget(v.budget);
    });
  }, []);

  // Poll only while expanded.
  useEffect(() => {
    if (collapsed || !pos) return;
    let alive = true;
    const pullSys = () =>
      ipc.systemStats().then((s) => alive && setSys(s)).catch(() => undefined);
    const pullUsage = () =>
      ipc.claudeUsage().then((u) => alive && setUsage(u)).catch(() => undefined);
    pullSys();
    pullUsage();
    const a = setInterval(pullSys, SYS_POLL_MS);
    const b = setInterval(pullUsage, USAGE_POLL_MS);
    const c = setInterval(() => alive && setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
    };
  }, [collapsed, pos]);

  const persist = (next: Partial<{ pos: Pos; collapsed: boolean; budget: number }>) => {
    void setAppState("widget.monitor", {
      pos: next.pos ?? posRef.current,
      collapsed: next.collapsed ?? collapsed,
      budget: next.budget ?? budget,
    }).catch((e) => log.warn("monitor widget persist failed", e));
  };

  const { onMouseDown } = useDraggable({
    onDrag: (dx, dy) => {
      const base = posRef.current;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 60, base.x + dx)),
        y: Math.max(28, Math.min(window.innerHeight - 48, base.y + dy)),
      });
    },
    onEnd: () => {
      if (pos) {
        posRef.current = pos;
        persist({ pos });
      }
    },
  });

  if (!pos) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        className="ot-mon-pill"
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={onMouseDown}
        onClick={() => {
          setCollapsed(false);
          persist({ collapsed: false });
        }}
        title="Show monitor"
      >
        <Activity size={13} />
      </button>
    );
  }

  const memPct = sys ? (sys.mem_used / sys.mem_total) * 100 : 0;
  const block = usage?.block;
  const w24 = usage?.last_24h;
  const active = !!usage && usage.block_start_ms > 0;
  const cost5 = active ? block!.cost_usd : 0;
  const usedPct = (cost5 / budget) * 100;
  const tok5 = block ? block.input + block.output + block.cache_creation + block.cache_read : 0;
  const tok24 = w24 ? w24.input + w24.output + w24.cache_creation + w24.cache_read : 0;
  const resetMs = active ? usage!.block_start_ms + FIVE_H_MS - now : 0;
  const usedTone =
    usedPct >= 90 ? "var(--neon-magenta)" : usedPct >= 70 ? "var(--neon-yellow)" : "var(--neon-green)";

  return (
    <div
      className="ot-mon-widget"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={onMouseDown}
    >
      <div className="ot-mon-head">
        <Activity size={11} />
        <span className="ot-mon-title">MONITOR</span>
        <button
          type="button"
          className="ot-mon-close"
          data-no-drag
          title="Collapse"
          onClick={() => {
            setCollapsed(true);
            persist({ collapsed: true });
          }}
        >
          <Minus size={11} />
        </button>
      </div>

      <div className="ot-mon-section">
        <div className="ot-mon-row">
          <span className="ot-mon-label">CPU</span>
          <span className="ot-mon-val">{sys ? `${sys.cpu_percent.toFixed(0)}%` : "—"}</span>
        </div>
        <Bar pct={sys?.cpu_percent ?? 0} tone="var(--neon-cyan)" />
        <div className="ot-mon-row">
          <span className="ot-mon-label">RAM</span>
          <span className="ot-mon-val">
            {sys ? `${fmtBytes(sys.mem_used)} / ${fmtBytes(sys.mem_total)}` : "—"}
          </span>
        </div>
        <Bar pct={memPct} tone="var(--neon-violet)" />
      </div>

      <div className="ot-mon-section">
        <div className="ot-mon-row">
          <span className="ot-mon-label">CLAUDE · 5h limit</span>
          <span className="ot-mon-val" style={{ color: usedTone }}>
            {usage ? `${usedPct.toFixed(0)}%` : "—"}
          </span>
        </div>
        <Bar pct={usedPct} tone={usedTone} />
        <div className="ot-mon-row ot-mon-sub" data-no-drag>
          <span>
            ${cost5.toFixed(2)} / $
            {editingBudget ? (
              <input
                className="ot-mon-budget-input"
                type="number"
                min={1}
                defaultValue={budget}
                autoFocus
                onBlur={(e) => {
                  const v = Math.max(1, Number(e.target.value) || budget);
                  setBudget(v);
                  setEditingBudget(false);
                  persist({ budget: v });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingBudget(false);
                }}
              />
            ) : (
              <span
                className="ot-mon-budget"
                title="Click to set your 5h ceiling (calibrate when you hit the cap)"
                onClick={() => setEditingBudget(true)}
              >
                {budget}
              </span>
            )}
          </span>
          <span>{active ? `resets ${fmtCountdown(resetMs)}` : "window clear"}</span>
        </div>
        <div className="ot-mon-row ot-mon-sub">
          <span>{fmtTokens(tok5)} tok · 5h</span>
          <span>{w24 ? `${fmtTokens(tok24)} · $${w24.cost_usd.toFixed(2)} · 24h` : ""}</span>
        </div>
      </div>
    </div>
  );
}

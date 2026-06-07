import { useEffect, useRef, useState } from "react";
import { Activity, Minus } from "lucide-react";
import { ipc, type SystemStats, type ClaudeUsage } from "@/lib/ipc";
import { getAppState, setAppState } from "@/lib/db";
import { useDraggable } from "@/shell/useDraggable";
import { log } from "@/lib/log";

const SYS_POLL_MS = 2000;
const USAGE_POLL_MS = 30_000;
// Rough capacity anchor for the 5h gauge — not an official limit (Anthropic
// doesn't publish one), just a reference so the bar means something. Opus-
// weighted tokens; tune to taste.
const FIVE_H_REF_TOKENS = 12_000_000;

type Pos = { x: number; y: number };

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function fmtBytes(n: number): string {
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
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
  const [sys, setSys] = useState<SystemStats | null>(null);
  const [usage, setUsage] = useState<ClaudeUsage | null>(null);
  const posRef = useRef<Pos>({ x: 0, y: 0 });

  // Hydrate persisted position + collapsed state once.
  useEffect(() => {
    void getAppState<{ pos: Pos; collapsed?: boolean }>("widget.monitor").then((v) => {
      const init = v?.pos ?? { x: window.innerWidth - 268, y: 52 };
      posRef.current = init;
      setPos(init);
      if (v?.collapsed) setCollapsed(true);
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
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, [collapsed, pos]);

  const persist = (next: Partial<{ pos: Pos; collapsed: boolean }>) => {
    void setAppState("widget.monitor", {
      pos: next.pos ?? posRef.current,
      collapsed: next.collapsed ?? collapsed,
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
  const w5 = usage?.last_5h;
  const w24 = usage?.last_24h;
  const tok5 = w5 ? w5.input + w5.output + w5.cache_creation + w5.cache_read : 0;
  const tok24 = w24 ? w24.input + w24.output + w24.cache_creation + w24.cache_read : 0;

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
          <span className="ot-mon-val">
            {sys ? `${sys.cpu_percent.toFixed(0)}%` : "—"}
          </span>
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
          <span className="ot-mon-label">CLAUDE · 5h</span>
          <span className="ot-mon-val">{w5 ? `${fmtTokens(tok5)} tok` : "—"}</span>
        </div>
        <Bar pct={(tok5 / FIVE_H_REF_TOKENS) * 100} tone="var(--neon-green)" />
        <div className="ot-mon-row ot-mon-sub">
          <span>${w5 ? w5.cost_usd.toFixed(2) : "0.00"} this 5h</span>
          <span>{w24 ? `${fmtTokens(tok24)} · $${w24.cost_usd.toFixed(2)} · 24h` : ""}</span>
        </div>
      </div>
    </div>
  );
}

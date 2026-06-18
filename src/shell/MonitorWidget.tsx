import { useEffect, useRef, useState } from "react";
import { Activity, Minus } from "lucide-react";
import { ipc, type SystemStats, type ClaudeUsage, type ClaudeLimits } from "@/lib/ipc";
import { getAppState, setAppState } from "@/lib/db";
import { useDraggable } from "@/shell/useDraggable";
import { log } from "@/lib/log";

const SYS_POLL_MS = 2000;
const USAGE_POLL_MS = 30_000;
// The real `/usage` scrape spawns a `claude` subprocess (~2–4s) and the
// numbers move slowly, so poll it far less often than the local file read.
const LIMITS_POLL_MS = 90_000;

type Pos = { x: number; y: number };

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function fmtBytes(n: number): string {
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

// "Jun 18 at 11:09pm (Asia/Tokyo)" → "11:09pm". Drops the timezone suffix and,
// when present, the leading date so the compact gauge shows just the time.
function shortReset(s: string | null | undefined): string | null {
  if (!s) return null;
  const noTz = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const at = noTz.indexOf(" at ");
  return at >= 0 ? noTz.slice(at + 4).trim() : noTz;
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
  const [limits, setLimits] = useState<ClaudeLimits | null>(null);
  const posRef = useRef<Pos>({ x: 0, y: 0 });

  // Hydrate persisted position + collapsed once.
  useEffect(() => {
    void getAppState<{ pos: Pos; collapsed?: boolean }>("widget.monitor").then((v) => {
      const init = v?.pos ?? { x: window.innerWidth - 280, y: 52 };
      posRef.current = init;
      setPos(init);
      if (v?.collapsed) setCollapsed(true);
    });
  }, []);

  // Poll only while expanded AND the OS window is visible (skip work when
  // hidden/minimized — avoids spawning a `claude` subprocess every 90s for
  // nothing).
  useEffect(() => {
    if (collapsed || !pos) return;
    let alive = true;
    const pullSys = () => {
      if (document.hidden) return;
      void ipc.systemStats().then((s) => alive && setSys(s)).catch(() => undefined);
    };
    const pullUsage = () => {
      if (document.hidden) return;
      void ipc.claudeUsage().then((u) => alive && setUsage(u)).catch(() => undefined);
    };
    const pullLimits = () => {
      if (document.hidden) return;
      void ipc.claudeLimits().then((l) => alive && setLimits(l)).catch(() => undefined);
    };
    pullSys();
    pullUsage();
    pullLimits();
    const a = setInterval(pullSys, SYS_POLL_MS);
    const b = setInterval(pullUsage, USAGE_POLL_MS);
    const c = setInterval(pullLimits, LIMITS_POLL_MS);
    const onVis = () => {
      if (!document.hidden) {
        pullSys();
        pullUsage();
        pullLimits();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
      clearInterval(c);
      document.removeEventListener("visibilitychange", onVis);
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
  const block = usage?.block;
  const w24 = usage?.last_24h;
  const tok5 = block ? block.input + block.output + block.cache_creation + block.cache_read : 0;
  const tok24 = w24 ? w24.input + w24.output + w24.cache_creation + w24.cache_read : 0;

  // Authoritative numbers from `/usage`; null while loading, `ok:false` when
  // the CLI couldn't be read (e.g. not logged in).
  const live = limits?.ok ? limits : null;
  const sessionPct = live?.session_pct ?? null;
  const weekPct = live?.week_pct ?? null;
  const sonnetPct = live?.week_sonnet_pct ?? null;
  const sessionReset = shortReset(live?.session_reset);
  const sessionTone =
    sessionPct == null
      ? "var(--neon-green)"
      : sessionPct >= 90
        ? "var(--neon-magenta)"
        : sessionPct >= 70
          ? "var(--neon-yellow)"
          : "var(--neon-green)";

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
          <span
            className="ot-mon-label"
            title="Real subscription usage, from Claude's /usage"
          >
            CLAUDE · session
          </span>
          <span className="ot-mon-val ot-mon-pct" style={{ color: sessionTone }}>
            {sessionPct != null
              ? `${sessionPct}%`
              : limits && !limits.ok
                ? "n/a"
                : "—"}
          </span>
        </div>
        <Bar pct={sessionPct ?? 0} tone={sessionTone} />
        <div className="ot-mon-row ot-mon-sub">
          <span>
            {sessionReset
              ? `resets ${sessionReset}`
              : limits && !limits.ok
                ? "/usage unavailable"
                : ""}
          </span>
          <span>
            {weekPct != null ? `week ${weekPct}%` : ""}
            {sonnetPct != null ? ` · sonnet ${sonnetPct}%` : ""}
          </span>
        </div>
        <div className="ot-mon-row ot-mon-sub">
          <span>{fmtTokens(tok5)} tok · 5h</span>
          <span>{w24 ? `${fmtTokens(tok24)} · 24h` : ""}</span>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ulid } from "ulid";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { log } from "@/lib/log";

export function OrionClaudeCodePanel() {
  return (
    <div className="or-terminal-panel">
      <ClaudeCodeCanvas />
    </div>
  );
}

function ClaudeCodeCanvas() {
  const project = useProjectStore((s) => s.active);
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const openedRef = useRef(false);
  const ptyId = useMemo(() => `claude-code-${ulid()}`, []);

  useEffect(() => {
    if (!containerRef.current || xtermRef.current || !project) return;

    const term = new XTerm({
      fontFamily:
        "JetBrains Mono, SF Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      theme: {
        background: "#03060a",
        foreground: "#e6f4ec",
        cursor: "#00e0ff",
        cursorAccent: "#03060a",
        selectionBackground: "rgba(0,224,255,0.25)",
        black: "#03060a",
        red: "#ff5e5e",
        green: "#39ff88",
        yellow: "#e6ff3a",
        blue: "#00e0ff",
        magenta: "#ff3ea5",
        cyan: "#00e0ff",
        white: "#e6f4ec",
        brightBlack: "#324036",
        brightRed: "#ff8a8a",
        brightGreen: "#7fffb0",
        brightYellow: "#f1ff7a",
        brightBlue: "#7fefff",
        brightMagenta: "#ff7ec3",
        brightCyan: "#7fefff",
        brightWhite: "#ffffff",
      },
      cursorBlink: true,
      allowTransparency: false,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    xtermRef.current = term;
    fitRef.current = fit;

    let unlistenData: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;
    let resizeObs: ResizeObserver | null = null;
    let cancelled = false;

    (async () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      const cols = term.cols || 80;
      const rows = term.rows || 24;

      try {
        await ipc.terminalOpenClaude(ptyId, project.root_path, cols, rows);
        if (cancelled) return;
        openedRef.current = true;
      } catch (e) {
        log.error("claude code open failed", e);
        term.writeln(
          `\x1b[31mFailed to launch Claude Code: ${String(e)}\x1b[0m`,
        );
        term.writeln(
          `\x1b[90mIs the \`claude\` CLI installed and on PATH?\x1b[0m`,
        );
        return;
      }

      term.onData((data) => {
        if (!openedRef.current) return;
        void ipc.terminalWrite(ptyId, data);
      });

      term.onResize(({ cols, rows }) => {
        if (!openedRef.current) return;
        void ipc.terminalResize(ptyId, cols, rows);
      });

      unlistenData = await listen<{ ptyId: string; data: string }>(
        "terminal:data",
        (e) => {
          if (e.payload.ptyId !== ptyId) return;
          term.write(e.payload.data);
        },
      );

      unlistenExit = await listen<{ ptyId: string }>("terminal:exit", (e) => {
        if (e.payload.ptyId !== ptyId) return;
        openedRef.current = false;
        term.writeln("\r\n\x1b[31m[claude exited]\x1b[0m");
      });

      resizeObs = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
      });
      if (containerRef.current) resizeObs.observe(containerRef.current);
    })().catch((e) => log.error("claude code init", e));

    return () => {
      cancelled = true;
      unlistenData?.();
      unlistenExit?.();
      resizeObs?.disconnect();
      try {
        if (openedRef.current) void ipc.terminalKill(ptyId);
      } catch {
        /* ignore */
      }
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      openedRef.current = false;
    };
  }, [project, ptyId]);

  if (!project) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--t-tertiary)",
          fontFamily: "var(--f-mono)",
          fontSize: 11,
        }}
      >
        Open a project to launch Claude Code.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        height: "100%",
        width: "100%",
        padding: 8,
        background: "rgba(3,6,10,0.4)",
      }}
    />
  );
}

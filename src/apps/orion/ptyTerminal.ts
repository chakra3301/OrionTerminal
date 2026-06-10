import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

const THEME = {
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
} as const;

export type PtyTerminalHandle = {
  term: XTerm;
  dispose: () => void;
};

export type PtyTerminalOptions = {
  ptyId: string;
  container: HTMLElement;
  /** Spawns the pty backend at the given size. */
  open: (ptyId: string, cols: number, rows: number) => Promise<void>;
  /** Written to the terminal when the pty exits. */
  exitMessage?: string;
  /** Red error lines shown if `open` throws. */
  launchErrorLines?: (e: unknown) => string[];
  onOpened?: () => void;
  onClosed?: () => void;
};

/**
 * Resolves once the element has a non-zero box. A terminal mounted inside a
 * freshly-opened workspace tab can lay out at 0×0 for a frame or two; fitting
 * before then yields a garbage cols/rows that we'd ship straight to the pty.
 */
function waitForSize(el: HTMLElement, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const check = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) return resolve();
      if (performance.now() - start > timeoutMs) return resolve();
      requestAnimationFrame(check);
    };
    check();
  });
}

/**
 * Wires an xterm instance to a pty: spawns the backend, streams data both ways,
 * and keeps the pty sized to the visible terminal. Shared by the shell terminal
 * and the Claude Code session so the rendering fixes live in one place.
 */
export function attachPtyTerminal(opts: PtyTerminalOptions): PtyTerminalHandle {
  const term = new XTerm({
    fontFamily:
      "JetBrains Mono, SF Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    theme: THEME,
    cursorBlink: true,
    allowTransparency: false,
    scrollback: 5000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  term.open(opts.container);

  // GPU renderer for crisp text. If the webview can't give us a context (or
  // loses it later) we dispose the addon and xterm falls back to its DOM
  // renderer rather than going blank.
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
  } catch (e) {
    log.warn("webgl renderer unavailable, using dom", e);
  }

  let opened = false;
  let disposed = false;
  let unlistenData: UnlistenFn | null = null;
  let unlistenExit: UnlistenFn | null = null;
  let resizeObs: ResizeObserver | null = null;
  let resizeTimer: number | null = null;
  let lastCols = 0;
  let lastRows = 0;

  const safeFit = () => {
    if (!opts.container.clientWidth || !opts.container.clientHeight) return;
    try {
      fit.fit();
    } catch {
      /* ignore */
    }
  };

  (async () => {
    // Fit only once the mono web font has loaded — otherwise the cell metrics
    // (and therefore the cols/rows we hand the pty) are measured against the
    // fallback font and change the moment the real font swaps in.
    try {
      await document.fonts?.ready;
    } catch {
      /* ignore */
    }
    if (disposed) return;
    await waitForSize(opts.container);
    if (disposed) return;

    safeFit();
    lastCols = term.cols || 80;
    lastRows = term.rows || 24;

    try {
      await opts.open(opts.ptyId, lastCols, lastRows);
      if (disposed) return;
      opened = true;
      opts.onOpened?.();
    } catch (e) {
      const lines = opts.launchErrorLines?.(e) ?? [
        `\x1b[31mFailed to start: ${String(e)}\x1b[0m`,
      ];
      lines.forEach((l) => term.writeln(l));
      return;
    }

    term.onData((data) => {
      if (!opened) return;
      void ipc.terminalWrite(opts.ptyId, data);
    });

    // Only forward a resize when the size actually changed. A burst of layout
    // ticks (font swap, tab open) otherwise spams the pty with identical sizes,
    // and each one makes a TUI like Claude repaint mid-layout — that's what
    // stacked the duplicate welcome banners.
    term.onResize(({ cols, rows }) => {
      if (!opened) return;
      if (cols === lastCols && rows === lastRows) return;
      lastCols = cols;
      lastRows = rows;
      void ipc.terminalResize(opts.ptyId, cols, rows);
    });

    unlistenData = await listen<{ ptyId: string; data: string }>(
      "terminal:data",
      (e) => {
        if (e.payload.ptyId !== opts.ptyId) return;
        term.write(e.payload.data);
      },
    );

    unlistenExit = await listen<{ ptyId: string }>("terminal:exit", (e) => {
      if (e.payload.ptyId !== opts.ptyId) return;
      opened = false;
      if (opts.exitMessage) term.writeln(opts.exitMessage);
      opts.onClosed?.();
    });

    // Debounce fits so a run of ResizeObserver callbacks collapses to a single
    // pty resize once the layout settles.
    resizeObs = new ResizeObserver(() => {
      if (resizeTimer != null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        safeFit();
      }, 80);
    });
    resizeObs.observe(opts.container);
  })().catch((e) => log.error("pty terminal init", e));

  return {
    term,
    dispose: () => {
      disposed = true;
      if (resizeTimer != null) window.clearTimeout(resizeTimer);
      unlistenData?.();
      unlistenExit?.();
      resizeObs?.disconnect();
      try {
        if (opened) void ipc.terminalKill(opts.ptyId);
      } catch {
        /* ignore */
      }
      term.dispose();
    },
  };
}

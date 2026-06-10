import { useEffect, useRef } from "react";
import { ipc } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { useTerminalStore } from "@/store/terminalStore";
import { attachPtyTerminal } from "./ptyTerminal";

export function OrionTerminalPanel({ id }: { id?: string }) {
  return (
    <div className="or-terminal-panel">
      <TerminalCanvas id={id} />
    </div>
  );
}

function TerminalCanvas({ id }: { id?: string }) {
  const project = useProjectStore((s) => s.active);
  const containerRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef(false);
  const setPtyId = useTerminalStore((s) => s.setPtyId);
  // No id = the primary terminal (⌘`, default layout); extras get a unique
  // pty so several shells can run at once. The MCP `run_in_terminal` target
  // follows whichever terminal most recently mounted.
  const ptyId = id ? `term-${id}` : "main";

  useEffect(() => {
    if (!containerRef.current || attachedRef.current || !project) return;
    attachedRef.current = true;

    const root = project.root_path;
    const handle = attachPtyTerminal({
      ptyId,
      container: containerRef.current,
      open: (pid, cols, rows) => ipc.terminalOpen(pid, root, cols, rows),
      exitMessage: "\r\n\x1b[31m[process exited]\x1b[0m",
      launchErrorLines: (e) => [
        `\x1b[31mFailed to open terminal: ${String(e)}\x1b[0m`,
      ],
      onOpened: () => setPtyId(ptyId),
      onClosed: () => setPtyId(null),
    });

    return () => {
      handle.dispose();
      setPtyId(null);
      attachedRef.current = false;
    };
  }, [project, setPtyId, ptyId]);

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
        Open a project to start a terminal.
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

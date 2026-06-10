import { useEffect, useMemo, useRef } from "react";
import { ulid } from "ulid";
import { ipc } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { attachPtyTerminal } from "./ptyTerminal";

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
  const attachedRef = useRef(false);
  const ptyId = useMemo(() => `claude-code-${ulid()}`, []);

  useEffect(() => {
    if (!containerRef.current || attachedRef.current || !project) return;
    attachedRef.current = true;

    const root = project.root_path;
    const handle = attachPtyTerminal({
      ptyId,
      container: containerRef.current,
      open: (id, cols, rows) => ipc.terminalOpenClaude(id, root, cols, rows),
      exitMessage: "\r\n\x1b[31m[claude exited]\x1b[0m",
      launchErrorLines: (e) => [
        `\x1b[31mFailed to launch Claude Code: ${String(e)}\x1b[0m`,
        `\x1b[90mIs the \`claude\` CLI installed and on PATH?\x1b[0m`,
      ],
    });

    return () => {
      handle.dispose();
      attachedRef.current = false;
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

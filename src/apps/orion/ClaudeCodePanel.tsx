import { useEffect, useMemo, useRef } from "react";
import { ulid } from "ulid";
import { ipc } from "@/lib/ipc";
import { useProjectStore } from "@/store/projectStore";
import { attachPtyTerminal } from "./ptyTerminal";
import { AGENT_LABELS, type AgentCli } from "@/components/workspace/types";

const AGENT_BIN: Record<AgentCli, string> = {
  claude: "claude",
  hermes: "hermes",
  pi: "pi",
};

export function OrionClaudeCodePanel({
  agent = "claude",
}: {
  agent?: AgentCli;
}) {
  return (
    <div className="or-terminal-panel">
      <ClaudeCodeCanvas agent={agent} />
    </div>
  );
}

function ClaudeCodeCanvas({ agent }: { agent: AgentCli }) {
  const project = useProjectStore((s) => s.active);
  const containerRef = useRef<HTMLDivElement>(null);
  const attachedRef = useRef(false);
  const ptyId = useMemo(() => `agent-${agent}-${ulid()}`, [agent]);

  useEffect(() => {
    if (!containerRef.current || attachedRef.current || !project) return;
    attachedRef.current = true;

    const root = project.root_path;
    const handle = attachPtyTerminal({
      ptyId,
      container: containerRef.current,
      open: (id, cols, rows) =>
        ipc.terminalOpenAgent(agent, id, root, cols, rows),
      exitMessage: `\r\n\x1b[31m[${AGENT_BIN[agent]} exited]\x1b[0m`,
      launchErrorLines: (e) => [
        `\x1b[31mFailed to launch ${AGENT_LABELS[agent]}: ${String(e)}\x1b[0m`,
        `\x1b[90mIs the \`${AGENT_BIN[agent]}\` CLI installed and on PATH?\x1b[0m`,
      ],
    });

    return () => {
      handle.dispose();
      attachedRef.current = false;
    };
  }, [project, ptyId, agent]);

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
        Open a project to launch {AGENT_LABELS[agent]}.
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

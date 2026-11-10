import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ulid } from "ulid";
import { listen } from "@tauri-apps/api/event";
import { ArrowUp, ChevronRight, Loader2, Plus, Square, TerminalSquare, MessageSquare, AlertCircle, Check, X } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { useProjectStore } from "@/store/projectStore";
import { useFileTreeRefresh } from "@/store/fileTreeRefreshStore";
import { useGit } from "@/store/gitStore";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { attachPtyTerminal } from "./ptyTerminal";
import { AGENT_LABELS, type AgentCli, type AgentView } from "@/components/workspace/types";
import { useAgentChats, type AgentEvent, type AgentPart, type AgentStep } from "./store/agentChatStore";
import { choiceFor, runOptions, useAgentOptions } from "./store/agentOptionsStore";
import { AgentBrand, AgentPickers, AgentWelcome } from "./AgentChrome";

const AGENT_BIN: Record<AgentCli, string> = {
  claude: "claude",
  codex: "codex",
  hermes: "hermes",
  pi: "pi",
};

/** Routes every agent CLI event to its chat; one listener for the whole app. */
let bridged = false;
function bridgeAgentEvents() {
  if (bridged) return;
  bridged = true;
  void listen<{ chatId: string; event: AgentEvent }>("agent:event", ({ payload }) => {
    useAgentChats.getState().apply(payload.chatId, payload.event);
  });
  void listen<{ chatId: string; code: number | null; error: string | null }>("agent:exit", ({ payload }) => {
    useAgentChats.getState().finish(payload.chatId, payload.error);
    // The agent may have edited files or the index.
    useFileTreeRefresh.getState().bump();
    useGit.getState().refresh();
  });
}

/**
 * An agent CLI tab (Claude Code, Codex, Pi, Hermes), with Cursor's two
 * looks: Chat renders the run as messages and tool steps; Terminal is the
 * CLI's own interactive TUI. Each view keeps its own session.
 */
export function OrionClaudeCodePanel({
  agent = "claude",
  tabId,
  initialView = "chat",
}: {
  agent?: AgentCli;
  tabId?: string;
  initialView?: AgentView;
}) {
  const chatId = useMemo(() => `agentchat-${agent}-${tabId ?? ulid()}`, [agent, tabId]);
  const session = useAgentChats((s) => s.sessions[chatId]);
  useEffect(() => {
    const s = useAgentChats.getState().ensure(chatId, agent);
    if (s.turns.length === 0 && s.view !== initialView) useAgentChats.getState().setView(chatId, initialView);
  }, [chatId, agent, initialView]);
  const view = session?.view ?? initialView;
  // The terminal stays mounted once opened so switching views keeps its session.
  const [terminalOpened, setTerminalOpened] = useState(view === "terminal");
  useEffect(() => { if (view === "terminal") setTerminalOpened(true); }, [view]);

  return (
    <div className="or-agent-panel" data-view={view}>
      <div className="or-agent-head">
        <AgentBrand agent={agent} />
        <span className="or-agent-name">{AGENT_LABELS[agent]}</span>
        <div className="or-agent-viewswitch" role="tablist" aria-label="View">
          {(["chat", "terminal"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={view === v ? "active" : ""}
              onClick={() => useAgentChats.getState().setView(chatId, v)}
              title={v === "chat" ? "Chat view" : `Terminal view (the ${AGENT_BIN[agent]} TUI)`}
            >
              {v === "chat" ? <MessageSquare size={12} /> : <TerminalSquare size={12} />}
              <span className="lbl">{v === "chat" ? "Chat" : "Terminal"}</span>
            </button>
          ))}
        </div>
        <span className="or-agent-fill" />
        {view === "chat" && (
          <button
            type="button"
            className="ot-agent-icon"
            title="New chat"
            aria-label="New chat"
            disabled={session?.running || !session?.turns.length}
            onClick={() => useAgentChats.getState().reset(chatId)}
          >
            <Plus size={15} />
          </button>
        )}
      </div>
      <div className="or-agent-body">
        <div className="or-agent-pane" hidden={view !== "chat"}>
          <AgentChat agent={agent} chatId={chatId} />
        </div>
        {terminalOpened && (
          <div className="or-agent-pane" hidden={view !== "terminal"}>
            <div className="or-terminal-panel">
              <AgentTerminal agent={agent} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AgentChat({ agent, chatId }: { agent: AgentCli; chatId: string }) {
  const project = useProjectStore((s) => s.active);
  const session = useAgentChats((s) => s.sessions[chatId]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const running = !!session?.running;
  const turns = session?.turns ?? [];
  const info = useAgentOptions((s) => s.info[agent]);
  const choice = useAgentOptions((s) => choiceFor(s, agent));
  const missing = !!info && info !== "loading" && info !== "error" && !info.installed;

  useEffect(bridgeAgentEvents, []);
  useEffect(() => {
    useAgentOptions.getState().hydrate();
    useAgentOptions.getState().loadInfo(agent);
  }, [agent]);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const send = () => {
    const text = input.trim();
    if (!text || running || !project || missing) return;
    const store = useAgentChats.getState();
    const sessionId = store.sessions[chatId]?.sessionId ?? null;
    store.begin(chatId, text);
    setInput("");
    follow.current = true;
    const opts = runOptions(choiceFor(useAgentOptions.getState(), agent));
    ipc.agentChatSend(agent, chatId, text, project.root_path, sessionId, opts).catch((e) => {
      // The exit event already carried the error when the CLI ran; this covers spawn failures.
      if (useAgentChats.getState().sessions[chatId]?.running) useAgentChats.getState().finish(chatId, String(e));
      log.warn(`${agent} chat failed`, e);
    });
  };
  const stop = () => void ipc.agentChatCancel(chatId).catch((e) => log.warn("agent cancel failed", e));

  const composer = (
    <div className="ot-claude-input ot-agent-composer">
      <textarea
        ref={inputRef}
        value={input}
        rows={1}
        spellCheck={false}
        disabled={!project || missing}
        placeholder={!project ? "Open a project first" : missing ? `${AGENT_LABELS[agent]} isn't installed` : turns.length ? "Follow up…" : `Message ${AGENT_LABELS[agent]}…`}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="ot-agent-composer-foot">
        <AgentPickers agent={agent} info={info} choice={choice} onChange={(p) => useAgentOptions.getState().set(agent, p)} />
        <span className="ot-agent-composer-fill" />
        {running ? (
          <button type="button" className="send stop" onClick={stop} title="Stop" aria-label="Stop">
            <Square size={10} fill="currentColor" />
          </button>
        ) : (
          <button type="button" className="send" onClick={send} disabled={!input.trim() || !project || missing} title="Send (↵)" aria-label="Send message">
            <ArrowUp size={14} />
          </button>
        )}
      </div>
    </div>
  );

  if (turns.length === 0) {
    return (
      <div className="ot-claude-rail agent or-agent-chat" data-empty data-agent={agent}>
        <div className="or-agent-empty-stage scroll">
          <AgentWelcome agent={agent} info={info} choice={choice} projectPath={project?.root_path ?? null} />
          <div className="or-agent-empty-composer">{composer}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ot-claude-rail agent or-agent-chat">
      <div
        ref={scrollRef}
        className="ot-claude-messages scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
        }}
      >
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={t.id} className="ot-msg user">{t.text}</div>
          ) : (
            <div key={t.id} className="ot-msg assistant or-agent-turn">
              {t.parts.map((p) => <Part key={p.type === "tool" ? p.step.id : p.id} part={p} />)}
              {running && i === turns.length - 1 && <Working />}
            </div>
          ),
        )}
        {running && turns[turns.length - 1]?.role === "user" && (
          <div className="ot-msg assistant or-agent-turn"><Working /></div>
        )}
      </div>
      <div className="ot-agent-dock">{composer}</div>
    </div>
  );
}

function Working() {
  return (
    <div className="or-agent-working" role="status">
      <Loader2 size={12} className="or-ke-spin" /> Working…
    </div>
  );
}

function Part({ part }: { part: AgentPart }) {
  if (part.type === "text") return <ChatMarkdown text={part.text} />;
  if (part.type === "notice") {
    return (
      <div className={`or-agent-notice${part.error ? " error" : ""}`}>
        <AlertCircle size={12} /> <span>{part.text}</span>
      </div>
    );
  }
  return <Step step={part.step} />;
}

export function stepSummary(step: Pick<AgentStep, "input">): string {
  const i = (step.input ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  const cmd = pick("command").replace(/^\/bin\/(?:ba|z)?sh -lc /, "").replace(/^["']|["']$/g, "");
  const path = pick("file_path") || pick("path") || pick("filePath");
  if (cmd) return cmd;
  if (path) return path;
  if (Array.isArray(i.changes)) return (i.changes as { path?: string }[]).map((c) => c.path).filter(Boolean).join(", ");
  return pick("pattern") || pick("query") || pick("url") || pick("description");
}

function Step({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);
  const summary = stepSummary(step);
  const hasOutput = !!step.output?.trim();
  return (
    <div className={`or-agent-step${step.isError ? " error" : ""}`}>
      <button type="button" className="or-agent-step-row" onClick={() => setOpen((o) => !o)} disabled={!hasOutput} aria-expanded={open}>
        <span className="st">
          {!step.done ? <Loader2 size={12} className="or-ke-spin" /> : step.isError ? <X size={12} /> : <Check size={12} />}
        </span>
        <span className="nm">{step.name}</span>
        {summary && <span className="sm" title={summary}>{summary}</span>}
        {hasOutput && <ChevronRight size={12} className={`cv${open ? " open" : ""}`} />}
      </button>
      {open && hasOutput && <pre className="or-agent-step-out">{step.output}</pre>}
    </div>
  );
}

function AgentTerminal({ agent }: { agent: AgentCli }) {
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
    return <div className="or-agent-empty">Open a project to launch {AGENT_LABELS[agent]}.</div>;
  }

  return <div ref={containerRef} className="or-agent-term" />;
}

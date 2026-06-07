import { useEffect, useRef, useState } from "react";
import { X, Plus, Play, Square, Trash2, Bot, FileText } from "lucide-react";
import {
  useHermes,
  HERMES_COLUMNS,
  type HermesTask,
  type HermesAgent,
  type HermesColumn,
  type HermesStatus,
} from "@/store/hermesStore";
import {
  STATUS_LABEL,
  STATUS_CLS,
  deptColor,
  relTime,
  HERMES_MODELS,
  DEFAULT_MODEL_ID,
  modelLabel,
  modelShort,
} from "@/apps/hermes/util";
import { useProjectStore } from "@/store/projectStore";

const MOVABLE: HermesColumn[] = ["backlog", "ready", "review", "done", "blocked"];

function projectRoot(): string | null {
  return useProjectStore.getState().active?.root_path ?? null;
}

function StatusTag({
  status,
  className = "",
}: {
  status: HermesStatus;
  className?: string;
}) {
  return (
    <span className={`hm-tag s-${STATUS_CLS[status]} ${className}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function HermesTaskDetail({
  task: initialTask,
  focusAgentId,
  onClose,
  onDispatch,
  onOpenReport,
}: {
  task: HermesTask;
  focusAgentId?: string | null;
  onClose: () => void;
  onDispatch: () => void;
  onOpenReport: (agentId: string) => void;
}) {
  const tasks = useHermes((s) => s.tasks);
  const agents = useHermes((s) => s.agents);
  const task = tasks.get(initialTask.id) ?? initialTask;
  const taskAgents = Array.from(agents.values())
    .filter((a) => a.taskId === task.id)
    .sort((a, b) => a.position - b.position);

  const [title, setTitle] = useState(task.title);
  const [prompt, setPrompt] = useState(task.prompt);
  const [selId, setSelId] = useState<string | null>(
    focusAgentId ??
      taskAgents.find((a) => a.status === "running")?.id ??
      taskAgents[0]?.id ??
      null,
  );

  // Re-sync local fields + selection when the underlying task changes.
  useEffect(() => {
    setTitle(task.title);
    setPrompt(task.prompt);
    setSelId(
      focusAgentId ??
        taskAgents.find((a) => a.status === "running")?.id ??
        taskAgents[0]?.id ??
        null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const running = task.status === "running";
  const dispatchable = taskAgents.some(
    (a) =>
      a.status !== "running" &&
      a.status !== "completed" &&
      a.status !== "paused",
  );
  const sel =
    (selId && agents.get(selId)) ||
    taskAgents.find((a) => a.id === selId) ||
    null;

  return (
    <div
      className="hm-overlay"
      onClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("hm-overlay"))
          onClose();
      }}
    >
      <div className="hm-modal">
        <div className="hm-m-head">
          <span
            className="hm-mh-stripe"
            style={{ background: deptColor(task.id) }}
          />
          <div className="hm-mh-name">
            <input
              className="hm-mh-title"
              value={title}
              placeholder="Task title"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title !== task.title)
                  void useHermes.getState().updateTask(task.id, { title });
              }}
            />
            <span className="hm-mh-sub">
              {taskAgents.length} agent{taskAgents.length === 1 ? "" : "s"} ·{" "}
              {task.createdBy === "rosie" ? "planned by ROSIE" : "manual"}
            </span>
          </div>
          <StatusTag status={task.status} className="hm-mh-status" />
          <span className="hm-mh-sp" />
          <span className="hm-mh-meta mono">
            {sel ? `${modelShort(sel.model)} · ` : ""}dispatched{" "}
            {relTime(task.dispatchedAt)}
          </span>
          <button className="hm-mh-close" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>

        <div className="hm-m-actions">
          <select
            className="hm-col-select"
            value={MOVABLE.includes(task.column) ? task.column : "ready"}
            disabled={running}
            onChange={(e) =>
              void useHermes
                .getState()
                .moveTask(task.id, e.target.value as HermesColumn)
            }
          >
            {HERMES_COLUMNS.filter((c) => c.id !== "running").map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {running ? (
            <button
              className="hm-btn stop"
              onClick={() => void useHermes.getState().stopTask(task.id)}
            >
              <Square size={13} /> Stop swarm
            </button>
          ) : (
            <button
              className="hm-btn primary"
              disabled={!dispatchable}
              onClick={onDispatch}
              title={
                dispatchable ? "Run all agents in parallel" : "Add an agent first"
              }
            >
              <Play size={13} /> Dispatch swarm ({taskAgents.length})
            </button>
          )}
          <button
            className="hm-btn ghost"
            onClick={async () => {
              const a = await useHermes.getState().addAgent(task.id);
              setSelId(a.id);
            }}
          >
            <Plus size={13} /> Add agent
          </button>
          <span className="hm-m-actions-sp" />
          <button
            className="hm-btn danger"
            onClick={() => {
              void useHermes.getState().deleteTask(task.id);
              onClose();
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>

        <div className="hm-m-body">
          <div className="hm-m-col left">
            <div className="hm-m-lab">
              Live Transcript{sel ? ` · ${sel.label || "agent"}` : ""}
            </div>
            {sel ? (
              <Transcript agent={sel} onOpenReport={onOpenReport} />
            ) : (
              <div className="hm-m-empty">
                No agents yet — add one to begin.
              </div>
            )}
          </div>

          <div className="hm-m-col right">
            <div className="hm-m-scroll pad0">
              <section className="hm-m-section">
                <div className="hm-ms-h">Details</div>
                <DetailRow k="Status" v={STATUS_LABEL[task.status]} />
                <DetailRow k="Column" v={columnLabel(task.column)} />
                <DetailRow
                  k="Agents"
                  v={`${taskAgents.length} · ${taskAgents.filter((a) => a.status === "running").length} running`}
                />
                <DetailRow k="Model" v={sel ? modelLabel(sel.model) : "Opus 4.8"} />
                <DetailRow k="Dispatched" v={relTime(task.dispatchedAt)} />
                <DetailRow k="Created" v={relTime(task.createdAt)} />
                <DetailRow
                  k="Origin"
                  v={task.createdBy === "rosie" ? "ROSIE" : "manual"}
                />
              </section>

              <section className="hm-m-section">
                <div className="hm-ms-h">
                  <Bot size={12} /> Swarm
                </div>
                {taskAgents.length === 0 ? (
                  <div className="hm-find-empty">
                    No agents yet — they run in parallel when you dispatch.
                  </div>
                ) : (
                  <div className="hm-swarm">
                    {taskAgents.map((a, i) => (
                      <SwarmRow
                        key={a.id}
                        index={i}
                        agent={a}
                        selected={a.id === selId}
                        onSelect={() => setSelId(a.id)}
                        onOpenReport={() => onOpenReport(a.id)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="hm-m-section">
                <div className="hm-ms-h">Goal · Prompt</div>
                <div className="hm-ms-pad">
                  <textarea
                    className="hm-detail-prompt"
                    value={prompt}
                    placeholder="What should this task accomplish? Agents fall back to this if they have no prompt of their own."
                    onChange={(e) => setPrompt(e.target.value)}
                    onBlur={() => {
                      if (prompt !== task.prompt)
                        void useHermes
                          .getState()
                          .updateTask(task.id, { prompt });
                    }}
                  />
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function columnLabel(col: HermesColumn): string {
  return HERMES_COLUMNS.find((c) => c.id === col)?.label ?? col;
}

function DetailRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="hm-sysmeta">
      <span className="k">{k}</span>
      <span className="v mono">{v}</span>
    </div>
  );
}

function Transcript({
  agent,
  onOpenReport,
}: {
  agent: HermesAgent;
  onOpenReport: (agentId: string) => void;
}) {
  const [prompt, setPrompt] = useState(agent.prompt);
  const outRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setPrompt(agent.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [agent.output, agent.error]);

  const running = agent.status === "running";
  const body = agent.error || agent.output || "";

  return (
    <>
      <div className="hm-agent-meta">
        <label>Model</label>
        <select
          className="hm-model-select"
          value={agent.model || DEFAULT_MODEL_ID}
          disabled={running}
          onChange={(e) =>
            void useHermes
              .getState()
              .updateAgent(agent.id, { model: e.target.value })
          }
        >
          {HERMES_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="hm-agent-prompt"
        value={prompt}
        placeholder="This agent's instruction (defaults to the task goal)…"
        disabled={running}
        onChange={(e) => setPrompt(e.target.value)}
        onBlur={() => {
          if (prompt !== agent.prompt)
            void useHermes.getState().updateAgent(agent.id, { prompt });
        }}
      />
      <pre
        ref={outRef}
        className={`hm-m-scroll transcript${agent.error ? " err" : ""}`}
      >
        {body || (running ? "starting…" : "no output yet.")}
      </pre>
      {agent.status === "completed" && agent.output && (
        <button
          className="hm-transcript-report"
          onClick={() => onOpenReport(agent.id)}
        >
          <FileText size={12} /> Open as report
        </button>
      )}
      {agent.status === "paused" && (
        <button
          className="hm-transcript-report continue"
          onClick={() =>
            void useHermes.getState().continueAgent(agent.id, projectRoot())
          }
        >
          <Play size={12} /> Continue — hit the turn limit
        </button>
      )}
    </>
  );
}

function SwarmRow({
  index,
  agent,
  selected,
  onSelect,
  onOpenReport,
}: {
  index: number;
  agent: HermesAgent;
  selected: boolean;
  onSelect: () => void;
  onOpenReport: () => void;
}) {
  const cls = STATUS_CLS[agent.status];
  const running = agent.status === "running";
  return (
    <div
      className={`hm-swarm-row${selected ? " sel" : ""}`}
      onClick={onSelect}
    >
      <span className={`hm-sdot s-${cls}`} />
      <span className="sw-name">{agent.label || `Agent ${index + 1}`}</span>
      <StatusTag status={agent.status} className="sw-tag" />
      {agent.status === "completed" && agent.output && (
        <button
          className="hm-swarm-btn"
          title="Open report"
          onClick={(e) => {
            e.stopPropagation();
            onOpenReport();
          }}
        >
          <FileText size={11} />
        </button>
      )}
      {running ? (
        <button
          className="hm-swarm-btn stop"
          title="Stop this agent"
          onClick={(e) => {
            e.stopPropagation();
            void useHermes.getState().stopAgent(agent.id);
          }}
        >
          <Square size={11} />
        </button>
      ) : agent.status === "paused" ? (
        <button
          className="hm-swarm-btn continue"
          title="Continue — resume with another turn budget"
          onClick={(e) => {
            e.stopPropagation();
            void useHermes.getState().continueAgent(agent.id, projectRoot());
          }}
        >
          <Play size={11} />
        </button>
      ) : (
        <button
          className="hm-swarm-btn"
          title="Remove this agent"
          onClick={(e) => {
            e.stopPropagation();
            void useHermes.getState().removeAgent(agent.id);
          }}
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

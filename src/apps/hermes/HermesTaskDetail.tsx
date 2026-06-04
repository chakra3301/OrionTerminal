import { useEffect, useRef, useState } from "react";
import {
  X,
  Plus,
  Play,
  Square,
  Trash2,
  Bot,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Circle,
} from "lucide-react";
import {
  useHermes,
  HERMES_COLUMNS,
  type HermesTask,
  type HermesAgent,
  type HermesColumn,
  type HermesStatus,
} from "@/store/hermesStore";

const MOVABLE: HermesColumn[] = [
  "backlog",
  "ready",
  "review",
  "done",
  "blocked",
];

function StatusBadge({ status }: { status: HermesStatus }) {
  if (status === "running")
    return (
      <span className="hm-badge running">
        <Loader2 size={11} className="spin" /> running
      </span>
    );
  if (status === "completed")
    return (
      <span className="hm-badge ok">
        <CheckCircle2 size={11} /> done
      </span>
    );
  if (status === "failed")
    return (
      <span className="hm-badge fail">
        <AlertTriangle size={11} /> failed
      </span>
    );
  if (status === "cancelled")
    return (
      <span className="hm-badge cancel">
        <Circle size={11} /> cancelled
      </span>
    );
  return (
    <span className="hm-badge idle">
      <Circle size={11} /> idle
    </span>
  );
}

export function HermesTaskDetail({
  task: initialTask,
  onClose,
  onDispatch,
}: {
  task: HermesTask;
  onClose: () => void;
  onDispatch: () => void;
}) {
  const tasks = useHermes((s) => s.tasks);
  const agents = useHermes((s) => s.agents);
  const task = tasks.get(initialTask.id) ?? initialTask;
  const taskAgents = Array.from(agents.values())
    .filter((a) => a.taskId === task.id)
    .sort((a, b) => a.position - b.position);

  const [title, setTitle] = useState(task.title);
  const [prompt, setPrompt] = useState(task.prompt);

  // Re-sync local fields when the underlying task identity changes.
  useEffect(() => {
    setTitle(task.title);
    setPrompt(task.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const running = task.status === "running";
  const dispatchable = taskAgents.some(
    (a) => a.status !== "running" && a.status !== "completed",
  );

  return (
    <div className="hm-detail-scrim" onClick={onClose}>
      <aside className="hm-detail" onClick={(e) => e.stopPropagation()}>
        <header className="hm-detail-head">
          <input
            className="hm-detail-title"
            value={title}
            placeholder="Task title"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title !== task.title)
                void useHermes.getState().updateTask(task.id, { title });
            }}
          />
          <button className="hm-icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </header>

        <div className="hm-detail-meta">
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
          {task.createdBy === "rosie" && (
            <span className="hm-rosie-badge">planned by ROSIE</span>
          )}
          <span className="hm-detail-status">
            <StatusBadge status={task.status} />
          </span>
        </div>

        <label className="hm-field-label">Goal / prompt</label>
        <textarea
          className="hm-detail-prompt"
          value={prompt}
          placeholder="What should this task accomplish? Agents fall back to this if they have no prompt of their own."
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => {
            if (prompt !== task.prompt)
              void useHermes.getState().updateTask(task.id, { prompt });
          }}
        />

        <div className="hm-detail-actions">
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
                dispatchable
                  ? "Run all agents in parallel"
                  : "Add an agent first"
              }
            >
              <Play size={13} /> Dispatch swarm ({taskAgents.length})
            </button>
          )}
          <button
            className="hm-btn ghost"
            onClick={() => void useHermes.getState().addAgent(task.id)}
          >
            <Plus size={13} /> Add agent
          </button>
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

        <div className="hm-agents">
          <div className="hm-agents-head">
            <Bot size={13} /> Swarm · {taskAgents.length} agent
            {taskAgents.length === 1 ? "" : "s"}
          </div>
          {taskAgents.length === 0 && (
            <div className="hm-agents-empty">
              No agents yet. Add one (or several) — they run in parallel when
              you dispatch.
            </div>
          )}
          {taskAgents.map((a, i) => (
            <AgentRow key={a.id} index={i} agent={a} />
          ))}
        </div>
      </aside>
    </div>
  );
}

function AgentRow({ index, agent }: { index: number; agent: HermesAgent }) {
  const [prompt, setPrompt] = useState(agent.prompt);
  const outRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setPrompt(agent.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  // Auto-scroll live output to the bottom as it streams.
  useEffect(() => {
    const el = outRef.current;
    if (el && agent.status === "running") el.scrollTop = el.scrollHeight;
  }, [agent.output, agent.status]);

  const running = agent.status === "running";

  return (
    <div className={`hm-agent status-${agent.status}`}>
      <div className="hm-agent-head">
        <span className="hm-agent-name">
          {agent.label || `Agent ${index + 1}`}
        </span>
        <StatusBadge status={agent.status} />
        {running ? (
          <button
            className="hm-agent-stop"
            onClick={() => void useHermes.getState().stopAgent(agent.id)}
            title="Stop this agent"
          >
            <Square size={11} />
          </button>
        ) : (
          <button
            className="hm-agent-stop"
            onClick={() => void useHermes.getState().removeAgent(agent.id)}
            title="Remove this agent"
          >
            <Trash2 size={11} />
          </button>
        )}
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
      {(agent.output || agent.error) && (
        <pre
          ref={outRef}
          className={`hm-agent-out${agent.error ? " err" : ""}`}
        >
          {agent.error || agent.output}
        </pre>
      )}
    </div>
  );
}

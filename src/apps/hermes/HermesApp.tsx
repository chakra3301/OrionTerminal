import { useState } from "react";
import {
  Workflow,
  Plus,
  Play,
  Square,
  Bot,
  Loader2,
  Sparkles,
} from "lucide-react";
import {
  useHermes,
  HERMES_COLUMNS,
  type HermesTask,
  type HermesColumn,
  type HermesStatus,
} from "@/store/hermesStore";
import { useProjectStore } from "@/store/projectStore";
import { HermesTaskDetail } from "@/apps/hermes/HermesTaskDetail";
import { log } from "@/lib/log";

const STATUS_CLASS: Record<HermesStatus, string> = {
  idle: "idle",
  running: "running",
  completed: "ok",
  failed: "fail",
  cancelled: "cancel",
};

const DRAG_MIME = "application/x-hermes-task";

function projectRoot(): string | null {
  return useProjectStore.getState().active?.root_path ?? null;
}

export function HermesApp() {
  const tasks = useHermes((s) => s.tasks);
  const agents = useHermes((s) => s.agents);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<HermesColumn | null>(null);

  const tasksInColumn = (col: HermesColumn): HermesTask[] =>
    Array.from(tasks.values())
      .filter((t) => t.column === col)
      .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);

  const agentsForTask = (taskId: string) =>
    Array.from(agents.values()).filter((a) => a.taskId === taskId);

  const handleNew = async () => {
    try {
      const t = await useHermes.getState().createTask({
        title: "New task",
        column: "backlog",
      });
      await useHermes.getState().addAgent(t.id);
      setOpenTaskId(t.id);
    } catch (e) {
      log.error("hermes new task failed", e);
    }
  };

  const handleDispatch = async (taskId: string) => {
    try {
      await useHermes.getState().dispatch(taskId, projectRoot());
    } catch (e) {
      log.warn("dispatch failed", e);
    }
  };

  const openTask = openTaskId ? tasks.get(openTaskId) ?? null : null;

  return (
    <div className="hm-shell">
      <div className="hm-toolbar">
        <div className="hm-brand">
          <Workflow size={16} />
          <span className="hm-brand-name">HERMES</span>
          <span className="hm-brand-sub">agent orchestration</span>
        </div>
        <div className="hm-toolbar-right">
          <span className="hm-hint">
            <Sparkles size={12} /> ROSIE plans · you dispatch
          </span>
          <button className="hm-btn primary" onClick={handleNew}>
            <Plus size={14} /> New task
          </button>
        </div>
      </div>

      <div className="hm-board">
        {HERMES_COLUMNS.map((col) => {
          const colTasks = tasksInColumn(col.id);
          const isRunningCol = col.id === "running";
          return (
            <div
              key={col.id}
              className={`hm-col${dragOverCol === col.id ? " drag-over" : ""}`}
              onDragOver={(e) => {
                if (isRunningCol) return; // running is engine-managed
                if (e.dataTransfer.types.includes(DRAG_MIME)) {
                  e.preventDefault();
                  setDragOverCol(col.id);
                }
              }}
              onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                setDragOverCol(null);
                if (isRunningCol) return;
                const id = e.dataTransfer.getData(DRAG_MIME);
                if (id) void useHermes.getState().moveTask(id, col.id);
              }}
            >
              <div className="hm-col-head">
                <span className={`hm-col-dot ${col.id}`} />
                <span className="hm-col-title">{col.label}</span>
                <span className="hm-col-count">{colTasks.length}</span>
              </div>
              <div className="hm-col-body">
                {colTasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    agentCount={agentsForTask(t.id).length}
                    agentStatuses={agentsForTask(t.id).map((a) => a.status)}
                    onOpen={() => setOpenTaskId(t.id)}
                    onDispatch={() => handleDispatch(t.id)}
                    onStop={() => void useHermes.getState().stopTask(t.id)}
                  />
                ))}
                {colTasks.length === 0 && (
                  <div className="hm-col-empty">—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {openTask && (
        <HermesTaskDetail
          task={openTask}
          onClose={() => setOpenTaskId(null)}
          onDispatch={() => handleDispatch(openTask.id)}
        />
      )}
    </div>
  );
}

function TaskCard({
  task,
  agentCount,
  agentStatuses,
  onOpen,
  onDispatch,
  onStop,
}: {
  task: HermesTask;
  agentCount: number;
  agentStatuses: HermesStatus[];
  onOpen: () => void;
  onDispatch: () => void;
  onStop: () => void;
}) {
  const running = task.status === "running";
  const canDispatch =
    agentCount > 0 && task.column === "ready" && !running;
  return (
    <div
      className={`hm-card status-${STATUS_CLASS[task.status]}`}
      draggable={!running}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, task.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
    >
      <div className="hm-card-title">{task.title || "Untitled task"}</div>
      {task.prompt && <div className="hm-card-prompt">{task.prompt}</div>}
      <div className="hm-card-foot">
        <span className="hm-card-agents" title={`${agentCount} agent(s)`}>
          <Bot size={11} /> {agentCount}
          <span className="hm-pips">
            {agentStatuses.slice(0, 6).map((s, i) => (
              <span key={i} className={`hm-pip ${STATUS_CLASS[s]}`} />
            ))}
          </span>
        </span>
        {task.createdBy === "rosie" && (
          <span className="hm-rosie-badge" title="Planned by ROSIE">
            <Sparkles size={10} /> ROSIE
          </span>
        )}
        {running ? (
          <button
            className="hm-card-act stop"
            onClick={(e) => {
              e.stopPropagation();
              onStop();
            }}
            title="Stop the swarm"
          >
            <Square size={11} /> Stop
          </button>
        ) : canDispatch ? (
          <button
            className="hm-card-act go"
            onClick={(e) => {
              e.stopPropagation();
              onDispatch();
            }}
            title="Dispatch the swarm"
          >
            <Play size={11} /> Dispatch
          </button>
        ) : null}
      </div>
      {running && (
        <div className="hm-card-running">
          <Loader2 size={11} className="spin" /> running…
        </div>
      )}
    </div>
  );
}

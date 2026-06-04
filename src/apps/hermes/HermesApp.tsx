import { useEffect, useState } from "react";
import {
  Workflow,
  Plus,
  Play,
  Square,
  Bot,
  LayoutGrid,
  Columns3,
  ChevronDown,
} from "lucide-react";
import {
  useHermes,
  HERMES_COLUMNS,
  type HermesTask,
  type HermesAgent,
  type HermesColumn,
  type HermesStatus,
} from "@/store/hermesStore";
import { useProjectStore } from "@/store/projectStore";
import { HermesTaskDetail } from "@/apps/hermes/HermesTaskDetail";
import { log } from "@/lib/log";

const DRAG_MIME = "application/x-hermes-task";

const CARD_STATUS: Record<HermesStatus, string> = {
  idle: "idle",
  running: "running",
  completed: "ok",
  failed: "fail",
  cancelled: "cancel",
};

const BADGE: Record<HermesStatus, string> = {
  idle: "IDLE",
  running: "WORKING",
  completed: "DONE",
  failed: "ERROR",
  cancelled: "STOPPED",
};

const STATUS_RANK: Record<HermesStatus, number> = {
  running: 0,
  failed: 1,
  idle: 2,
  completed: 3,
  cancelled: 4,
};

function projectRoot(): string | null {
  return useProjectStore.getState().active?.root_path ?? null;
}

function useClock(): string {
  const [t, setT] = useState(() => new Date().toLocaleTimeString("en-GB"));
  useEffect(() => {
    const id = setInterval(
      () => setT(new Date().toLocaleTimeString("en-GB")),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  return t;
}

export function HermesApp() {
  const tasks = useHermes((s) => s.tasks);
  const agents = useHermes((s) => s.agents);
  const [view, setView] = useState<"floor" | "board">("floor");
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<HermesColumn | null>(null);
  const clock = useClock();

  const allAgents = Array.from(agents.values());
  const runningAgents = allAgents.filter((a) => a.status === "running").length;
  const taskById = (id: string) => tasks.get(id);

  const handleNew = async () => {
    try {
      const t = await useHermes
        .getState()
        .createTask({ title: "New task", column: "backlog" });
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
      <header className="hm-bar">
        <div className="hm-bar-brand">
          <Workflow size={15} />
          <span className="hm-bar-name">HERMES//CMD</span>
          <span className="hm-bar-sub">agent orchestration</span>
        </div>

        <div className="hm-seg">
          <button
            className={view === "floor" ? "active" : ""}
            onClick={() => setView("floor")}
          >
            <LayoutGrid size={13} /> Floor
          </button>
          <button
            className={view === "board" ? "active" : ""}
            onClick={() => setView("board")}
          >
            <Columns3 size={13} /> Board
          </button>
        </div>

        <div className="hm-bar-right">
          <Stat label="active" value={`${runningAgents}/${allAgents.length}`} live={runningAgents > 0} />
          <Stat label="tasks" value={String(tasks.size)} />
          <span className="hm-clock">{clock}</span>
          <button className="hm-btn primary" onClick={handleNew}>
            <Plus size={14} /> New task
          </button>
        </div>
      </header>

      {view === "floor" ? (
        <FloorView
          tasks={tasks}
          agents={agents}
          taskById={taskById}
          onOpen={setOpenTaskId}
          onStop={(id) => void useHermes.getState().stopTask(id)}
        />
      ) : (
        <BoardView
          tasks={tasks}
          agents={agents}
          dragOverCol={dragOverCol}
          setDragOverCol={setDragOverCol}
          onOpen={setOpenTaskId}
          onDispatch={handleDispatch}
          onStop={(id) => void useHermes.getState().stopTask(id)}
        />
      )}

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

function Stat({
  label,
  value,
  live,
}: {
  label: string;
  value: string;
  live?: boolean;
}) {
  return (
    <div className="hm-stat">
      <span className="hm-stat-label">{label}</span>
      <span className={`hm-stat-val${live ? " live" : ""}`}>{value}</span>
    </div>
  );
}

// ── Floor: the live agent grid + reports rail ───────────────────────────

function FloorView({
  tasks,
  agents,
  taskById,
  onOpen,
  onStop,
}: {
  tasks: Map<string, HermesTask>;
  agents: Map<string, HermesAgent>;
  taskById: (id: string) => HermesTask | undefined;
  onOpen: (id: string) => void;
  onStop: (taskId: string) => void;
}) {
  // The floor = agents whose task is staged/in-flight (not backlog, not done).
  const floorAgents = Array.from(agents.values())
    .filter((a) => {
      const t = taskById(a.taskId);
      return t && t.column !== "backlog" && t.column !== "done";
    })
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        a.taskId.localeCompare(b.taskId) ||
        a.position - b.position,
    );

  const completedAgents = Array.from(agents.values()).filter(
    (a) => a.status === "completed",
  );
  const doneTasks = Array.from(tasks.values()).filter(
    (t) => t.column === "done",
  );

  return (
    <div className="hm-floor">
      <main className="hm-grid">
        {floorAgents.length === 0 ? (
          <div className="hm-floor-empty">
            <Bot size={26} />
            <p>No agents on the floor.</p>
            <span>
              Create a task, stage it in the <b>Board</b>, then dispatch its
              swarm — agents stream their work here.
            </span>
          </div>
        ) : (
          floorAgents.map((a, i) => (
            <AgentCard
              key={a.id}
              agent={a}
              index={i}
              task={taskById(a.taskId)}
              onOpen={() => onOpen(a.taskId)}
              onStopAgent={() => void useHermes.getState().stopAgent(a.id)}
            />
          ))
        )}
      </main>

      <ReportsRail
        completedAgents={completedAgents}
        doneTasks={doneTasks}
        taskById={taskById}
        onOpen={onOpen}
        onStop={onStop}
      />
    </div>
  );
}

function AgentCard({
  agent,
  index,
  task,
  onOpen,
  onStopAgent,
}: {
  agent: HermesAgent;
  index: number;
  task: HermesTask | undefined;
  onOpen: () => void;
  onStopAgent: () => void;
}) {
  const running = agent.status === "running";
  const body =
    agent.error ||
    agent.output ||
    (running ? "starting…" : "no output yet");
  return (
    <div className={`hm-acard s-${CARD_STATUS[agent.status]}`} onClick={onOpen}>
      <div className="hm-acard-head">
        <div className="hm-acard-id">
          <span className="hm-acard-name">
            {agent.label || `Agent ${index + 1}`}
          </span>
          <span className="hm-acard-role">{task?.title || "—"}</span>
        </div>
        <span className={`hm-tag s-${CARD_STATUS[agent.status]}`}>
          {BADGE[agent.status]}
        </span>
      </div>
      {(agent.prompt || task?.prompt) && (
        <div className="hm-acard-task">
          ▸ {(agent.prompt || task?.prompt || "").split("\n")[0]}
        </div>
      )}
      <pre className={`hm-acard-log${agent.error ? " err" : ""}`}>{body}</pre>
      <div className="hm-acard-foot">
        <span className="hm-acard-state">{agent.status}</span>
        {running ? (
          <button
            className="hm-acard-act stop"
            onClick={(e) => {
              e.stopPropagation();
              onStopAgent();
            }}
          >
            <Square size={10} /> stop
          </button>
        ) : (
          <span className="hm-acard-expand">
            view <ChevronDown size={11} />
          </span>
        )}
      </div>
    </div>
  );
}

function ReportsRail({
  completedAgents,
  doneTasks,
  taskById,
  onOpen,
  onStop,
}: {
  completedAgents: HermesAgent[];
  doneTasks: HermesTask[];
  taskById: (id: string) => HermesTask | undefined;
  onOpen: (id: string) => void;
  onStop: (taskId: string) => void;
}) {
  const [tab, setTab] = useState<"reports" | "completed">("reports");
  void onStop;
  return (
    <aside className="hm-reports">
      <div className="hm-reports-tabs">
        <button
          className={tab === "reports" ? "active" : ""}
          onClick={() => setTab("reports")}
        >
          Reports <span>{completedAgents.length}</span>
        </button>
        <button
          className={tab === "completed" ? "active" : ""}
          onClick={() => setTab("completed")}
        >
          Completed <span>{doneTasks.length}</span>
        </button>
      </div>
      <div className="hm-reports-body">
        {tab === "reports" ? (
          completedAgents.length === 0 ? (
            <div className="hm-reports-empty">No agent reports yet.</div>
          ) : (
            completedAgents.map((a) => {
              const t = taskById(a.taskId);
              return (
                <button
                  key={a.id}
                  className="hm-report"
                  onClick={() => onOpen(a.taskId)}
                >
                  <span className="hm-report-sq" />
                  <span className="hm-report-title">{t?.title || "Task"}</span>
                  <span className="hm-report-meta">
                    {(a.label || "agent").toUpperCase()}
                  </span>
                </button>
              );
            })
          )
        ) : doneTasks.length === 0 ? (
          <div className="hm-reports-empty">Nothing completed yet.</div>
        ) : (
          doneTasks.map((t) => (
            <button
              key={t.id}
              className="hm-report"
              onClick={() => onOpen(t.id)}
            >
              <span className="hm-report-sq done" />
              <span className="hm-report-title">{t.title}</span>
              <span className="hm-report-meta">DONE</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

// ── Board: the kanban (staging) ─────────────────────────────────────────

function BoardView({
  tasks,
  agents,
  dragOverCol,
  setDragOverCol,
  onOpen,
  onDispatch,
  onStop,
}: {
  tasks: Map<string, HermesTask>;
  agents: Map<string, HermesAgent>;
  dragOverCol: HermesColumn | null;
  setDragOverCol: (c: HermesColumn | null) => void;
  onOpen: (id: string) => void;
  onDispatch: (id: string) => void;
  onStop: (id: string) => void;
}) {
  const tasksInColumn = (col: HermesColumn) =>
    Array.from(tasks.values())
      .filter((t) => t.column === col)
      .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
  const agentsForTask = (taskId: string) =>
    Array.from(agents.values()).filter((a) => a.taskId === taskId);

  return (
    <div className="hm-board">
      {HERMES_COLUMNS.map((col) => {
        const colTasks = tasksInColumn(col.id);
        const isRunningCol = col.id === "running";
        return (
          <div
            key={col.id}
            className={`hm-col${dragOverCol === col.id ? " drag-over" : ""}`}
            onDragOver={(e) => {
              if (isRunningCol) return;
              if (e.dataTransfer.types.includes(DRAG_MIME)) {
                e.preventDefault();
                setDragOverCol(col.id);
              }
            }}
            onDragLeave={() => setDragOverCol(null)}
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
                  agentStatuses={agentsForTask(t.id).map((a) => a.status)}
                  onOpen={() => onOpen(t.id)}
                  onDispatch={() => onDispatch(t.id)}
                  onStop={() => onStop(t.id)}
                />
              ))}
              {colTasks.length === 0 && <div className="hm-col-empty">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  agentStatuses,
  onOpen,
  onDispatch,
  onStop,
}: {
  task: HermesTask;
  agentStatuses: HermesStatus[];
  onOpen: () => void;
  onDispatch: () => void;
  onStop: () => void;
}) {
  const running = task.status === "running";
  const canDispatch =
    agentStatuses.length > 0 && task.column === "ready" && !running;
  return (
    <div
      className={`hm-card s-${CARD_STATUS[task.status]}`}
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
        <span className="hm-card-agents">
          <Bot size={11} /> {agentStatuses.length}
          <span className="hm-pips">
            {agentStatuses.slice(0, 6).map((s, i) => (
              <span key={i} className={`hm-pip s-${CARD_STATUS[s]}`} />
            ))}
          </span>
        </span>
        {task.createdBy === "rosie" && (
          <span className="hm-rosie-badge">ROSIE</span>
        )}
        {running ? (
          <button
            className="hm-card-act stop"
            onClick={(e) => {
              e.stopPropagation();
              onStop();
            }}
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
          >
            <Play size={11} /> Dispatch
          </button>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  Workflow,
  Plus,
  Play,
  Square,
  Bot,
  LayoutGrid,
  Columns3,
  Maximize2,
  X,
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
import {
  STATUS_LABEL,
  STATUS_CLS,
  STATUS_RANK,
  deptColor,
  tailLines,
  logKind,
  modelShort,
} from "@/apps/hermes/util";
import { mdToHtml } from "@/apps/hermes/md";
import { log } from "@/lib/log";

const DRAG_MIME = "application/x-hermes-task";

function projectRoot(): string | null {
  return useProjectStore.getState().active?.root_path ?? null;
}

function StatusTag({ status }: { status: HermesStatus }) {
  return (
    <span className={`hm-tag s-${STATUS_CLS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function useClock(): string {
  const [t, setT] = useState(() =>
    new Date().toLocaleTimeString("en-GB", { hour12: false }),
  );
  useEffect(() => {
    const id = setInterval(
      () => setT(new Date().toLocaleTimeString("en-GB", { hour12: false })),
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
  const [focusAgentId, setFocusAgentId] = useState<string | null>(null);
  const [reportAgentId, setReportAgentId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<HermesColumn | null>(null);
  const clock = useClock();

  const allAgents = Array.from(agents.values());
  const runningAgents = allAgents.filter((a) => a.status === "running").length;
  const reportCount = allAgents.filter((a) => a.status === "completed").length;
  const taskById = (id: string) => tasks.get(id);

  const handleNew = async () => {
    try {
      const t = await useHermes
        .getState()
        .createTask({ title: "New task", column: "backlog" });
      await useHermes.getState().addAgent(t.id);
      setOpenTaskId(t.id);
      setFocusAgentId(null);
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

  const openTaskFromAgent = (taskId: string, agentId: string | null) => {
    setFocusAgentId(agentId);
    setOpenTaskId(taskId);
  };

  const openTask = openTaskId ? tasks.get(openTaskId) ?? null : null;
  const reportAgent = reportAgentId ? agents.get(reportAgentId) ?? null : null;

  return (
    <div className="hm-shell">
      <header className="hm-bar">
        <div className="hm-brand">
          <Workflow size={16} />
          <h1>
            HERMES<b>//</b>CMD
          </h1>
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

        <div className="hm-bar-sp" />

        <div className="hm-stat live">
          <span className="sl">Active</span>
          <span className="sv">
            {String(runningAgents).padStart(2, "0")}
            <small> /{allAgents.length}</small>
          </span>
        </div>
        <div className="hm-stat accent">
          <span className="sl">Reports</span>
          <span className="sv">{String(reportCount).padStart(3, "0")}</span>
        </div>
        <div className="hm-clock mono">
          {clock} <span>LOCAL</span>
        </div>
        <div className={`hm-pill${runningAgents > 0 ? "" : " off"}`}>
          <span className="led" /> {runningAgents > 0 ? "Live" : "Idle"}
        </div>
        <button className="hm-btn primary" onClick={handleNew}>
          <Plus size={14} /> New task
        </button>
      </header>

      {view === "floor" ? (
        <FloorView
          tasks={tasks}
          agents={agents}
          taskById={taskById}
          onOpen={openTaskFromAgent}
          onOpenReport={setReportAgentId}
          onNew={handleNew}
        />
      ) : (
        <BoardView
          tasks={tasks}
          agents={agents}
          dragOverCol={dragOverCol}
          setDragOverCol={setDragOverCol}
          onOpen={(id) => openTaskFromAgent(id, null)}
          onDispatch={handleDispatch}
          onStop={(id) => void useHermes.getState().stopTask(id)}
        />
      )}

      {openTask && (
        <HermesTaskDetail
          task={openTask}
          focusAgentId={focusAgentId}
          onClose={() => setOpenTaskId(null)}
          onDispatch={() => handleDispatch(openTask.id)}
          onOpenReport={setReportAgentId}
        />
      )}

      {reportAgent && (
        <ReportDocModal
          agent={reportAgent}
          task={taskById(reportAgent.taskId)}
          onClose={() => setReportAgentId(null)}
        />
      )}
    </div>
  );
}

// ── Floor: department row + live agent grid + reports rail ──────────────

function FloorView({
  tasks,
  agents,
  taskById,
  onOpen,
  onOpenReport,
  onNew,
}: {
  tasks: Map<string, HermesTask>;
  agents: Map<string, HermesAgent>;
  taskById: (id: string) => HermesTask | undefined;
  onOpen: (taskId: string, agentId: string | null) => void;
  onOpenReport: (agentId: string) => void;
  onNew: () => void;
}) {
  const [filter, setFilter] = useState<string>("all");

  // The floor = agents whose task is staged or in-flight (not backlog / done).
  const onFloor = Array.from(agents.values()).filter((a) => {
    const t = taskById(a.taskId);
    return t && t.column !== "backlog" && t.column !== "done";
  });

  // Distinct tasks present on the floor become the "departments" (filter chips).
  const floorTaskIds = Array.from(new Set(onFloor.map((a) => a.taskId)));
  const floorTasks = floorTaskIds
    .map((id) => taskById(id))
    .filter((t): t is HermesTask => !!t)
    .sort((a, b) => a.createdAt - b.createdAt);

  const activeFilter =
    filter !== "all" && !floorTaskIds.includes(filter) ? "all" : filter;

  const shown = onFloor
    .filter((a) => activeFilter === "all" || a.taskId === activeFilter)
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        a.taskId.localeCompare(b.taskId) ||
        a.position - b.position,
    );

  const shownActive = shown.filter((a) => a.status === "running").length;

  const completedAgents = Array.from(agents.values()).filter(
    (a) => a.status === "completed",
  );
  const doneTasks = Array.from(tasks.values()).filter(
    (t) => t.column === "done",
  );

  return (
    <div className="hm-view">
      <div className="hm-floorbar">
        <span className="hm-fb-idx mono">01</span>
        <span className="hm-fb-title">Swarm Floor</span>
        <div className="hm-deptrow">
          <span
            className={`hm-deptchip${activeFilter === "all" ? " on" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </span>
          {floorTasks.map((t) => (
            <span
              key={t.id}
              className={`hm-deptchip${activeFilter === t.id ? " on" : ""}`}
              onClick={() => setFilter(t.id)}
              title={t.title}
            >
              <span className="ds" style={{ background: deptColor(t.id) }} />
              {t.title || "Untitled"}
            </span>
          ))}
          <span className="hm-deptchip add" onClick={onNew}>
            + New
          </span>
        </div>
        <span className="hm-fb-sp" />
        <span className="hm-fb-count mono">
          {shown.length} agents · {shownActive} active
        </span>
      </div>

      <div className="hm-floor">
        <main className="hm-grid">
          {shown.length === 0 ? (
            <div className="hm-floor-empty">
              <Bot size={26} />
              <p>No agents on the floor.</p>
              <span>
                Create a task, stage it in the <b>Board</b>, then dispatch its
                swarm — agents stream their work here live.
              </span>
            </div>
          ) : (
            shown.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                task={taskById(a.taskId)}
                onOpen={() => onOpen(a.taskId, a.id)}
                onStopAgent={() => void useHermes.getState().stopAgent(a.id)}
                onOpenReport={() => onOpenReport(a.id)}
                onContinue={() =>
                  void useHermes.getState().continueAgent(a.id, projectRoot())
                }
              />
            ))
          )}
        </main>

        <ReportsRail
          completedAgents={completedAgents}
          doneTasks={doneTasks}
          taskById={taskById}
          onOpenReport={onOpenReport}
          onOpenTask={(id) => onOpen(id, null)}
        />
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  task,
  onOpen,
  onStopAgent,
  onOpenReport,
  onContinue,
}: {
  agent: HermesAgent;
  task: HermesTask | undefined;
  onOpen: () => void;
  onStopAgent: () => void;
  onOpenReport: () => void;
  onContinue: () => void;
}) {
  const cls = STATUS_CLS[agent.status];
  const running = agent.status === "running";
  const done = agent.status === "completed";
  const paused = agent.status === "paused";
  const current = ((agent.prompt || task?.prompt || "").split("\n")[0] ?? "").trim();
  const lines = agent.error ? [] : tailLines(agent.output, 5);

  return (
    <div className={`hm-acard s-${cls}`} onClick={onOpen}>
      <div className="hm-acard-head">
        <span className={`hm-sdot s-${cls}`} />
        <div className="hm-acard-id">
          <span className="hm-acard-name">
            {agent.label || `Agent ${agent.position + 1}`}
          </span>
          <span className="hm-acard-role">
            {task?.title || "—"}
            <span className="hm-acard-model"> · {modelShort(agent.model)}</span>
          </span>
        </div>
        <StatusTag status={agent.status} />
      </div>

      <div className={`hm-acard-task${current ? "" : " empty"}`}>
        {current ? (
          <>
            <b>▸</b> {current}
          </>
        ) : (
          "idle — no instruction"
        )}
      </div>

      <div className="hm-alog">
        {agent.error ? (
          <div className="hm-logline error">{agent.error.split("\n")[0]}</div>
        ) : lines.length === 0 ? (
          <div className="hm-logline info">
            {running ? "starting…" : "awaiting activity"}
          </div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`hm-logline ${logKind(l)}`}>
              {l}
            </div>
          ))
        )}
      </div>

      <div className="hm-acard-foot">
        <span className={`hm-docs${done || paused ? "" : " none"}`}>
          {paused
            ? "paused — turn limit"
            : done
              ? "report ready"
              : running
                ? "streaming"
                : agent.status}
        </span>
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
        ) : paused ? (
          <button
            className="hm-acard-act continue"
            onClick={(e) => {
              e.stopPropagation();
              onContinue();
            }}
          >
            <Play size={10} /> continue
          </button>
        ) : done ? (
          <button
            className="hm-acard-expand"
            onClick={(e) => {
              e.stopPropagation();
              onOpenReport();
            }}
          >
            report ⤢
          </button>
        ) : (
          <span className="hm-acard-expand">expand ⤢</span>
        )}
      </div>
    </div>
  );
}

function ReportsRail({
  completedAgents,
  doneTasks,
  taskById,
  onOpenReport,
  onOpenTask,
}: {
  completedAgents: HermesAgent[];
  doneTasks: HermesTask[];
  taskById: (id: string) => HermesTask | undefined;
  onOpenReport: (agentId: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [tab, setTab] = useState<"reports" | "completed">("reports");
  return (
    <aside className="hm-rail">
      <div className="hm-rail-tabs">
        <button
          className={tab === "reports" ? "on" : ""}
          onClick={() => setTab("reports")}
        >
          Reports <span className="ct">{completedAgents.length}</span>
        </button>
        <button
          className={tab === "completed" ? "on" : ""}
          onClick={() => setTab("completed")}
        >
          Completed <span className="ct">{doneTasks.length}</span>
        </button>
      </div>
      <div className="hm-rail-body">
        {tab === "reports" ? (
          completedAgents.length === 0 ? (
            <div className="hm-rail-empty">
              No reports filed yet. They appear here when an agent completes a
              task and files its findings.
            </div>
          ) : (
            completedAgents.map((a) => {
              const t = taskById(a.taskId);
              return (
                <div
                  key={a.id}
                  className="hm-repcard"
                  onClick={() => onOpenReport(a.id)}
                >
                  <div className="rc-top">
                    <span
                      className="rc-chip"
                      style={{ background: deptColor(a.taskId) }}
                    />
                    <span className="rc-title">{t?.title || "Task"}</span>
                  </div>
                  <div className="rc-meta">
                    <span className="rc-agent">{a.label || "agent"}</span>
                  </div>
                </div>
              );
            })
          )
        ) : doneTasks.length === 0 ? (
          <div className="hm-rail-empty">No completed tasks yet.</div>
        ) : (
          doneTasks.map((t) => (
            <div
              key={t.id}
              className="hm-taskline"
              onClick={() => onOpenTask(t.id)}
            >
              <span className="tick">✓</span>
              <span className="tl-name">{t.title}</span>
              <span className="tl-agent mono">DONE</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

// ── Report doc modal — renders a completed agent's output as a document ──

function ReportDocModal({
  agent,
  task,
  onClose,
}: {
  agent: HermesAgent;
  task: HermesTask | undefined;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const body = (agent.output || "").trim();
  return (
    <div
      className="hm-overlay"
      onClick={(e) => {
        if ((e.target as HTMLElement).classList.contains("hm-overlay"))
          onClose();
      }}
    >
      <div className="hm-doc-modal">
        <div className="hm-dm-head">
          <div className="hm-dm-title">
            <b>{task?.title || "Report"}</b>
            <span className="mono">{agent.label || "agent"} · report</span>
          </div>
          <button className="hm-dm-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="hm-dm-body">
          {body ? (
            <div
              className="hm-doc"
              dangerouslySetInnerHTML={{ __html: mdToHtml(body) }}
            />
          ) : (
            <div className="hm-doc-empty">This agent filed no output.</div>
          )}
        </div>
      </div>
    </div>
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
              <span className="hm-col-count mono">{colTasks.length}</span>
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
      className={`hm-card s-${STATUS_CLS[task.status]}`}
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
              <span key={i} className={`hm-pip s-${STATUS_CLS[s]}`} />
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
        ) : (
          <span className="hm-card-open">
            <Maximize2 size={11} />
          </span>
        )}
      </div>
    </div>
  );
}

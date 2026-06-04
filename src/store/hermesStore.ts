import { create } from "zustand";
import { ulid } from "ulid";
import { log } from "@/lib/log";
import { ipc } from "@/lib/ipc";
import {
  type HermesTaskRow,
  type HermesAgentRow,
  listHermesTasks,
  listHermesAgents,
  insertHermesTask,
  updateHermesTask,
  deleteHermesTask,
  insertHermesAgent,
  updateHermesAgent,
  deleteHermesAgent,
} from "@/lib/db";

export type HermesColumn =
  | "backlog"
  | "ready"
  | "running"
  | "review"
  | "done"
  | "blocked";

export type HermesStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export const HERMES_COLUMNS: { id: HermesColumn; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "ready", label: "Ready" },
  { id: "running", label: "Running" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
  { id: "blocked", label: "Blocked" },
];

export type HermesAgent = {
  id: string;
  taskId: string;
  label: string;
  prompt: string;
  status: HermesStatus;
  output: string;
  error: string;
  sessionId: string | null;
  position: number;
};

export type HermesTask = {
  id: string;
  title: string;
  prompt: string;
  column: HermesColumn;
  position: number;
  status: HermesStatus;
  parentId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  dispatchedAt: number | null;
};

function rowToTask(r: HermesTaskRow): HermesTask {
  return {
    id: r.id,
    title: r.title,
    prompt: r.prompt,
    column: r.column_id as HermesColumn,
    position: r.position,
    status: r.status as HermesStatus,
    parentId: r.parent_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    dispatchedAt: r.dispatched_at,
  };
}

function rowToAgent(r: HermesAgentRow): HermesAgent {
  return {
    id: r.id,
    taskId: r.task_id,
    label: r.label,
    prompt: r.prompt,
    status: r.status as HermesStatus,
    output: r.output,
    error: r.error,
    sessionId: r.session_id,
    position: r.position,
  };
}

type HermesState = {
  tasks: Map<string, HermesTask>;
  agents: Map<string, HermesAgent>;
  loaded: boolean;

  /** Boot load: full replace from DB; reconcile agents/tasks left 'running'
   * by a previous quit back to a re-dispatchable state. */
  load: () => Promise<void>;
  /** In-session refresh (e.g. after ROSIE's MCP writes): merge from DB but
   * keep any locally-running task/agent so a live swarm isn't clobbered. */
  refresh: () => Promise<void>;

  list: () => HermesTask[];
  tasksInColumn: (col: HermesColumn) => HermesTask[];
  agentsForTask: (taskId: string) => HermesAgent[];

  createTask: (input: {
    title: string;
    prompt?: string;
    column?: HermesColumn;
    createdBy?: string;
  }) => Promise<HermesTask>;
  updateTask: (
    id: string,
    patch: { title?: string; prompt?: string },
  ) => Promise<void>;
  moveTask: (id: string, column: HermesColumn) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  addAgent: (
    taskId: string,
    prompt?: string,
    label?: string,
  ) => Promise<HermesAgent>;
  updateAgent: (
    id: string,
    patch: { prompt?: string; label?: string },
  ) => Promise<void>;
  removeAgent: (id: string) => Promise<void>;

  dispatch: (taskId: string, projectRoot?: string | null) => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  stopAgent: (agentId: string) => Promise<void>;

  // Applied from `hermes:*` Tauri events (engine is the DB writer during a run;
  // these mirror the live state into the store).
  applyAgentText: (taskId: string, agentId: string, text: string) => void;
  applyAgentStatus: (p: {
    taskId: string;
    agentId: string;
    status: HermesStatus;
    output: string;
    error: string;
    sessionId: string | null;
  }) => void;
  applyTask: (p: {
    taskId: string;
    status: HermesStatus;
    columnId: HermesColumn;
  }) => void;
};

export const useHermes = create<HermesState>((set, get) => ({
  tasks: new Map(),
  agents: new Map(),
  loaded: false,

  load: async () => {
    try {
      const [taskRows, agentRows] = await Promise.all([
        listHermesTasks(),
        listHermesAgents(),
      ]);
      const now = Date.now();
      const staleAgents = agentRows.filter((r) => r.status === "running");
      const staleTasks = taskRows.filter((r) => r.status === "running");
      await Promise.all([
        ...staleAgents.map((r) =>
          updateHermesAgent(r.id, {
            status: "idle",
            finished_at: now,
            updated_at: now,
          }),
        ),
        ...staleTasks.map((r) =>
          updateHermesTask(r.id, {
            status: "idle",
            column_id: "ready",
            updated_at: now,
          }),
        ),
      ]);
      const tasks = new Map<string, HermesTask>();
      for (const r of taskRows) {
        const t = rowToTask(r);
        if (r.status === "running") {
          t.status = "idle";
          t.column = "ready";
        }
        tasks.set(t.id, t);
      }
      const agents = new Map<string, HermesAgent>();
      for (const r of agentRows) {
        const a = rowToAgent(r);
        if (r.status === "running") a.status = "idle";
        agents.set(a.id, a);
      }
      set({ tasks, agents, loaded: true });
    } catch (e) {
      log.error("hermes load failed", e);
      set({ loaded: true });
    }
  },

  refresh: async () => {
    try {
      const [taskRows, agentRows] = await Promise.all([
        listHermesTasks(),
        listHermesAgents(),
      ]);
      set((s) => {
        const tasks = new Map<string, HermesTask>();
        for (const r of taskRows) {
          const inMem = s.tasks.get(r.id);
          tasks.set(
            r.id,
            inMem && inMem.status === "running" ? inMem : rowToTask(r),
          );
        }
        const agents = new Map<string, HermesAgent>();
        for (const r of agentRows) {
          const inMem = s.agents.get(r.id);
          agents.set(
            r.id,
            inMem && inMem.status === "running" ? inMem : rowToAgent(r),
          );
        }
        return { tasks, agents, loaded: true };
      });
    } catch (e) {
      log.warn("hermes refresh failed", e);
    }
  },

  list: () => Array.from(get().tasks.values()),

  tasksInColumn: (col) =>
    Array.from(get().tasks.values())
      .filter((t) => t.column === col)
      .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt),

  agentsForTask: (taskId) =>
    Array.from(get().agents.values())
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => a.position - b.position),

  createTask: async ({ title, prompt = "", column = "backlog", createdBy = "user" }) => {
    const id = ulid();
    const now = Date.now();
    const position = get().tasksInColumn(column).length;
    const row: HermesTaskRow = {
      id,
      title,
      prompt,
      column_id: column,
      position,
      status: "idle",
      parent_id: null,
      created_by: createdBy,
      created_at: now,
      updated_at: now,
      dispatched_at: null,
    };
    await insertHermesTask(row);
    const task = rowToTask(row);
    set((s) => {
      const tasks = new Map(s.tasks);
      tasks.set(id, task);
      return { tasks };
    });
    return task;
  },

  updateTask: async (id, patch) => {
    const now = Date.now();
    await updateHermesTask(id, { ...patch, updated_at: now });
    set((s) => {
      const t = s.tasks.get(id);
      if (!t) return {};
      const tasks = new Map(s.tasks);
      tasks.set(id, { ...t, ...patch, updatedAt: now });
      return { tasks };
    });
  },

  moveTask: async (id, column) => {
    const now = Date.now();
    const position = get().tasksInColumn(column).length;
    await updateHermesTask(id, { column_id: column, position, updated_at: now });
    set((s) => {
      const t = s.tasks.get(id);
      if (!t) return {};
      const tasks = new Map(s.tasks);
      tasks.set(id, { ...t, column, position, updatedAt: now });
      return { tasks };
    });
  },

  deleteTask: async (id) => {
    await deleteHermesTask(id);
    set((s) => {
      const tasks = new Map(s.tasks);
      tasks.delete(id);
      const agents = new Map(s.agents);
      for (const a of s.agents.values()) {
        if (a.taskId === id) agents.delete(a.id);
      }
      return { tasks, agents };
    });
  },

  addAgent: async (taskId, prompt = "", label = "") => {
    const id = ulid();
    const now = Date.now();
    const position = get().agentsForTask(taskId).length;
    const row: HermesAgentRow = {
      id,
      task_id: taskId,
      label,
      prompt,
      status: "idle",
      output: "",
      error: "",
      session_id: null,
      position,
      created_at: now,
      updated_at: now,
      started_at: null,
      finished_at: null,
    };
    await insertHermesAgent(row);
    const agent = rowToAgent(row);
    set((s) => {
      const agents = new Map(s.agents);
      agents.set(id, agent);
      return { agents };
    });
    return agent;
  },

  updateAgent: async (id, patch) => {
    const now = Date.now();
    await updateHermesAgent(id, { ...patch, updated_at: now });
    set((s) => {
      const a = s.agents.get(id);
      if (!a) return {};
      const agents = new Map(s.agents);
      agents.set(id, { ...a, ...patch });
      return { agents };
    });
  },

  removeAgent: async (id) => {
    await deleteHermesAgent(id);
    set((s) => {
      const agents = new Map(s.agents);
      agents.delete(id);
      return { agents };
    });
  },

  dispatch: async (taskId, projectRoot = null) => {
    const dispatchable = get()
      .agentsForTask(taskId)
      .filter((a) => a.status !== "running" && a.status !== "completed");
    if (dispatchable.length === 0) {
      throw new Error("Add an agent to this task before dispatching.");
    }
    // Optimistic: the engine writes the DB + emits events, but flip the board
    // immediately so Dispatch feels instant.
    set((s) => {
      const tasks = new Map(s.tasks);
      const t = tasks.get(taskId);
      if (t) tasks.set(taskId, { ...t, column: "running", status: "running" });
      const agents = new Map(s.agents);
      for (const a of dispatchable) {
        agents.set(a.id, { ...a, status: "running", output: "", error: "" });
      }
      return { tasks, agents };
    });
    try {
      await ipc.hermesDispatchTask(taskId, projectRoot);
    } catch (e) {
      log.error("hermes dispatch failed", e);
      // Revert optimistic state.
      set((s) => {
        const tasks = new Map(s.tasks);
        const t = tasks.get(taskId);
        if (t) tasks.set(taskId, { ...t, column: "ready", status: "idle" });
        const agents = new Map(s.agents);
        for (const a of dispatchable) {
          agents.set(a.id, { ...a, status: "idle" });
        }
        return { tasks, agents };
      });
      throw e;
    }
  },

  stopTask: async (taskId) => {
    try {
      await ipc.hermesStopTask(taskId);
    } catch (e) {
      log.warn("hermes stop task failed", e);
    }
  },

  stopAgent: async (agentId) => {
    try {
      await ipc.hermesStopAgent(agentId);
    } catch (e) {
      log.warn("hermes stop agent failed", e);
    }
  },

  applyAgentText: (_taskId, agentId, text) =>
    set((s) => {
      const a = s.agents.get(agentId);
      if (!a) return {};
      const agents = new Map(s.agents);
      agents.set(agentId, { ...a, output: text, status: "running" });
      return { agents };
    }),

  applyAgentStatus: (p) =>
    set((s) => {
      const a = s.agents.get(p.agentId);
      if (!a) return {};
      const agents = new Map(s.agents);
      agents.set(p.agentId, {
        ...a,
        status: p.status,
        output: p.output || a.output,
        error: p.error || "",
        sessionId: p.sessionId ?? a.sessionId,
      });
      return { agents };
    }),

  applyTask: (p) =>
    set((s) => {
      const t = s.tasks.get(p.taskId);
      if (!t) return {};
      const tasks = new Map(s.tasks);
      tasks.set(p.taskId, { ...t, status: p.status, column: p.columnId });
      return { tasks };
    }),
}));

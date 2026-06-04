import { beforeEach, describe, expect, it, vi } from "vitest";

// The store imports the DB helpers + ipc; stub the Tauri modules so importing
// it works in the test env. These tests only exercise the pure reducers and
// selectors (seeded via setState) — they never hit the DB.
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn(async () => ({ execute: vi.fn(), select: vi.fn(async () => []) })) },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import {
  useHermes,
  type HermesTask,
  type HermesAgent,
} from "@/store/hermesStore";

function task(p: Partial<HermesTask> & { id: string }): HermesTask {
  return {
    id: p.id,
    title: p.title ?? p.id,
    prompt: p.prompt ?? "",
    column: p.column ?? "backlog",
    position: p.position ?? 0,
    status: p.status ?? "idle",
    parentId: p.parentId ?? null,
    createdBy: p.createdBy ?? "user",
    createdAt: p.createdAt ?? 0,
    updatedAt: p.updatedAt ?? 0,
    dispatchedAt: p.dispatchedAt ?? null,
  };
}
function agent(p: Partial<HermesAgent> & { id: string; taskId: string }): HermesAgent {
  return {
    id: p.id,
    taskId: p.taskId,
    label: p.label ?? "",
    prompt: p.prompt ?? "",
    status: p.status ?? "idle",
    output: p.output ?? "",
    error: p.error ?? "",
    sessionId: p.sessionId ?? null,
    position: p.position ?? 0,
  };
}

beforeEach(() => {
  useHermes.setState({ tasks: new Map(), agents: new Map(), loaded: true });
});

describe("hermes store selectors", () => {
  it("tasksInColumn returns only that column, ordered by position", () => {
    useHermes.setState({
      tasks: new Map([
        ["b", task({ id: "b", column: "ready", position: 1 })],
        ["a", task({ id: "a", column: "ready", position: 0 })],
        ["c", task({ id: "c", column: "done", position: 0 })],
      ]),
    });
    const ready = useHermes.getState().tasksInColumn("ready");
    expect(ready.map((t) => t.id)).toEqual(["a", "b"]);
    expect(useHermes.getState().tasksInColumn("done").map((t) => t.id)).toEqual(["c"]);
    expect(useHermes.getState().tasksInColumn("backlog")).toEqual([]);
  });

  it("agentsForTask filters by task and sorts by position", () => {
    useHermes.setState({
      agents: new Map([
        ["a2", agent({ id: "a2", taskId: "t1", position: 1 })],
        ["a1", agent({ id: "a1", taskId: "t1", position: 0 })],
        ["a3", agent({ id: "a3", taskId: "t2", position: 0 })],
      ]),
    });
    expect(useHermes.getState().agentsForTask("t1").map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(useHermes.getState().agentsForTask("t2").map((a) => a.id)).toEqual(["a3"]);
  });
});

describe("hermes store event reducers", () => {
  it("applyAgentText sets live output and flips the agent to running", () => {
    useHermes.setState({
      agents: new Map([["a1", agent({ id: "a1", taskId: "t1", status: "idle" })]]),
    });
    useHermes.getState().applyAgentText("t1", "a1", "partial output");
    const a = useHermes.getState().agents.get("a1")!;
    expect(a.output).toBe("partial output");
    expect(a.status).toBe("running");
  });

  it("applyAgentStatus records terminal status + output + error", () => {
    useHermes.setState({
      agents: new Map([["a1", agent({ id: "a1", taskId: "t1", status: "running" })]]),
    });
    useHermes.getState().applyAgentStatus({
      taskId: "t1",
      agentId: "a1",
      status: "completed",
      output: "final",
      error: "",
      sessionId: "sess-1",
    });
    const a = useHermes.getState().agents.get("a1")!;
    expect(a.status).toBe("completed");
    expect(a.output).toBe("final");
    expect(a.sessionId).toBe("sess-1");
  });

  it("applyTask rolls the task status + column up from the engine", () => {
    useHermes.setState({
      tasks: new Map([["t1", task({ id: "t1", column: "running", status: "running" })]]),
    });
    useHermes.getState().applyTask({ taskId: "t1", status: "completed", columnId: "review" });
    const t = useHermes.getState().tasks.get("t1")!;
    expect(t.status).toBe("completed");
    expect(t.column).toBe("review");
  });

  it("reducers are no-ops for unknown ids", () => {
    useHermes.getState().applyAgentText("t1", "missing", "x");
    useHermes.getState().applyTask({ taskId: "missing", status: "failed", columnId: "blocked" });
    expect(useHermes.getState().agents.size).toBe(0);
    expect(useHermes.getState().tasks.size).toBe(0);
  });
});

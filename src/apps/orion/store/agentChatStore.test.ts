import { beforeEach, describe, expect, it } from "vitest";
import { applyAgentEvent, useAgentChats, type AgentSession } from "./agentChatStore";
import { stepSummary } from "../ClaudeCodePanel";

const base = (): AgentSession => ({ agent: "codex", view: "chat", turns: [], sessionId: null, running: true });

describe("agent chat reducer", () => {
  it("keeps the session id and builds one agent turn from text snapshots and steps", () => {
    let s = base();
    s = applyAgentEvent(s, { kind: "init", sessionId: "t1" });
    s = applyAgentEvent(s, { kind: "text", id: "a", text: "Wor" });
    s = applyAgentEvent(s, { kind: "text", id: "a", text: "Working" });
    s = applyAgentEvent(s, { kind: "tool", id: "c1", name: "shell", input: { command: "ls" } });
    s = applyAgentEvent(s, { kind: "tool", id: "c1", name: "shell", input: { command: "ls" } });
    s = applyAgentEvent(s, { kind: "tool_result", id: "c1", output: "a.txt", isError: false });
    expect(s.sessionId).toBe("t1");
    expect(s.turns).toHaveLength(1);
    const parts = s.turns[0]!.parts;
    expect(parts.map((p) => p.type)).toEqual(["text", "tool"]);
    expect(parts[0]).toMatchObject({ text: "Working" });
    expect(parts[1]).toMatchObject({ step: { output: "a.txt", done: true, isError: false } });
  });

  it("starts a new agent turn after each user message", () => {
    useAgentChats.setState({ sessions: {} });
    const st = useAgentChats.getState();
    st.ensure("c", "pi");
    st.begin("c", "hi");
    st.apply("c", { kind: "text", id: "x", text: "Hello" });
    st.finish("c");
    st.begin("c", "again");
    st.apply("c", { kind: "text", id: "y", text: "Sure" });
    const turns = useAgentChats.getState().sessions.c!.turns;
    expect(turns.map((t) => t.role)).toEqual(["user", "agent", "user", "agent"]);
  });

  beforeEach(() => useAgentChats.setState({ sessions: {} }));

  it("finishing stops open steps, records the error and clears running", () => {
    const st = useAgentChats.getState();
    st.ensure("c", "claude");
    st.begin("c", "go");
    st.apply("c", { kind: "tool", id: "t", name: "Bash", input: { command: "sleep 9" } });
    st.finish("c", "Cancelled");
    const s = useAgentChats.getState().sessions.c!;
    expect(s.running).toBe(false);
    const parts = s.turns[1]!.parts;
    expect(parts[0]).toMatchObject({ type: "tool", step: { done: true } });
    expect(parts[1]).toMatchObject({ type: "notice", error: true, text: "Cancelled" });
  });

  it("new chat clears the thread and session but keeps the view", () => {
    const st = useAgentChats.getState();
    st.ensure("c", "hermes");
    st.setView("c", "terminal");
    st.begin("c", "hi");
    st.apply("c", { kind: "result", sessionId: "h1" });
    st.finish("c");
    st.reset("c");
    expect(useAgentChats.getState().sessions.c).toMatchObject({ turns: [], sessionId: null, view: "terminal", agent: "hermes" });
  });
});

describe("step summary", () => {
  it("shows the command, path or edited files", () => {
    expect(stepSummary({ input: { command: "/bin/zsh -lc \"npm test\"" } })).toBe("npm test");
    expect(stepSummary({ input: { file_path: "/p/a.ts" } })).toBe("/p/a.ts");
    expect(stepSummary({ input: { changes: [{ path: "a.ts" }, { path: "b.ts" }] } })).toBe("a.ts, b.ts");
    expect(stepSummary({ input: null })).toBe("");
  });
});

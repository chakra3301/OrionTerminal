import { describe, it, expect } from "vitest";
import { newRun, applyCcEvent } from "./ccRun";

describe("ccRun reducer", () => {
  it("starts streaming with empty text", () => {
    const r = newRun("run1", "p1", "c1");
    expect(r.status).toBe("streaming");
    expect(r.text).toBe("");
    expect(r.tools).toEqual([]);
  });

  it("init stores session id", () => {
    const r = applyCcEvent(newRun("r", "p", "c"), {
      kind: "init",
      sessionId: "s1",
    });
    expect(r.sessionId).toBe("s1");
  });

  it("assistant replaces text (accumulated snapshots)", () => {
    let r = newRun("r", "p", "c");
    r = applyCcEvent(r, { kind: "assistant", text: "hello" });
    r = applyCcEvent(r, { kind: "assistant", text: "hello world" });
    expect(r.text).toBe("hello world");
  });

  it("tool_use then tool_result attaches to the same call", () => {
    let r = newRun("r", "p", "c");
    r = applyCcEvent(r, {
      kind: "tool_use",
      id: "t1",
      name: "write",
      input: { path: "a.md" },
    });
    expect(r.tools).toHaveLength(1);
    r = applyCcEvent(r, {
      kind: "tool_result",
      id: "t1",
      content: "ok",
      isError: false,
    });
    expect(r.tools[0]?.result).toBe("ok");
    expect(r.tools[0]?.isError).toBe(false);
  });

  it("result marks done and records cost", () => {
    let r = newRun("r", "p", "c");
    r = applyCcEvent(r, { kind: "result", sessionId: "s2", cost: 0.42 });
    expect(r.status).toBe("done");
    expect(r.cost).toBe(0.42);
    expect(r.sessionId).toBe("s2");
  });

  it("is immutable — does not mutate the input run", () => {
    const r0 = newRun("r", "p", "c");
    const r1 = applyCcEvent(r0, { kind: "assistant", text: "x" });
    expect(r0.text).toBe("");
    expect(r1).not.toBe(r0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { beginUiRun, currentUiRun, revokeUiRun, uiActionGuard } from "./uiActionRuns";
import { clearXDesignActivities, runXDesignUiAction, xdesignProjectChangeReason } from "@/apps/xdesign/runtimeActivity";
import { ipc } from "@/lib/ipc";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
afterEach(() => { revokeUiRun("fixture"); clearXDesignActivities(); vi.clearAllMocks(); });

describe("UI action turn lifetimes", () => {
  it("rejects an unknown or stopped run instead of treating it as legacy", () => {
    expect(() => uiActionGuard({ runId: "unknown" })()).toThrow(/late UI action/);
    const end = beginUiRun("fixture");
    const guard = uiActionGuard({ runId: currentUiRun("fixture") });
    expect(guard).not.toThrow();
    end();
    expect(guard).toThrow(/late UI action/);
  });

  it("does not revive a cancelled callback when the same chat starts again", () => {
    const endOld = beginUiRun("fixture");
    const old = uiActionGuard({ runId: currentUiRun("fixture") });
    beginUiRun("fixture");
    const next = currentUiRun("fixture");
    endOld();
    expect(old).toThrow(/late UI action/);
    expect(currentUiRun("fixture")).toBe(next);
    expect(uiActionGuard({ runId: next })).not.toThrow();
  });

  it("expires queued work even for unmanaged legacy tools", () => {
    expect(uiActionGuard({ expiresAt: Date.now() })).toThrow(/expired/);
    expect(uiActionGuard({ expiresAt: Number.NaN })).toThrow(/expired/);
    expect(uiActionGuard({ runId: null, expiresAt: Date.now() + 5000 })).not.toThrow();
  });

  it("rechecks cancellation after asynchronous preparation before mutating", async () => {
    beginUiRun("fixture");
    const guard = uiActionGuard({ runId: currentUiRun("fixture") });
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const mutate = vi.fn();
    const action = runXDesignUiAction(guard, async () => { await wait; guard(); mutate(); });
    expect(xdesignProjectChangeReason()).toMatch(/before switching projects/);
    revokeUiRun("fixture");
    release();
    await expect(action).rejects.toThrow(/late UI action/);
    expect(mutate).not.toHaveBeenCalled();
    expect(xdesignProjectChangeReason()).toBeNull();
  });

  it("keeps the project locked until an already executing tool settles", async () => {
    beginUiRun("fixture");
    let release!: () => void;
    const action = runXDesignUiAction(uiActionGuard({ runId: currentUiRun("fixture") }), () => new Promise<void>((resolve) => { release = resolve; }));
    revokeUiRun("fixture");
    expect(xdesignProjectChangeReason()).toMatch(/current AI action/);
    release();
    await action;
    expect(xdesignProjectChangeReason()).toBeNull();
  });

  it("does not acquire a project lock or run work for stale requests", async () => {
    const work = vi.fn();
    await expect(runXDesignUiAction(uiActionGuard({ runId: "stale" }), work)).rejects.toThrow(/late UI action/);
    expect(work).not.toHaveBeenCalled();
    expect(xdesignProjectChangeReason()).toBeNull();
  });

  it("passes the current identity through every shared native connector", async () => {
    beginUiRun("fixture");
    const runId = currentUiRun("fixture");
    await ipc.claudeSend("fixture", "hi", null, null);
    await ipc.cliSend("codex_cli", "fixture", "hi", null, null, "model", "", null, []);
    await ipc.cliSend("gemini_cli", "fixture", "hi", null, null, "model", "", null, []);
    await ipc.cursorSend("fixture", "hi", null, null, "model", "", "builtin:cursor-sdk", []);
    await ipc.runtimeSend("fixture", "provider", "model", "", [], []);
    expect(vi.mocked(invoke).mock.calls).toHaveLength(5);
    for (const [, args] of vi.mocked(invoke).mock.calls) expect(args).toMatchObject({ uiRunId: runId });
    revokeUiRun("fixture");
    await ipc.claudeSend("fixture", "hi", null, null);
    expect(invoke).toHaveBeenLastCalledWith("claude_send", expect.objectContaining({ uiRunId: null }));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ listeners: new Map<string, (event: { payload: unknown }) => void>(), send: vi.fn(), cancel: vi.fn(async () => {}), forget: vi.fn(), workDir: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => { mocks.listeners.set(name, cb); return () => mocks.listeners.delete(name); }) }));
vi.mock("@/lib/ipc", () => ({ ipc: { analysisWorkDir: mocks.workDir } }));
vi.mock("./dispatchSend", () => ({ dispatchSend: mocks.send, dispatchCancel: mocks.cancel, forgetDispatch: mocks.forget, routeFor: () => ({ engine: "codex_cli" }) }));
vi.mock("./resolveSend", () => ({ resolveSendFromStores: () => ({ model: "codex" }) }));
vi.mock("@/store/providersStore", () => ({ useProvidersStore: { getState: () => ({ providers: [] }) } }));
import { runAgentTurn } from "./agentTurn";
const args = { chatId: "turn-test", value: "codex", prompt: "build it", history: [{ role: "user" as const, content: "build it" }] };
function exit(code = 0) { mocks.listeners.get("claude:exit")?.({ payload: { chatId: args.chatId, code, error: null } }); }
beforeEach(() => { mocks.listeners.clear(); vi.clearAllMocks(); mocks.workDir.mockResolvedValue("/private/agent-fixture"); });

describe("shared agent turn lifecycle", () => {
  it("subscribes before dispatch and captures synchronous output and exit", async () => {
    mocks.send.mockImplementation(async () => {
      expect(mocks.listeners.size).toBe(2);
      mocks.listeners.get("claude:event")?.({ payload: { chatId: args.chatId, event: { type: "assistant", message: { content: [{ type: "text", text: "Done" }] } } } });
      exit();
    });
    expect(await runAgentTurn(args)).toBe("Done");
    expect(mocks.listeners.size).toBe(0);
    expect(mocks.forget).toHaveBeenCalledWith(args.chatId);
    expect(mocks.send.mock.calls[0]![0].projectRoot).toBe("/private/agent-fixture");
  });
  it("renders distinct native message IDs as separate paragraphs", async () => {
    mocks.send.mockImplementation(async () => {
      for (const [id, text] of [["a", "Checking."], ["b", "Done."], ["b", "Done."]]) {
        mocks.listeners.get("claude:event")?.({ payload: { chatId: args.chatId, event: { type: "assistant", textMode: "snapshot", message: { id, content: [{ type: "text", text }] } } } });
      }
      exit();
    });
    const onText = vi.fn();
    expect(await runAgentTurn(args, { onText })).toBe("Checking.\n\nDone.");
    expect(onText).toHaveBeenLastCalledWith("Checking.\n\nDone.");
  });
  it("preserves an explicitly supplied project directory", async () => {
    mocks.send.mockImplementation(async () => exit());
    await runAgentTurn({ ...args, projectRoot: "/explicit/project" });
    expect(mocks.workDir).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0]![0].projectRoot).toBe("/explicit/project");
  });
  it("does not launch after cancellation while a private directory is being prepared", async () => {
    let release!: (path: string) => void;
    mocks.workDir.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const controller = new AbortController();
    const pending = runAgentTurn(args, { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow("Cancelled");
    await vi.waitFor(() => expect(mocks.workDir).toHaveBeenCalled());
    controller.abort(); await rejected;
    release("/private/late"); await new Promise((r) => setTimeout(r, 0));
    expect(mocks.send).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
  });
  it("does not start an already-cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runAgentTurn(args, { signal: controller.signal })).rejects.toThrow("Cancelled");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
  });
  it("stops a running connector and cleans event listeners", async () => {
    mocks.send.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = runAgentTurn(args, { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow("Cancelled");
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalled());
    controller.abort(); await rejected;
    expect(mocks.cancel).toHaveBeenCalledWith(args.chatId, args.value);
    expect(mocks.listeners.size).toBe(0);
  });
  it("propagates exit failures instead of reporting empty success", async () => {
    mocks.send.mockImplementation(async () => exit(9));
    await expect(runAgentTurn(args)).rejects.toThrow("code 9");
  });
  it("includes preceding history when starting a new CLI session", async () => {
    mocks.send.mockImplementation(async () => exit());
    await runAgentTurn({ ...args, history: [{ role: "user", content: "original request" }, { role: "assistant", content: "original answer" }, ...args.history] });
    expect(mocks.send.mock.calls[0]![0].prompt).toContain("original answer");
  });
});

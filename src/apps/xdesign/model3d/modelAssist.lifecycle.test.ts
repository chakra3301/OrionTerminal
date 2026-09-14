import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Set<(event: { payload: any }) => void>>(),
  send: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined),
  pass: vi.fn(() => "complete"),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: any }) => void) => {
    const set = mocks.handlers.get(name) ?? new Set();
    set.add(handler);
    mocks.handlers.set(name, set);
    return () => { set.delete(handler); };
  }),
}));
vi.mock("@/features/agents/dispatchSend", () => ({
  dispatchSend: mocks.send, dispatchCancel: mocks.cancel,
  forgetDispatch: vi.fn(), selectionSupportsImages: () => true,
}));
vi.mock("@/store/modelPrefsStore", () => ({ useModelPrefs: { getState: () => ({ modelFor: () => "codex-test" }) } }));
vi.mock("./passOrchestrator", () => ({ currentPass: mocks.pass, passOrderFor: () => [] }));

import { useModelAssist } from "./modelAssist";
import { useModelStore } from "./modelStore";
import { useModelFeed } from "./modelTranscriptFeed";

function emit(name: string, payload: any) {
  for (const handler of mocks.handlers.get(name) ?? []) handler({ payload });
}
beforeEach(() => {
  useModelAssist.getState().clear();
  mocks.handlers.clear();
  mocks.send.mockReset();
  mocks.cancel.mockClear();
  mocks.pass.mockReturnValue("complete");
  useModelStore.setState({ reference: { assetId: null, filePath: "/reference.png", dataUrl: "data:image/png;base64,test", w: 10, h: 10 } });
});

describe("Model Assist lifecycle", () => {
  it("subscribes before dispatch even when native IPC resolves only after the turn", async () => {
    mocks.send.mockImplementation(async ({ chatId }) => {
      expect(mocks.handlers.get("claude:event")?.size).toBe(1);
      expect(mocks.handlers.get("claude:exit")?.size).toBe(1);
      emit("claude:event", { chatId, event: { type: "result", session_id: "session", is_error: false } });
    });
    await useModelAssist.getState().send("rebuild");
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(useModelAssist.getState().busy).toBe(false);
    expect(useModelAssist.getState().sessionId).toBe("session");
    expect(mocks.handlers.get("claude:event")?.size).toBe(0);
  });

  it("Stop never launches another autonomous round", async () => {
    mocks.pass.mockReturnValue("blockout");
    mocks.send.mockImplementation(() => new Promise(() => {}));
    const pending = useModelAssist.getState().send("rebuild");
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    const chatId = useModelAssist.getState().chatId;
    useModelAssist.getState().cancel();
    emit("claude:exit", { chatId, code: null, error: null });
    await pending;
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.cancel).toHaveBeenCalledWith(chatId, "codex-test");
    expect(useModelAssist.getState().sessionId).toBeNull();
  });

  it("a nonzero exit is a failure, not permission to auto-continue", async () => {
    mocks.pass.mockReturnValue("blockout");
    mocks.send.mockImplementation(async ({ chatId }) => {
      emit("claude:exit", { chatId, code: 2, error: "Login required" });
    });
    await useModelAssist.getState().send("rebuild");
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(useModelFeed.getState().items.some((item) => item.kind === "assistant" && item.text.includes("Login required"))).toBe(true);
  });
});

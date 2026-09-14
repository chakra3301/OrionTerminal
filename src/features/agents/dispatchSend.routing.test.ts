import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    claudeSend: vi.fn().mockResolvedValue(undefined),
    runtimeSend: vi.fn().mockResolvedValue(undefined),
    claudeCancel: vi.fn().mockResolvedValue(undefined),
    runtimeCancel: vi.fn().mockResolvedValue(undefined),
    cliSend: vi.fn().mockResolvedValue(undefined),
    cliCancel: vi.fn().mockResolvedValue(undefined),
    cursorSend: vi.fn().mockResolvedValue(undefined),
    cursorCancel: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/db", () => ({ getAppState: vi.fn(async () => null), setAppState: vi.fn(async () => {}) }));

import { ipc } from "@/lib/ipc";
import { dispatchSend, dispatchResolved, dispatchCancel, providerSessionIdentity } from "./dispatchSend";
import { rememberSessionOwner } from "./sessionOwnership";
import { useProvidersStore } from "@/store/providersStore";
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, CURSOR_SDK_PROVIDER, GEMINI_CLI_PROVIDER } from "./seedData";
import type { Provider } from "./agentTypes";

const openai: Provider = {
  id: "p1",
  name: "OpenAI",
  kind: "openai",
  baseUrl: "https://api.openai.com/v1",
  models: [{ id: "gpt-4o", label: "GPT-4o" }],
  keyRef: "p1",
  enabled: true,
  builtin: false,
};

beforeEach(async () => {
  vi.clearAllMocks();
  useProvidersStore.setState({
    providers: [BUILTIN_PROVIDER, openai, CODEX_CLI_PROVIDER, GEMINI_CLI_PROVIDER, CURSOR_SDK_PROVIDER],
    loaded: true,
  });
  await rememberSessionOwner("sess", providerSessionIdentity(BUILTIN_PROVIDER));
  await rememberSessionOwner("t1", providerSessionIdentity(CODEX_CLI_PROVIDER));
  await rememberSessionOwner("ag-1", providerSessionIdentity(CURSOR_SDK_PROVIDER));
});

describe("dispatchSend routing", () => {
  it("forwards empty CLI grants and starts restricted Codex turns fresh with history", async () => {
    await dispatchResolved("restricted-codex", { model: "gpt-5.6-sol", actionModel: null, systemAppend: null, allowedTools: [] },
      "continue", [{ role: "assistant", content: "saved restricted context" }], { sessionId: "t1" });
    const args = vi.mocked(ipc.cliSend).mock.calls[0]!;
    expect(args[4]).toBeNull();
    expect(args[8]).toEqual([]);
    expect(args[2]).toContain("saved restricted context");
  });

  it("forwards narrow Gemini tool grants instead of losing them at IPC", async () => {
    await dispatchResolved("restricted-gemini", { model: "gemini-2.5-pro", actionModel: null, systemAppend: null, allowedTools: ["Read"] }, "read", [], {});
    expect(vi.mocked(ipc.cliSend).mock.calls[0]![8]).toEqual(["Read"]);
  });

  it("does not resume older Cursor tool state for a restricted turn", async () => {
    await dispatchResolved("restricted-cursor", { model: "composer-2.5", actionModel: null, systemAppend: null, allowedTools: ["Read"] },
      "continue", [{ role: "assistant", content: "saved cursor context" }], { sessionId: "ag-1" });
    expect(vi.mocked(ipc.cursorSend).mock.calls[0]![3]).toBeNull();
    expect(vi.mocked(ipc.cursorSend).mock.calls[0]![1]).toContain("saved cursor context");
  });
  it("drops unknown restored sessions while retaining prior text context", async () => {
    await dispatchSend({ chatId: "restored", value: "gpt-5.6-sol", prompt: "continue", history: [{ role: "assistant", content: "saved context" }], sessionId: "unbound-legacy-session" });
    const args = vi.mocked(ipc.cliSend).mock.calls[0]!;
    expect(args[4]).toBeNull();
    expect(args[2]).toContain("saved context");
  });

  it("cancels before the ownership lookup completes without launching an orphan", async () => {
    await rememberSessionOwner("cancel-pending-session", providerSessionIdentity(CODEX_CLI_PROVIDER));
    const pending = dispatchSend({ chatId: "cancel-pending-lookup", value: "gpt-5.6-sol", prompt: "continue", history: [], sessionId: "cancel-pending-session" });
    const rejected = expect(pending).rejects.toThrow("Cancelled before connector start");
    useProvidersStore.setState({ providers: [] });
    await dispatchCancel("cancel-pending-lookup", "gpt-5.6-sol");
    await rejected;
    expect(ipc.cliSend).not.toHaveBeenCalled();
    expect(ipc.cliCancel).toHaveBeenCalledWith("cancel-pending-lookup");
  });

  it("invalidates ownership when a provider's credential reference changes", async () => {
    useProvidersStore.setState({ providers: [{ ...CODEX_CLI_PROVIDER, keyRef: "different-account" }] });
    await dispatchSend({ chatId: "changed-credential", value: "gpt-5.6-sol", prompt: "continue", history: [], sessionId: "t1" });
    expect(vi.mocked(ipc.cliSend).mock.calls[0]![4]).toBeNull();
  });
  it("a Claude model calls claudeSend with byte-identical args and never runtimeSend", async () => {
    await dispatchSend({
      chatId: "c1",
      value: "claude-opus-4-8",
      prompt: "PROMPT",
      history: [{ role: "user", content: "hi" }],
      projectRoot: "/proj",
      sessionId: "sess",
      imagePath: "/snap.png",
    });
    expect(ipc.claudeSend).toHaveBeenCalledTimes(1);
    expect(ipc.claudeSend).toHaveBeenCalledWith(
      "c1",
      "PROMPT",
      "/proj",
      "sess",
      "/snap.png",
      "claude-opus-4-8",
      null,
      null,
    );
    expect(ipc.runtimeSend).not.toHaveBeenCalled();
  });

  it("a provider model calls runtimeSend with mapped args and never claudeSend", async () => {
    await dispatchSend({
      chatId: "c2",
      value: "gpt-4o",
      prompt: "PROMPT",
      history: [{ role: "user", content: "hi" }],
    });
    expect(ipc.runtimeSend).toHaveBeenCalledTimes(1);
    expect(ipc.runtimeSend).toHaveBeenCalledWith(
      "c2",
      "p1",
      "gpt-4o",
      "",
      [{ role: "user", content: "PROMPT" }],
      ["mcp__orion"],
    );
    expect(ipc.claudeSend).not.toHaveBeenCalled();
  });

  it("cancel routes to the owning engine", async () => {
    await dispatchCancel("c1", "claude-opus-4-8");
    expect(ipc.claudeCancel).toHaveBeenCalledWith("c1");
    await dispatchCancel("c2", "gpt-4o");
    expect(ipc.runtimeCancel).toHaveBeenCalledWith("c2");
  });
});

describe("dispatchSend CLI routing (Phase 2c)", () => {
  it("a codex model routes to cliSend and never claudeSend/runtimeSend", async () => {
    await dispatchSend({
      chatId: "c3", value: "gpt-5.6-sol", prompt: "PROMPT",
      history: [], projectRoot: "/proj", sessionId: "t1",
    });
    expect(ipc.cliSend).toHaveBeenCalledTimes(1);
    expect(ipc.cliSend).toHaveBeenCalledWith(
      "codex_cli", "c3", "PROMPT", "/proj", "t1", "gpt-5.6-sol", "", null, null,
    );
    expect(ipc.claudeSend).not.toHaveBeenCalled();
    expect(ipc.runtimeSend).not.toHaveBeenCalled();
  });
  it("a gemini model routes to cliSend with the gemini_cli engine", async () => {
    await dispatchSend({ chatId: "c4", value: "gemini-2.5-pro", prompt: "P", history: [] });
    expect(ipc.cliSend).toHaveBeenCalledWith(
      "gemini_cli", "c4", "P", null, null, "gemini-2.5-pro", "", null, null,
    );
    expect(ipc.claudeSend).not.toHaveBeenCalled();
  });
  it("cancel routes a CLI selection to cliCancel", async () => {
    await dispatchCancel("c3", "gpt-5.6-sol");
    expect(ipc.cliCancel).toHaveBeenCalledWith("c3");
  });
  it("a cursor model routes to cursorSend with the provider keyRef", async () => {
    await dispatchSend({ chatId: "c5", value: "composer-2.5", prompt: "P", history: [], projectRoot: "/proj", sessionId: "ag-1" });
    expect(ipc.cursorSend).toHaveBeenCalledWith(
      "c5", "P", "/proj", "ag-1", "composer-2.5", "", "builtin:cursor-sdk", null,
    );
    expect(ipc.claudeSend).not.toHaveBeenCalled();
    expect(ipc.runtimeSend).not.toHaveBeenCalled();
  });
  it("cancel routes a cursor selection to cursorCancel", async () => {
    await dispatchCancel("c5", "composer-2.5");
    expect(ipc.cursorCancel).toHaveBeenCalledWith("c5");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/ipc", () => ({ ipc: {
  claudeSend: vi.fn().mockResolvedValue(undefined), cliSend: vi.fn().mockResolvedValue(undefined), runtimeSend: vi.fn().mockResolvedValue(undefined),
  claudeCancel: vi.fn().mockResolvedValue(undefined), cliCancel: vi.fn().mockResolvedValue(undefined), runtimeCancel: vi.fn().mockResolvedValue(undefined),
} }));
vi.mock("@/lib/db", () => ({ getAppState: vi.fn().mockResolvedValue(null), setAppState: vi.fn().mockResolvedValue(undefined) }));
import { ipc } from "@/lib/ipc";
import { dispatchCancel, dispatchSend, recordDispatchedSession } from "./dispatchSend";
import { hasSessionOwner } from "./sessionOwnership";
import { useProvidersStore } from "@/store/providersStore";
import { BUILTIN_PROVIDER, CODEX_CLI_PROVIDER } from "./seedData";
import { providerModelValue } from "./modelSelection";
import { currentUiRun, uiActionGuard } from "./uiActionRuns";

const model = CODEX_CLI_PROVIDER.models[0]!.id;
const api = { ...CODEX_CLI_PROVIDER, id: "api", kind: "openai" as const, keyRef: "api-key", baseUrl: "https://api.openai.com/v1" };
beforeEach(() => {
  vi.clearAllMocks();
  useProvidersStore.setState({ providers: [BUILTIN_PROVIDER, CODEX_CLI_PROVIDER, api], loaded: true });
});
describe("connector parity regressions", () => {
  it("revokes UI callbacks before native Stop acknowledges and clears on completion", async () => {
    let finish!: () => void;
    let stopped!: () => void;
    vi.mocked(ipc.cliSend).mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    vi.mocked(ipc.cliCancel).mockImplementationOnce(() => new Promise<void>((resolve) => { stopped = resolve; }));
    const value = providerModelValue(CODEX_CLI_PROVIDER.id, model);
    const send = dispatchSend({ chatId: "callback-stop", value, prompt: "go", history: [] });
    await vi.waitFor(() => expect(currentUiRun("callback-stop")).not.toBeNull());
    const guard = uiActionGuard({ runId: currentUiRun("callback-stop") });
    expect(guard).not.toThrow();
    const cancel = dispatchCancel("callback-stop", value);
    expect(guard).toThrow(/late UI action/);
    stopped();
    finish();
    await Promise.all([send, cancel]);
    expect(currentUiRun("callback-stop")).toBeNull();
  });

  it("ends UI callback admission on a native startup failure", async () => {
    vi.mocked(ipc.cliSend).mockRejectedValueOnce(new Error("native startup failed"));
    await expect(dispatchSend({ chatId: "callback-failure", value: providerModelValue(CODEX_CLI_PROVIDER.id, model), prompt: "go", history: [] })).rejects.toThrow(/startup failed/);
    expect(currentUiRun("callback-failure")).toBeNull();
  });
  it("sends a shared model ID to the explicitly selected billing provider", async () => {
    await dispatchSend({ chatId: "qualified-api", value: providerModelValue(api.id, model), prompt: "context + question", history: [{ role: "user", content: "question" }] });
    expect(ipc.runtimeSend).toHaveBeenCalledWith("qualified-api", "api", model, "", [{ role: "user", content: "context + question" }], ["mcp__orion"]);
    expect(ipc.cliSend).not.toHaveBeenCalled();
  });
  it("stops the running connector even if the preference or agent was deleted", async () => {
    await dispatchSend({ chatId: "cancel-owner", value: providerModelValue(api.id, model), prompt: "go", history: [] });
    await dispatchCancel("cancel-owner", "agent:deleted");
    expect(ipc.runtimeCancel).toHaveBeenCalledWith("cancel-owner");
    expect(ipc.claudeCancel).not.toHaveBeenCalled();
  });
  it("restores prior text when cancellation happened before any session ID arrived", async () => {
    await dispatchSend({ chatId: "no-session-yet", value: providerModelValue(CODEX_CLI_PROVIDER.id, model), prompt: "What was the marker?", history: [{ role: "user", content: "Remember NECTAR42" }, { role: "user", content: "What was the marker?" }] });
    const call = vi.mocked(ipc.cliSend).mock.calls[0]!;
    expect(call[4]).toBeNull();
    expect(call[2]).toContain("Remember NECTAR42");
  });
  it("starts fresh after cancelling an initialized session and restores the visible conversation", async () => {
    const value = providerModelValue(CODEX_CLI_PROVIDER.id, model);
    await dispatchSend({ chatId: "cancel-recovery", value, prompt: "Remember NECTAR42", history: [] });
    recordDispatchedSession("cancel-recovery", "cancelled-before-prompt-save");
    const identity = JSON.stringify([CODEX_CLI_PROVIDER.id, CODEX_CLI_PROVIDER.kind, CODEX_CLI_PROVIDER.baseUrl, CODEX_CLI_PROVIDER.keyRef]);
    await vi.waitFor(async () => expect(await hasSessionOwner("cancelled-before-prompt-save", identity)).toBe(true));
    await dispatchCancel("cancel-recovery", value);
    await dispatchSend({ chatId: "cancel-recovery", value, sessionId: "cancelled-before-prompt-save", prompt: "What was the marker?", history: [{ role: "user", content: "Remember NECTAR42" }, { role: "user", content: "What was the marker?" }] });
    const call = vi.mocked(ipc.cliSend).mock.calls.at(-1)!;
    expect(call[4]).toBeNull();
    expect(call[2]).toContain("Remember NECTAR42");
  });
  it("attaches real images to Codex rather than silently dropping them", async () => {
    await dispatchSend({ chatId: "codex-vision", value: providerModelValue(CODEX_CLI_PROVIDER.id, model), prompt: "look", history: [], imagePath: "/snapshot.png" });
    expect(ipc.cliSend).toHaveBeenCalledWith("codex_cli", "codex-vision", "look", null, null, model, "", "/snapshot.png", null);
  });
  it("does not claim vision for an unsupported connector", async () => {
    await expect(dispatchSend({ chatId: "no-vision", value: providerModelValue(api.id, model), prompt: "look", history: [], imagePath: "/snapshot.png" })).rejects.toThrow("image attachments");
    expect(ipc.runtimeSend).not.toHaveBeenCalled();
  });
  it("never resumes a different provider's session after switching connectors", async () => {
    await dispatchSend({ chatId: "switch-owner", value: "claude-opus-4-8", prompt: "hello", history: [] });
    await dispatchSend({ chatId: "switch-owner", value: providerModelValue(CODEX_CLI_PROVIDER.id, model), prompt: "continue", sessionId: "claude-session", history: [{ role: "assistant", content: "prior context" }, { role: "user", content: "continue" }] });
    expect(vi.mocked(ipc.cliSend).mock.calls[0]![4]).toBeNull();
    expect(vi.mocked(ipc.cliSend).mock.calls[0]![2]).toContain("prior context");
  });
});

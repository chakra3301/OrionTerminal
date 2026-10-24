import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: m.invoke }));
vi.mock("@/features/agents/uiActionRuns", () => ({ currentUiRun: () => "run" }));
import { ipc } from "./ipc";
beforeEach(() => { vi.resetAllMocks(); m.invoke.mockResolvedValue(undefined); });
it("uses a distinct reviewed command while preserving ordinary dispatch", async () => {
  await ipc.runtimeSend("chat", "provider", "model", "system", [], []);
  expect(m.invoke).toHaveBeenLastCalledWith("runtime_send", { chatId: "chat", uiRunId: "run", providerId: "provider", model: "model", system: "system", history: [], allowedTools: [] });
  await ipc.runtimeSend("chat", "provider", "model", "system", [], [], "reviewed-identity");
  expect(m.invoke).toHaveBeenLastCalledWith("runtime_send_reviewed", expect.objectContaining({ reviewedProviderIdentity: "reviewed-identity", allowedTools: [] }));
});
it("never falls back on old binaries or a failed native binding", async () => {
  m.invoke.mockRejectedValue(new Error("unknown command"));
  await expect(ipc.runtimeSend("chat", "provider", "model", "system", [], [], "identity")).rejects.toThrow("unknown command");
  expect(m.invoke).toHaveBeenCalledOnce(); expect(m.invoke.mock.calls[0]![0]).toBe("runtime_send_reviewed");
});

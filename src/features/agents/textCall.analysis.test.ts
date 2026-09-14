import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ listeners: new Map<string, (e: any) => void>(), listen: vi.fn(), un: vi.fn(), send: vi.fn(), forget: vi.fn(), cancel: vi.fn(), surface: vi.fn(), route: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: m.listen }));
vi.mock("@/lib/ipc", () => ({ ipc: { analysisWorkDir: async () => "/private/analysis-fixture", cliCancel: m.cancel, claudeCancel: m.cancel, runtimeCancel: m.cancel, cursorCancel: m.cancel } }));
vi.mock("./dispatchSend", () => ({ dispatchResolved: m.send, forgetDispatch: m.forget, routeFor: m.route }));
vi.mock("./resolveSend", () => ({ resolveSendFromStores: (model: string) => ({ model, systemAppend: "Selected agent instructions" }) }));
vi.mock("@/store/providersStore", () => ({ useProvidersStore: { getState: () => ({ providers: [] }) } }));
vi.mock("@/store/modelPrefsStore", () => ({ useModelPrefs: { getState: () => ({ modelFor: m.surface }) } }));
import { runSurfaceAnalysis } from "./textCall";
beforeEach(() => {
  vi.clearAllMocks(); m.listeners.clear();
  m.listen.mockImplementation(async (channel, callback) => { m.listeners.set(channel, callback); return m.un; });
  m.send.mockImplementation(() => new Promise(() => {}));
  m.surface.mockReturnValue("provider:chosen/model");
  m.route.mockReturnValue({ engine: "codex_cli" });
});
afterEach(() => vi.useRealTimers());
function emit(channel: string, payload: unknown) { m.listeners.get(channel)!({ payload }); }
describe("shared tool-less analysis lifecycle", () => {
  it("uses the surface selection, explicit zero tools and a real image attachment", async () => {
    const result = runSurfaceAnalysis("Tag this", "archives", { imagePath: "/image.jpg" });
    await vi.waitFor(() => expect(m.send).toHaveBeenCalledOnce());
    const [id, spec, prompt, , options] = m.send.mock.calls[0]!;
    expect(m.surface).toHaveBeenCalledWith("archives");
    expect(spec).toMatchObject({ model: "provider:chosen/model", allowedTools: [], actionModel: null });
    expect(prompt).toContain("Selected agent instructions");
    expect(options).toEqual({ projectRoot: "/private/analysis-fixture", imagePath: "/image.jpg" });
    emit("claude:event", { chatId: id, event: { type: "assistant", message: { content: [{ type: "text", text: "cyan,orb" }] } } });
    emit("claude:exit", { chatId: id, code: 0, error: null });
    expect(await result).toBe("cyan,orb");
    expect(m.un).toHaveBeenCalledTimes(2);
  });
  it("also sends Claude analysis through the restricted cancellable dispatcher", async () => {
    m.route.mockReturnValue("claude");
    const controller = new AbortController();
    const result = runSurfaceAnalysis("Summarize", "orion", { signal: controller.signal });
    const rejection = expect(result).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(m.send).toHaveBeenCalledOnce());
    controller.abort(); await rejection;
    expect(m.cancel).toHaveBeenCalledWith(m.send.mock.calls[0]![0]);
    expect(m.un).toHaveBeenCalledTimes(2);
  });
  it("does not launch after an abort during listener setup and cleans late listeners", async () => {
    let release!: (un: () => void) => void;
    m.listen.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const controller = new AbortController();
    const result = runSurfaceAnalysis("Wait", "archives", { signal: controller.signal });
    const rejection = expect(result).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(release).toBeDefined());
    controller.abort(); await rejection; release(m.un);
    await vi.waitFor(() => expect(m.un).toHaveBeenCalled());
    expect(m.send).not.toHaveBeenCalled();
  });
  it("bounds a hung call and cancels its actual connector", async () => {
    vi.useFakeTimers();
    const result = runSurfaceAnalysis("Wait", "archives");
    const rejection = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(180_001); await rejection;
    expect(m.cancel).toHaveBeenCalledOnce();
    expect(m.un).toHaveBeenCalledTimes(2);
  });
  it("rejects nonzero exits instead of accepting partial output", async () => {
    const result = runSurfaceAnalysis("Test", "archives");
    const rejection = expect(result).rejects.toThrow("code 1");
    await vi.waitFor(() => expect(m.send).toHaveBeenCalled());
    emit("claude:exit", { chatId: m.send.mock.calls[0]![0], code: 1, error: null });
    await rejection;
  });
  it("fails unavailable selection before any upload", async () => {
    m.route.mockImplementation(() => { throw new Error("Provider unavailable"); });
    await expect(runSurfaceAnalysis("private", "archives")).rejects.toThrow("unavailable");
    expect(m.send).not.toHaveBeenCalled(); expect(m.listen).not.toHaveBeenCalled();
  });
});

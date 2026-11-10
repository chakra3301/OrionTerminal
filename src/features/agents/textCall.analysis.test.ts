import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ listeners: new Map<string, (e: any) => void>(), listen: vi.fn(), un: vi.fn(), send: vi.fn(), forget: vi.fn(), cancel: vi.fn(), surface: vi.fn(), route: vi.fn(), resolve: vi.fn(), providers: [] as unknown[] }));
vi.mock("@tauri-apps/api/event", () => ({ listen: m.listen }));
vi.mock("@/lib/ipc", () => ({ ipc: { analysisWorkDir: async () => "/private/analysis-fixture", cliCancel: m.cancel, claudeCancel: m.cancel, runtimeCancel: m.cancel, cursorCancel: m.cancel } }));
vi.mock("./dispatchSend", () => ({ dispatchResolved: m.send, forgetDispatch: m.forget, routeFor: m.route, providerSessionIdentity: (p: { id: string; kind: string; baseUrl: string; keyRef: string }) => JSON.stringify([p.id, p.kind, p.baseUrl, p.keyRef]) }));
vi.mock("./resolveSend", () => ({ resolveSendFromStores: m.resolve }));
vi.mock("@/store/providersStore", () => ({ useProvidersStore: { getState: () => ({ providers: m.providers }) } }));
vi.mock("@/store/modelPrefsStore", () => ({ useModelPrefs: { getState: () => ({ modelFor: m.surface }) } }));
import { runSurfaceAnalysis, runExplicitModelAnalysis } from "./textCall";
beforeEach(() => {
  vi.clearAllMocks(); m.listeners.clear();
  m.providers = [{ id: "chosen", kind: "codex_cli", baseUrl: "", keyRef: "", enabled: true, models: [{ id: "model", label: "Model" }] }];
  m.resolve.mockImplementation((model) => ({ model, systemAppend: "Selected agent instructions" }));
  m.listen.mockImplementation(async (channel, callback) => { m.listeners.set(channel, callback); return m.un; });
  m.send.mockImplementation(() => new Promise(() => {}));
  m.surface.mockReturnValue("provider:chosen/model");
  m.route.mockReturnValue({ engine: "codex_cli" });
});
afterEach(() => vi.useRealTimers());
function emit(channel: string, payload: unknown) { m.listeners.get(channel)!({ payload }); }
const identity = JSON.stringify(["chosen", "codex_cli", "", ""]);
describe("explicit reviewed model analysis", () => {
  it("never composes saved agents or surface defaults", async () => {
    const result = runExplicitModelAnalysis("Reviewed payload", "provider:chosen/model", identity);
    await vi.waitFor(() => expect(m.send).toHaveBeenCalledOnce());
    const [id, spec, prompt] = m.send.mock.calls[0]!;
    expect(m.resolve).not.toHaveBeenCalled(); expect(m.surface).not.toHaveBeenCalled();
    expect(spec.allowedTools).toEqual([]); expect(prompt).toBe("Reviewed payload");
    expect(m.send.mock.calls[0]![4].reviewedProviderIdentity).toBe(identity);
    emit("claude:event", { chatId: id, event: { type: "assistant", message: { content: [{ type: "text", text: "assessment" }] } } });
    emit("claude:exit", { chatId: id, code: 0, error: null }); expect(await result).toBe("assessment");
  });
  it("rejects agents and unqualified selections before listener/workspace setup", async () => {
    await expect(runExplicitModelAnalysis("private", "agent:configured", identity)).rejects.toThrow("explicit");
    await expect(runExplicitModelAnalysis("private", "model", identity)).rejects.toThrow("explicit");
    expect(m.listen).not.toHaveBeenCalled(); expect(m.resolve).not.toHaveBeenCalled();
  });
  it("rechecks the reviewed provider at the final dispatch boundary", async () => {
    let release!: (un: () => void) => void;
    m.listen.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    m.send.mockImplementation(async (_id, _r, _p, _h, opts) => opts.onReady());
    const result = runExplicitModelAnalysis("private", "provider:chosen/model", identity);
    const rejected = expect(result).rejects.toThrow("provider changed");
    await vi.waitFor(() => expect(release).toBeDefined()); m.providers = [];
    release(m.un); await rejected;
  });
  it("bounds explicit analysis responses by UTF-8 bytes", async () => {
    const result = runExplicitModelAnalysis("private", "provider:chosen/model", identity);
    const rejected = expect(result).rejects.toThrow("response limit");
    await vi.waitFor(() => expect(m.send).toHaveBeenCalledOnce());
    emit("claude:event", { chatId: m.send.mock.calls[0]![0], event: { type: "assistant", message: { content: [{ type: "text", text: "界".repeat(12_000) }] } } });
    await rejected; expect(m.cancel).toHaveBeenCalledOnce();
  });
});
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

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn(), broker: vi.fn(), failure: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: { pluginReadEntrypoint: m.read, pluginBrokerCall: m.broker } }));
import { SandboxPluginFrame, PLUGIN_RPC_CHANNEL, PLUGIN_RPC_VERSION } from "./SandboxPluginFrame";
import { useCommunityPlugins } from "@/store/communityPluginStore";
import { beginCommunityPluginChange, resetCommunityActivity } from "./communityActivity";
import type { InstalledCommunityPlugin } from "./communityTypes";
const record: InstalledCommunityPlugin = { manifest: { id: "dev.test.app", name: "App", version: "1.0.0", apiVersion: "1", engines: { orion: "*" }, publisher: "test", entrypoints: { ui: "ui.html" }, permissions: [] }, enabled: true, fingerprint: "a".repeat(64), installedAt: 1, grantedPermissions: [], quarantined: false, quarantineReason: null, workspaceHandles: [] };
let root: Root, host: HTMLDivElement;
const tick = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); resetCommunityActivity(); let seed = 0;
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => { (array as Uint8Array).fill(++seed); return array; });
  vi.stubGlobal("URL", class extends URL { static override createObjectURL = vi.fn(() => "blob:fixture"); static override revokeObjectURL = vi.fn(); });
  m.read.mockResolvedValue({ kind: "ui", content: "<main>Fixture</main>" });
  useCommunityPlugins.setState({ installed: [record], reportRuntimeFailure: m.failure });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); resetCommunityActivity(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount() { await act(async () => { root.render(<SandboxPluginFrame pluginId={record.manifest.id} kind="ui" />); await tick(); }); }
function send(windowSource: Window, type = "request") {
  window.dispatchEvent(new MessageEvent("message", { source: windowSource, data: { channel: PLUGIN_RPC_CHANNEL, version: PLUGIN_RPC_VERSION, sessionId: "01".repeat(24), type, requestId: "request-1", method: "storage.get", params: { key: "key" }, message: "old failure" } }));
}
it("refuses requests and ignores runtime errors during publication without quarantining the new version", async () => {
  await mount(); const frame = host.querySelector("iframe")!.contentWindow!;
  const release = beginCommunityPluginChange(record.manifest.id);
  await act(async () => { send(frame); send(frame, "runtime-error"); await tick(); });
  expect(m.broker).not.toHaveBeenCalled(); expect(m.failure).not.toHaveBeenCalled(); release();
});
it("does not deliver an old broker result into a replacement frame", async () => {
  await mount(); let finish!: (value: unknown) => void;
  m.broker.mockImplementation(() => new Promise((r) => { finish = r; }));
  await act(async () => { send(host.querySelector("iframe")!.contentWindow!); await tick(); }); expect(m.broker).toHaveBeenCalledOnce();
  await act(async () => { useCommunityPlugins.setState({ installed: [{ ...record, installedAt: 2 }] }); await tick(); });
  const reply = vi.spyOn(host.querySelector("iframe")!.contentWindow!, "postMessage");
  await act(async () => { finish({ private: "old result" }); await tick(); }); expect(reply).not.toHaveBeenCalled();
});
it("holds a sandbox that never completes its source-bound handshake", async () => {
  vi.useFakeTimers();
  await act(async () => { root.render(<SandboxPluginFrame pluginId={record.manifest.id} kind="ui" />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
  expect(m.failure).toHaveBeenCalledWith(record.manifest.id, expect.stringContaining("startup timed out"));
});
it("accepts readiness without treating it as malformed RPC and ignores generic unbound bootstrap errors", async () => {
  vi.useFakeTimers();
  await act(async () => { root.render(<SandboxPluginFrame pluginId={record.manifest.id} kind="ui" />); });
  const frame = host.querySelector("iframe")!.contentWindow!;
  await act(async () => {
    for (let i = 0; i < 6; i++) send(frame, "ready");
    window.dispatchEvent(new MessageEvent("message", { source: frame, data: { channel: "orion:xdesign-preview", version: 1, type: "startup-error", error: "unbound old frame" } }));
    await vi.advanceTimersByTimeAsync(10_001);
  });
  expect(m.failure).not.toHaveBeenCalled(); expect(m.broker).not.toHaveBeenCalled();
});
it("ignores late entrypoint errors after a new version has loaded", async () => {
  let fail!: (e: Error) => void; m.read.mockImplementationOnce(() => new Promise((_, r) => { fail = r; }));
  await mount();
  await act(async () => { useCommunityPlugins.setState({ installed: [{ ...record, installedAt: 2 }] }); await tick(); });
  await act(async () => { fail(new Error("obsolete load failure")); await tick(); });
  expect(m.failure).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("obsolete"); expect(m.read).toHaveBeenCalledTimes(2);
});

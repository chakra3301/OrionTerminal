// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn(), broker: vi.fn(), failure: vi.fn(), get: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: { pluginReadEntrypoint: m.read, pluginBrokerCall: m.broker } }));
vi.mock("@/lib/db", () => ({ getAppState: m.get, setAppState: m.save }));
import { SandboxPluginFrame, PLUGIN_RPC_CHANNEL } from "./SandboxPluginFrame";
import { useCommunityPlugins } from "@/store/communityPluginStore";
import { usePluginAppearance } from "@/store/pluginAppearanceStore";
import { resetCommunityActivity, beginCommunityPluginChange } from "./communityActivity";
import type { InstalledCommunityPlugin } from "./communityTypes";
const record: InstalledCommunityPlugin = { manifest: { id: "dev.test.app", name: "App", version: "1.0.0", apiVersion: "1", engines: { orion: "*" }, publisher: "test", entrypoints: { ui: "ui.html" }, permissions: [] }, enabled: true, fingerprint: "a".repeat(64), installedAt: 1, grantedPermissions: [], quarantined: false, quarantineReason: null, workspaceHandles: [] };
let root: Root, host: HTMLDivElement;
const tick = () => new Promise(r => setTimeout(r, 35));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); resetCommunityActivity(); let seed = 0;
  vi.spyOn(crypto, "getRandomValues").mockImplementation(array => { (array as Uint8Array).fill(++seed); return array; });
  vi.stubGlobal("URL", class extends URL { static override createObjectURL = vi.fn(() => "blob:fixture"); static override revokeObjectURL = vi.fn(); });
  m.read.mockResolvedValue({ kind: "ui", content: '<body data-orion-appearance="v1" data-orion-skin="2048"><main>Illustrative</main></body>' });
  m.get.mockResolvedValue(null); m.save.mockResolvedValue(undefined);
  usePluginAppearance.setState({ loaded: false, busy: false, modes: {}, error: null });
  useCommunityPlugins.setState({ installed: [record], reportRuntimeFailure: m.failure });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.documentElement.removeAttribute("data-color-mode"); resetCommunityActivity(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => { root.render(<SandboxPluginFrame pluginId={record.manifest.id} kind="ui" />); await tick(); }); }
function ready(source: Window) { window.dispatchEvent(new MessageEvent("message", { source, data: { channel: PLUGIN_RPC_CHANNEL, version: 1, sessionId: "01".repeat(24), type: "ready" } })); }
it("sends initial/live palettes only after bound readiness, without regenerating iframe or native calls", async () => {
  await mount(); const iframe = host.querySelector("iframe")!, frame = iframe.contentWindow!, send = vi.spyOn(frame, "postMessage");
  await act(async () => { ready(window); await tick(); }); expect(send).not.toHaveBeenCalled();
  await act(async () => { ready(frame); await tick(); }); expect(send.mock.lastCall![0]).toMatchObject({ type: "appearance", appearance: { mode: "orion", colorScheme: "dark" } });
  await act(async () => { document.documentElement.dataset.colorMode = "light"; await tick(); });
  expect(send.mock.lastCall![0]).toMatchObject({ type: "appearance", appearance: { colorScheme: "light" } });
  expect(host.querySelector("iframe")).toBe(iframe); expect(iframe.src).toContain("blob:fixture"); expect(m.read).toHaveBeenCalledOnce(); expect(URL.createObjectURL).toHaveBeenCalledOnce(); expect(m.broker).not.toHaveBeenCalled();
});
it("Original choice is acknowledged before in-place mode update and persists separately from plugin data", async () => {
  await mount(); const frame = host.querySelector("iframe")!.contentWindow!, send = vi.spyOn(frame, "postMessage");
  await act(async () => { ready(frame); await tick(); });
  await act(async () => { (Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Original")!).click(); await tick(); });
  expect(m.save).toHaveBeenCalledWith("plugins.appearance", { version: 1, modes: { [record.manifest.id]: "original" } });
  expect(send.mock.lastCall![0]).toMatchObject({ appearance: { mode: "original" } }); expect(m.read).toHaveBeenCalledOnce(); expect(m.broker).not.toHaveBeenCalled();
});
it("ignores palette updates during publication or after disable", async () => {
  await mount(); const frame = host.querySelector("iframe")!.contentWindow!, send = vi.spyOn(frame, "postMessage");
  await act(async () => { ready(frame); await tick(); }); send.mockClear(); const release = beginCommunityPluginChange(record.manifest.id);
  await act(async () => { document.documentElement.dataset.colorMode = "light"; await tick(); }); expect(send).not.toHaveBeenCalled(); release();
  await act(async () => { useCommunityPlugins.setState({ installed: [{ ...record, enabled: false }] }); document.documentElement.dataset.colorMode = "dark"; await tick(); }); expect(send).not.toHaveBeenCalled();
});
it("replaces package frames by incarnation but rejects old-frame readiness/theme delivery", async () => {
  await mount(); const oldFrame = host.querySelector("iframe")!.contentWindow!, oldSend = vi.spyOn(oldFrame, "postMessage");
  await act(async () => { ready(oldFrame); await tick(); }); oldSend.mockClear();
  await act(async () => { useCommunityPlugins.setState({ installed: [{ ...record, fingerprint: "b".repeat(64) }] }); await tick(); });
  await act(async () => { ready(oldFrame); document.documentElement.dataset.colorMode = "light"; await tick(); });
  expect(oldSend).not.toHaveBeenCalled(); expect(host.querySelector("iframe")!.contentWindow).not.toBe(oldFrame); expect(m.read).toHaveBeenCalledTimes(2);
});
it("does not silently retrofit legacy packages or load preferences for them", async () => {
  m.read.mockResolvedValue({ kind: "ui", content: "<main>Original app</main>" }); await mount(); expect(host.textContent).not.toContain("Appearance"); expect(m.get).not.toHaveBeenCalled();
});

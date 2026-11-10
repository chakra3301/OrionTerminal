// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ pick: vi.fn(), inspect: vi.fn(), install: vi.fn(), confirm: vi.fn(), refresh: vi.fn(), previous: vi.fn(), rollback: vi.fn(), hydrate: vi.fn(), remove: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: m.pick }));
vi.mock("@/lib/ipc", () => ({ ipc: { pluginInspectDirectory: m.inspect, pluginPreviousVersion: m.previous } }));
vi.mock("@/components/ConfirmModal", () => ({ confirmAction: m.confirm }));
import { PluginManagerPanel } from "./PluginManagerPanel";
import { useCommunityPlugins } from "@/store/communityPluginStore";
import type { InstalledCommunityPlugin } from "@/plugins/communityTypes";
const record: InstalledCommunityPlugin = { manifest: { id: "dev.test.app", name: "App", version: "1.0.0", apiVersion: "1", engines: { orion: "*" }, publisher: "test", entrypoints: { ui: "ui.html" }, contributes: { apps: [{ id: "app", name: "App" }] }, permissions: [] }, enabled: false, grantedPermissions: [], fingerprint: "a".repeat(64), installedAt: 1, quarantined: false, quarantineReason: null, workspaceHandles: [] };
const inspection = { manifest: record.manifest, fingerprint: record.fingerprint, fileCount: 2, totalBytes: 100 };
let host: HTMLDivElement, root: Root;
const tick = () => new Promise((r) => setTimeout(r, 0));
const start = () => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Install package"))!.click();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); m.pick.mockResolvedValue("/fixture"); m.inspect.mockResolvedValue(inspection); m.confirm.mockResolvedValue(true); m.install.mockResolvedValue(true); m.refresh.mockResolvedValue(undefined);
  useCommunityPlugins.setState({ installed: [], busyIds: [], activationIssues: {}, error: null, safeMode: { active: false, pluginIds: [], reason: null }, install: m.install, refreshResources: m.refresh, rollback: m.rollback, hydrate: m.hydrate, remove: m.remove });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("binds removal consent to the pre-dialog version and suppresses duplicate starts", async () => {
  useCommunityPlugins.setState({ installed: [record] });
  let finish!: (value: boolean) => void; m.confirm.mockImplementation(() => new Promise((r) => { finish = r; }));
  await act(async () => root.render(<PluginManagerPanel />));
  await act(async () => { const button = host.querySelector<HTMLButtonElement>('[title="Remove App"]')!; button.click(); button.click(); await tick(); });
  expect(m.confirm).toHaveBeenCalledOnce(); expect(m.confirm.mock.calls[0]![0].body).toContain(record.fingerprint);
  await act(async () => { useCommunityPlugins.setState({ installed: [{ ...record, installedAt: 99 }] }); finish(true); await tick(); });
  expect(m.remove).toHaveBeenCalledWith(record.manifest.id, record);
});
it("does not remove after cancellation or unmount during approval", async () => {
  useCommunityPlugins.setState({ installed: [record] }); m.confirm.mockResolvedValueOnce(false);
  await act(async () => root.render(<PluginManagerPanel />));
  await act(async () => { host.querySelector<HTMLButtonElement>('[title="Remove App"]')!.click(); await tick(); });
  expect(m.remove).not.toHaveBeenCalled();
  let finish!: (value: boolean) => void; m.confirm.mockImplementation(() => new Promise((r) => { finish = r; }));
  await act(async () => { host.querySelector<HTMLButtonElement>('[title="Remove App"]')!.click(); await tick(); });
  await act(async () => root.render(null));
  await act(async () => { finish(true); await tick(); }); expect(m.remove).not.toHaveBeenCalled();
});
it("reviews retained permissions and data limitations before explicit rollback", async () => {
  useCommunityPlugins.setState({ installed: [record] }); m.previous.mockResolvedValue({ ...record, fingerprint: "b".repeat(64) });
  await act(async () => root.render(<PluginManagerPanel />));
  await act(async () => { host.querySelector<HTMLButtonElement>('[title="Review rollback for App"]')!.click(); await tick(); });
  expect(m.confirm.mock.calls[0]![0].body).toContain("private plugin data is NOT rolled back");
  expect(m.confirm.mock.calls[0]![0].body).toContain("workspace access is removed");
  expect(m.rollback).toHaveBeenCalledWith(record.manifest.id, record, { ...record, fingerprint: "b".repeat(64) });
  m.rollback.mockClear(); m.confirm.mockResolvedValue(false);
  await act(async () => { host.querySelector<HTMLButtonElement>('[title="Review rollback for App"]')!.click(); await tick(); });
  expect(m.rollback).not.toHaveBeenCalled();
});
it("ignores retained-version results after unmount and exposes explicit recovery reload", async () => {
  useCommunityPlugins.setState({ installed: [record] });
  let finish!: (v: InstalledCommunityPlugin) => void; m.previous.mockImplementation(() => new Promise((r) => { finish = r; }));
  await act(async () => root.render(<PluginManagerPanel />));
  await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Reload packages"))!.click(); await tick(); });
  expect(m.hydrate).toHaveBeenCalledOnce();
  await act(async () => { host.querySelector<HTMLButtonElement>('[title="Review rollback for App"]')!.click(); await tick(); });
  await act(async () => root.render(null));
  await act(async () => { finish(record); await tick(); });
  expect(m.confirm).not.toHaveBeenCalled(); expect(m.rollback).not.toHaveBeenCalled();
});
it("takes the live installed snapshot after inspection, not stale render data", async () => {
  let finish!: (v: typeof inspection) => void; m.inspect.mockImplementation(() => new Promise((r) => { finish = r; }));
  await act(async () => root.render(<PluginManagerPanel />));
  await act(async () => { start(); await tick(); });
  await act(async () => { useCommunityPlugins.setState({ installed: [record] }); finish(inspection); await tick(); });
  expect(m.confirm.mock.calls[0]![0].title).toBe("Update App?");
  expect(m.install).toHaveBeenCalledWith("/fixture", inspection, "manager-reviewed", false, record);
});
it("does not install after closing during approval", async () => {
  let finish!: (v: boolean) => void; m.confirm.mockImplementation(() => new Promise((r) => { finish = r; }));
  await act(async () => root.render(<PluginManagerPanel />));
  await act(async () => { start(); await tick(); });
  await act(async () => root.render(null));
  await act(async () => { finish(true); await tick(); }); expect(m.install).not.toHaveBeenCalled();
});
it("does not inspect a picker result after unmount and catches picker errors", async () => {
  m.pick.mockRejectedValueOnce(new Error("picker unavailable"));
  await act(async () => root.render(<PluginManagerPanel />));
  await act(async () => { start(); await tick(); }); expect(host.textContent).toContain("picker unavailable");
  let finish!: (v: string) => void; m.pick.mockImplementation(() => new Promise((r) => { finish = r; }));
  await act(async () => { start(); await tick(); }); await act(async () => root.render(null));
  await act(async () => { finish("/late"); await tick(); }); expect(m.inspect).not.toHaveBeenCalled(); expect(m.install).not.toHaveBeenCalled();
});

import { beforeEach, expect, it, vi } from "vitest";
import type { CommunityPluginInspection, InstalledCommunityPlugin } from "@/plugins/communityTypes";
import { resetCommunityActivity, beginCommunityPluginCall } from "@/plugins/communityActivity";
import { parseDisabledInstallReceipt } from "@/plugins/pluginInstallReview";
const m = vi.hoisted(() => ({ install: vi.fn(), legacy: vi.fn(), recovered: vi.fn(), boot: vi.fn(), startup: vi.fn(), ready: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: { pluginInstallIntakeDirectory: m.install, pluginInstallDirectory: m.legacy, pluginRecoverInstalled: m.recovered, pluginBootStatus: m.boot, pluginRuntimeBegin: m.startup, pluginRuntimeReady: m.ready } }));
import { useCommunityPlugins } from "./communityPluginStore";
const inspection = (): CommunityPluginInspection => ({ manifest: { id: "dev.test.intake", name: "Intake", version: "1.0.0", apiVersion: "1", engines: { orion: "*" }, publisher: "test", entrypoints: { ui: "ui.html" }, contributes: { apps: [{ id: "app", name: "App" }] }, permissions: ["storage.plugin"] }, fingerprint: "a".repeat(64), fileCount: 2, totalBytes: 100 });
const receipt = (): InstalledCommunityPlugin => ({ manifest: inspection().manifest, fingerprint: inspection().fingerprint, enabled: false, installedAt: 1, grantedPermissions: ["storage.plugin"], workspaceHandles: [], quarantined: false, quarantineReason: null });
beforeEach(() => { vi.resetAllMocks(); resetCommunityActivity(); useCommunityPlugins.setState({ hydrated: true, recoveryBlocked: false, installed: [], busyIds: [], activationIssues: {}, safeMode: { active: false, pluginIds: [], reason: null }, error: null }); m.install.mockResolvedValue(receipt()); m.recovered.mockResolvedValue([receipt()]); m.boot.mockResolvedValue({ active: false, pluginIds: [], reason: null }); });
it("requires hydrated Manager state and checks the local UI lease before and after subscribers", async () => {
  useCommunityPlugins.setState({ hydrated: false }); expect(await useCommunityPlugins.getState().install("/owned-fixture", inspection(), "intake-disabled", true)).toBe(false);
  useCommunityPlugins.setState({ hydrated: true }); expect(await useCommunityPlugins.getState().install("/owned-fixture", inspection(), "intake-disabled", true, undefined, () => false)).toBe(false);
  let live = true; const off = useCommunityPlugins.subscribe((s) => { if (s.busyIds.length) live = false; });
  try { expect(await useCommunityPlugins.getState().install("/owned-fixture", inspection(), "intake-disabled", true, undefined, () => live)).toBe(false); } finally { off(); }
  expect(m.install).not.toHaveBeenCalled(); expect(useCommunityPlugins.getState().busyIds).toEqual([]); expect(useCommunityPlugins.getState().recoveryBlocked).toBe(false);
  beginCommunityPluginCall(inspection().manifest.id)();
});
it("retains a verified committed receipt after dismissal, detaches caller data and never starts code", async () => {
  let finish!: (r: InstalledCommunityPlugin) => void; let live = true; m.install.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
  const selected = inspection(), pending = useCommunityPlugins.getState().install("/owned-fixture", selected, "intake-disabled", true, undefined, () => live);
  selected.manifest.version = "9.0.0"; live = false; finish(receipt()); expect(await pending).toBe(true);
  expect(useCommunityPlugins.getState().installed).toEqual([receipt()]); expect(m.legacy).not.toHaveBeenCalled(); expect(m.startup).not.toHaveBeenCalled();
});
it("an uncertain native result blocks retries until explicit Manager recovery, with no fallback", async () => {
  m.install.mockRejectedValueOnce(new Error("connection lost after publication")); expect(await useCommunityPlugins.getState().install("/owned-fixture", inspection(), "intake-disabled", true)).toBe(false);
  expect(useCommunityPlugins.getState().recoveryBlocked).toBe(true); expect(useCommunityPlugins.getState().hydrated).toBe(false);
  expect(await useCommunityPlugins.getState().install("/owned-fixture", inspection(), "intake-disabled", true)).toBe(false); expect(m.install).toHaveBeenCalledOnce(); expect(m.legacy).not.toHaveBeenCalled();
  await useCommunityPlugins.getState().hydrate(); expect(useCommunityPlugins.getState().installed).toEqual([receipt()]); expect(useCommunityPlugins.getState().recoveryBlocked).toBe(false); expect(m.install).toHaveBeenCalledOnce();
});
it("enabled, foreign, overgranted, quarantined, workspace and malformed receipts cannot enter the registry", async () => {
  for (const patch of [{ enabled: true }, { fingerprint: "b".repeat(64) }, { grantedPermissions: ["storage.plugin", "notifications"] }, { grantedPermissions: [["storage.plugin"]] }, { manifest: { ...inspection().manifest, version: "9.0.0" } }, { quarantined: true }, { quarantineReason: "wrong" }, { workspaceHandles: [{ id: "unexpected" }] }, { installedAt: 0 }, { extraAuthority: true }]) {
    useCommunityPlugins.setState({ hydrated: true, recoveryBlocked: false, installed: [] }); m.install.mockResolvedValueOnce({ ...receipt(), ...patch });
    expect(await useCommunityPlugins.getState().install("/owned-fixture", inspection(), "intake-disabled", true)).toBe(false); expect(useCommunityPlugins.getState().installed).toEqual([]); expect(useCommunityPlugins.getState().recoveryBlocked).toBe(true); expect(useCommunityPlugins.getState().busyIds).toEqual([]);
  }
});
it("compares manifest data independently of JSON key order and grants as exact flat sets", () => {
  const review = inspection(); review.manifest.permissions = ["storage.plugin", "notifications"];
  const r = receipt(); r.manifest = Object.fromEntries(Object.entries(review.manifest).reverse()) as typeof r.manifest; r.grantedPermissions = ["notifications", "storage.plugin"];
  expect(parseDisabledInstallReceipt(r, review).manifest).toEqual(review.manifest);
  r.grantedPermissions = ["notifications", "notifications"]; expect(() => parseDisabledInstallReceipt(r, review)).toThrow("receipt");
});

import { beforeEach, expect, it, vi } from "vitest";
import type { InstalledCommunityPlugin, PreparedInstallSelection } from "@/plugins/communityTypes";
import { resetCommunityActivity } from "@/plugins/communityActivity";
import candidate from "@/features/staticApps/__fixtures__/prepared2048.json";
import { decodeText, fromBase64 } from "@/features/staticApps/hash";
const m = vi.hoisted(() => ({ install: vi.fn(), legacy: vi.fn(), directory: vi.fn(), reviewed: vi.fn(), enabled: vi.fn(), startup: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: { pluginInstallPrepared: m.install, pluginInstallDirectory: m.legacy, pluginInstallIntakeDirectory: m.directory, pluginInstallReviewedDirectory: m.reviewed, pluginSetEnabled: m.enabled, pluginRuntimeBegin: m.startup } }));
import { useCommunityPlugins } from "./communityPluginStore";
const file = candidate.files.find((f) => f.path === "orion-plugin.json")!;
const selection = (): PreparedInstallSelection => ({ id: candidate.candidateId, outputHash: candidate.outputHash, captureHash: "b".repeat(64), inspection: { manifest: JSON.parse(decodeText(fromBase64(file.dataBase64, file.bytes))), fingerprint: "a".repeat(64), fileCount: 35, totalBytes: candidate.totalBytes } });
const receipt = (): InstalledCommunityPlugin => ({ manifest: selection().inspection.manifest, enabled: false, grantedPermissions: ["storage.plugin"], fingerprint: "a".repeat(64), installedAt: 1, quarantined: false, quarantineReason: null, workspaceHandles: [] });
beforeEach(() => { vi.resetAllMocks(); resetCommunityActivity(); useCommunityPlugins.setState({ hydrated: true, recoveryBlocked: false, busyIds: [], installed: [], activationIssues: {}, error: null }); m.install.mockResolvedValue(receipt()); });
it("records only verified disabled native receipt, with no legacy/directory path or startup/enable", async () => {
  expect(await useCommunityPlugins.getState().installPrepared(selection(), true, () => true)).toBe(true);
  expect(m.install).toHaveBeenCalledWith(selection(), true); expect(useCommunityPlugins.getState().installed).toEqual([receipt()]); expect(m.legacy).not.toHaveBeenCalled(); expect(m.directory).not.toHaveBeenCalled(); expect(m.reviewed).not.toHaveBeenCalled(); expect(m.enabled).not.toHaveBeenCalled(); expect(m.startup).not.toHaveBeenCalled();
});
it("refuses unreviewed, stale, unhydrated/recovery/busy, existing and invalid selections before IPC", async () => {
  expect(await useCommunityPlugins.getState().installPrepared(selection(), false, () => true)).toBe(false);
  expect(await useCommunityPlugins.getState().installPrepared(selection(), true, () => false)).toBe(false);
  for (const state of [{ hydrated: false }, { recoveryBlocked: true }, { busyIds: ["other"] }, { installed: [receipt()] }]) { useCommunityPlugins.setState({ hydrated: true, recoveryBlocked: false, busyIds: [], installed: [], ...state }); expect(await useCommunityPlugins.getState().installPrepared(selection(), true, () => true)).toBe(false); }
  useCommunityPlugins.setState({ installed: [] }); const s = selection(); s.outputHash = "bad"; expect(await useCommunityPlugins.getState().installPrepared(s, true, () => true)).toBe(false); expect(m.install).not.toHaveBeenCalled();
});
it("synchronous manager subscribers invalidating a UI lease prevent native publication", async () => {
  let valid = true; const off = useCommunityPlugins.subscribe((s) => { if (s.busyIds.length) valid = false; });
  expect(await useCommunityPlugins.getState().installPrepared(selection(), true, () => valid)).toBe(false); off(); expect(m.install).not.toHaveBeenCalled(); expect(useCommunityPlugins.getState().busyIds).toEqual([]);
});
it("detaches selection before awaiting; later UI dismissal cannot retract a native receipt or enable it", async () => {
  let finish!: (r: InstalledCommunityPlugin) => void; m.install.mockImplementationOnce(() => new Promise((r) => { finish = r; })); let live = true; const s = selection(), pending = useCommunityPlugins.getState().installPrepared(s, true, () => live);
  expect(useCommunityPlugins.getState().busyIds).toEqual([s.inspection.manifest.id]); s.inspection.fingerprint = "f".repeat(64); s.inspection.manifest.permissions.push("workspace.read"); live = false;
  finish(receipt()); expect(await pending).toBe(true); expect(m.install.mock.calls[0]![0]).toEqual(selection()); expect(useCommunityPlugins.getState().installed).toEqual([receipt()]); expect(m.startup).not.toHaveBeenCalled(); expect(m.enabled).not.toHaveBeenCalled();
});
it("uncertain native failure blocks retries pending explicit Manager reload, never falls back", async () => {
  m.install.mockRejectedValueOnce(new Error("Unknown command intake_prepared_install")); expect(await useCommunityPlugins.getState().installPrepared(selection(), true, () => true)).toBe(false);
  expect(useCommunityPlugins.getState().recoveryBlocked).toBe(true); expect(useCommunityPlugins.getState().hydrated).toBe(false); expect(useCommunityPlugins.getState().installed).toEqual([]);
  expect(await useCommunityPlugins.getState().installPrepared(selection(), true, () => true)).toBe(false); expect(m.install).toHaveBeenCalledOnce(); expect(m.legacy).not.toHaveBeenCalled(); expect(m.directory).not.toHaveBeenCalled(); expect(m.reviewed).not.toHaveBeenCalled();
});
it("unexpected grant/version/fingerprint/enablement/quarantine/workspace/time receipts fail closed", async () => {
  for (const mutate of [
    (r: InstalledCommunityPlugin) => { r.enabled = true; }, (r: InstalledCommunityPlugin) => { r.fingerprint = "f".repeat(64); },
    (r: InstalledCommunityPlugin) => { r.grantedPermissions.push("workspace.read"); }, (r: InstalledCommunityPlugin) => { (r as unknown as { grantedPermissions: unknown }).grantedPermissions = [["storage.plugin"]]; }, (r: InstalledCommunityPlugin) => { r.manifest.version = "9.0.0"; },
    (r: InstalledCommunityPlugin) => { r.quarantined = true; }, (r: InstalledCommunityPlugin) => { r.quarantineReason = "unexpected"; },
    (r: InstalledCommunityPlugin) => { r.workspaceHandles.push({ id: "x", label: "x", read: true, write: true }); }, (r: InstalledCommunityPlugin) => { r.installedAt = -1; },
  ]) { useCommunityPlugins.setState({ hydrated: true, recoveryBlocked: false, installed: [] }); const r = receipt(); mutate(r); m.install.mockResolvedValueOnce(r); expect(await useCommunityPlugins.getState().installPrepared(selection(), true, () => true)).toBe(false); expect(useCommunityPlugins.getState().installed).toEqual([]); expect(useCommunityPlugins.getState().recoveryBlocked).toBe(true); expect(useCommunityPlugins.getState().busyIds).toEqual([]); }
});

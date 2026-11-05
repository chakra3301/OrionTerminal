import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRegistry } from "@/plugins/appRegistry";
import { beginCommunityPluginCall, resetCommunityActivity } from "@/plugins/communityActivity";
import { communityAppId, resetCommunityRuntime } from "@/plugins/communityRuntime";
import type { InstalledCommunityPlugin } from "@/plugins/communityTypes";
import { usePluginManager } from "@/store/pluginManagerStore";

const mocks = vi.hoisted(() => ({
  rollback: vi.fn(),
  installReviewed: vi.fn(),
  installLegacy: vi.fn(),
  installIntake: vi.fn(),
  boot: vi.fn(),
  list: vi.fn(),
  begin: vi.fn(),
  ready: vi.fn(),
  enabled: vi.fn(),
  quarantine: vi.fn(),
  remove: vi.fn(),
  removeReviewed: vi.fn(),
  revokeWorkspace: vi.fn(),
  clearSafe: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    pluginRollbackReviewed: mocks.rollback,
    pluginInstallReviewedDirectory: mocks.installReviewed,
    pluginInstallDirectory: mocks.installLegacy,
    pluginInstallIntakeDirectory: mocks.installIntake,
    pluginBootStatus: mocks.boot,
    pluginListInstalled: mocks.list,
    pluginRecoverInstalled: mocks.list,
    pluginRuntimeBegin: mocks.begin,
    pluginRuntimeReady: mocks.ready,
    pluginSetEnabled: mocks.enabled,
    pluginQuarantine: mocks.quarantine,
    pluginRemove: mocks.remove,
    pluginRemoveReviewed: mocks.removeReviewed,
    pluginWorkspaceRevoke: mocks.revokeWorkspace,
    pluginSafeModeClear: mocks.clearSafe,
  },
}));

import { useCommunityPlugins } from "@/store/communityPluginStore";

const record: InstalledCommunityPlugin = {
  manifest: {
    id: "dev.orion.hello",
    name: "Hello Orion",
    version: "1.0.0",
    apiVersion: "1",
    engines: { orion: "*" },
    publisher: "test",
    entrypoints: { ui: "ui.html" },
    contributes: { apps: [{ id: "hello", name: "Hello" }] },
    permissions: ["storage.plugin"],
  },
  enabled: true,
  grantedPermissions: ["storage.plugin"],
  fingerprint: "a".repeat(64),
  installedAt: 1,
  quarantined: false,
  quarantineReason: null,
  workspaceHandles: [{ id: "b".repeat(64), label: "Notes", read: true, write: false }],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetCommunityRuntime();
  resetCommunityActivity();
  usePluginManager.setState({ hydrated: true, disabledIds: [], busyIds: [], error: null });
  useCommunityPlugins.setState({
    hydrated: false,
    recoveryBlocked: false,
    installed: [],
    safeMode: { active: false, pluginIds: [], reason: null },
    activationIssues: {},
    busyIds: [],
    error: null,
  });
  mocks.boot.mockResolvedValue({ active: false, pluginIds: [], reason: null });
  mocks.list.mockResolvedValue([record]);
  mocks.begin.mockResolvedValue(undefined);
  mocks.ready.mockResolvedValue(undefined);
  mocks.enabled.mockResolvedValue(undefined);
  mocks.quarantine.mockResolvedValue(undefined);
  mocks.remove.mockResolvedValue(undefined);
  mocks.removeReviewed.mockResolvedValue(undefined);
  mocks.revokeWorkspace.mockResolvedValue([]);
  mocks.clearSafe.mockResolvedValue(undefined);
});

afterEach(() => {
  resetCommunityRuntime();
  resetCommunityActivity();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("community plugin store", () => {
  it("binds removal to the reviewed record and holds the call lease through acknowledgement", async () => {
    useCommunityPlugins.setState({ installed: [record] });
    let finish!: () => void; mocks.removeReviewed.mockImplementation(() => new Promise<void>((r) => { finish = r; }));
    const pending = useCommunityPlugins.getState().remove(record.manifest.id, record);
    expect(mocks.removeReviewed).toHaveBeenCalledWith(record.manifest.id, record);
    expect(() => beginCommunityPluginCall(record.manifest.id)).toThrow();
    expect(useCommunityPlugins.getState().installed).toEqual([record]);
    finish(); expect(await pending).toBe(true);
    expect(useCommunityPlugins.getState().installed).toEqual([]); expect(mocks.remove).not.toHaveBeenCalled();
    beginCommunityPluginCall(record.manifest.id)();
  });
  it("rejects stale removal approvals and active calls before native mutation", async () => {
    useCommunityPlugins.setState({ installed: [record] });
    expect(await useCommunityPlugins.getState().remove(record.manifest.id, { ...record, installedAt: 99 })).toBe(false);
    const release = beginCommunityPluginCall(record.manifest.id);
    expect(await useCommunityPlugins.getState().remove(record.manifest.id, record)).toBe(false); release();
    expect(mocks.removeReviewed).not.toHaveBeenCalled();
  });
  it("does not reactivate an uncertain removal or fall back on an old binary", async () => {
    await useCommunityPlugins.getState().hydrate();
    const current = useCommunityPlugins.getState().installed[0]!;
    mocks.removeReviewed.mockRejectedValueOnce(new Error("command not found"));
    expect(await useCommunityPlugins.getState().remove(current.manifest.id, current)).toBe(false);
    expect(useCommunityPlugins.getState().installed).toEqual([current]);
    expect(useCommunityPlugins.getState().recoveryBlocked).toBe(true);
    expect(appRegistry.get(communityAppId(record.manifest.id, "hello"))).toBeUndefined();
    expect(mocks.remove).not.toHaveBeenCalled();
    beginCommunityPluginCall(record.manifest.id)();
  });

  it("blocks mutations after failed recovery until an explicit successful reload", async () => {
    useCommunityPlugins.setState({ installed: [record] });
    mocks.list.mockRejectedValueOnce(new Error("Unknown recovery journal version"));
    await useCommunityPlugins.getState().hydrate();
    expect(useCommunityPlugins.getState().installed).toEqual([record]);
    expect(useCommunityPlugins.getState().recoveryBlocked).toBe(true);
    expect(useCommunityPlugins.getState().safeMode.active).toBe(true);
    useCommunityPlugins.getState().clearError();
    expect(await useCommunityPlugins.getState().setEnabled(record.manifest.id, true)).toBe(false);
    expect(await useCommunityPlugins.getState().remove(record.manifest.id, record)).toBe(false);
    expect(await useCommunityPlugins.getState().clearSafeMode()).toBe(false);
    expect(mocks.enabled).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.clearSafe).not.toHaveBeenCalled();
    mocks.list.mockResolvedValueOnce([{ ...record, enabled: false, quarantined: true, workspaceHandles: [] }]);
    await useCommunityPlugins.getState().hydrate();
    expect(useCommunityPlugins.getState().recoveryBlocked).toBe(false); expect(mocks.begin).toHaveBeenCalledWith([]);
  });

  it("binds rollback to both reviewed records, holds a mutation lease and publishes disabled only after acknowledgement", async () => {
    useCommunityPlugins.setState({ installed: [record] });
    const previous = { ...record, fingerprint: "c".repeat(64), installedAt: 0 };
    let finish!: (v: InstalledCommunityPlugin) => void;
    mocks.rollback.mockImplementation(() => new Promise((r) => { finish = r; }));
    const pending = useCommunityPlugins.getState().rollback(record.manifest.id, record, previous);
    expect(mocks.rollback).toHaveBeenCalledWith(record.manifest.id, record, previous);
    expect(() => beginCommunityPluginCall(record.manifest.id)).toThrow();
    expect(useCommunityPlugins.getState().installed).toEqual([record]);
    const restored = { ...previous, enabled: false, workspaceHandles: [], installedAt: 3 };
    finish(restored); expect(await pending).toBe(true);
    expect(useCommunityPlugins.getState().installed).toEqual([restored]); expect(mocks.begin).not.toHaveBeenCalled();
    beginCommunityPluginCall(record.manifest.id)();
    expect(await useCommunityPlugins.getState().rollback(record.manifest.id, record, previous)).toBe(false);
    expect(mocks.rollback).toHaveBeenCalledTimes(1);
  });

  it("retires dependants after rollback without starting replacement runtimes", async () => {
    const dependent = { ...record, manifest: { ...record.manifest, id: "dev.orion.dependent", dependencies: { [record.manifest.id]: "*" }, contributes: { apps: [{ id: "dependent", name: "Dependent" }] } } };
    mocks.list.mockResolvedValueOnce([record, dependent]);
    await useCommunityPlugins.getState().hydrate();
    const current = useCommunityPlugins.getState().installed.find((p) => p.manifest.id === record.manifest.id)!;
    expect(appRegistry.get(communityAppId(dependent.manifest.id, "dependent"))).toBeDefined();
    const restored = { ...current, installedAt: 3, enabled: false, workspaceHandles: [] };
    mocks.rollback.mockResolvedValueOnce(restored); mocks.begin.mockClear();
    expect(await useCommunityPlugins.getState().rollback(current.manifest.id, current, current)).toBe(true);
    expect(appRegistry.get(communityAppId(dependent.manifest.id, "dependent"))).toBeUndefined();
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("does not restore stale workspace labels after a concurrent version or grant change", async () => {
    for (const next of [{ ...record, installedAt: 3, enabled: false, workspaceHandles: [] }, { ...record, workspaceHandles: [] }]) {
      useCommunityPlugins.setState({ installed: [record] });
      let finish!: (v: InstalledCommunityPlugin[]) => void;
      mocks.list.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
      const pending = useCommunityPlugins.getState().refreshResources();
      useCommunityPlugins.setState({ installed: [next] }); finish([record]); await pending;
      expect(useCommunityPlugins.getState().installed).toEqual([next]);
    }
  });

  it("holds mutation after an unexpected rollback receipt instead of activating it", async () => {
    useCommunityPlugins.setState({ installed: [record] }); mocks.rollback.mockResolvedValueOnce(record);
    expect(await useCommunityPlugins.getState().rollback(record.manifest.id, record, record)).toBe(false);
    expect(useCommunityPlugins.getState().recoveryBlocked).toBe(true);
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("refuses rollback during active calls and does not fall back on an old binary", async () => {
    useCommunityPlugins.setState({ installed: [record] });
    const release = beginCommunityPluginCall(record.manifest.id);
    expect(await useCommunityPlugins.getState().rollback(record.manifest.id, record, record)).toBe(false);
    expect(mocks.rollback).not.toHaveBeenCalled(); release();
    mocks.rollback.mockRejectedValueOnce(new Error("command not found"));
    expect(await useCommunityPlugins.getState().rollback(record.manifest.id, record, record)).toBe(false);
    expect(useCommunityPlugins.getState().installed).toEqual([record]);
    expect(mocks.installLegacy).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled();
    beginCommunityPluginCall(record.manifest.id)();
  });

  it("publishes an intake install only after native acknowledgement, without starting any runtimes", async () => {
    useCommunityPlugins.setState({ hydrated: true });
    let finish!: (value: InstalledCommunityPlugin) => void;
    mocks.installIntake.mockImplementation(() => new Promise<InstalledCommunityPlugin>((r) => { finish = r; }));
    const inspection = { manifest: record.manifest, fingerprint: record.fingerprint, fileCount: 2, totalBytes: 120 };
    const task = useCommunityPlugins.getState().install("/fixture", inspection, "intake-disabled", true);
    expect(useCommunityPlugins.getState().installed).toEqual([]);
    finish({ ...record, enabled: false, workspaceHandles: [] }); expect(await task).toBe(true);
    expect(useCommunityPlugins.getState().installed[0]!.enabled).toBe(false);
    expect(mocks.installIntake).toHaveBeenCalledWith("/fixture", record.fingerprint, record.manifest.permissions, true);
    expect(mocks.installLegacy).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled();
    expect(appRegistry.has(communityAppId(record.manifest.id, "hello"))).toBe(false);
  });

  it("never falls back to the activating legacy installer on old-binary failure", async () => {
    useCommunityPlugins.setState({ hydrated: true });
    mocks.installIntake.mockRejectedValueOnce(new Error("command not found"));
    expect(await useCommunityPlugins.getState().install("/fixture", { manifest: record.manifest, fingerprint: record.fingerprint, fileCount: 2, totalBytes: 120 }, "intake-disabled", true)).toBe(false);
    expect(useCommunityPlugins.getState().installed).toEqual([]); expect(mocks.installLegacy).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled();
  });

  it("does not overwrite an installed identity through intake", async () => {
    useCommunityPlugins.setState({ installed: [record], hydrated: true });
    expect(await useCommunityPlugins.getState().install("/fixture", { manifest: record.manifest, fingerprint: record.fingerprint, fileCount: 2, totalBytes: 120 }, "intake-disabled", true)).toBe(false);
    expect(mocks.installIntake).not.toHaveBeenCalled(); expect(useCommunityPlugins.getState().installed).toEqual([record]);
  });

  it("requires explicit rights acknowledgement on intake but preserves ordinary manager installation", async () => {
    useCommunityPlugins.setState({ hydrated: true });
    const inspection = { manifest: record.manifest, fingerprint: record.fingerprint, fileCount: 2, totalBytes: 120 };
    expect(await useCommunityPlugins.getState().install("/fixture", inspection, "intake-disabled")).toBe(false);
    expect(mocks.installIntake).not.toHaveBeenCalled();
    mocks.installLegacy.mockResolvedValue(record);
    expect(await useCommunityPlugins.getState().install("/fixture", inspection)).toBe(true);
    expect(mocks.installLegacy).toHaveBeenCalledWith("/fixture", record.fingerprint, record.manifest.permissions);
    expect(appRegistry.has(communityAppId(record.manifest.id, "hello"))).toBe(true);
  });

  it("binds manager review to current state and never falls back on reviewed-command failure", async () => {
    const inspection = { manifest: record.manifest, fingerprint: record.fingerprint, fileCount: 2, totalBytes: 120 };
    useCommunityPlugins.setState({ installed: [record] });
    expect(await useCommunityPlugins.getState().install("/fixture", inspection, "manager-reviewed", false, null)).toBe(false);
    expect(mocks.installReviewed).not.toHaveBeenCalled();
    mocks.installReviewed.mockRejectedValueOnce(new Error("command not found"));
    expect(await useCommunityPlugins.getState().install("/fixture", inspection, "manager-reviewed", false, record)).toBe(false);
    expect(mocks.installReviewed).toHaveBeenCalledWith("/fixture", record.fingerprint, record.manifest.permissions, record);
    expect(mocks.installLegacy).not.toHaveBeenCalled(); expect(useCommunityPlugins.getState().installed).toEqual([record]);
    const end = beginCommunityPluginCall(record.manifest.id); end();
  });

  it("blocks updates during a broker call and blocks new calls while publication is pending", async () => {
    const inspection = { manifest: record.manifest, fingerprint: record.fingerprint, fileCount: 2, totalBytes: 120 };
    useCommunityPlugins.setState({ installed: [record] });
    const end = beginCommunityPluginCall(record.manifest.id);
    expect(await useCommunityPlugins.getState().install("/fixture", inspection, "manager-reviewed", false, record)).toBe(false);
    expect(mocks.installReviewed).not.toHaveBeenCalled(); end();
    let fail!: (e: Error) => void;
    mocks.installReviewed.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const pending = useCommunityPlugins.getState().install("/fixture", inspection, "manager-reviewed", false, record);
    expect(() => beginCommunityPluginCall(record.manifest.id)).toThrow("update in progress");
    fail(new Error("disk failure")); expect(await pending).toBe(false);
    const next = beginCommunityPluginCall(record.manifest.id); next();
    expect(useCommunityPlugins.getState().installed).toEqual([record]);
  });

  it("holds an activity lease until runtime quarantine settles", async () => {
    useCommunityPlugins.setState({ installed: [record] });
    let finish!: () => void; mocks.quarantine.mockImplementationOnce(() => new Promise<void>((r) => { finish = r; }));
    const failure = useCommunityPlugins.getState().reportRuntimeFailure(record.manifest.id, "fixture failure");
    expect(await useCommunityPlugins.getState().install("/fixture", { manifest: record.manifest, fingerprint: record.fingerprint, fileCount: 2, totalBytes: 120 }, "manager-reviewed", false, record)).toBe(false);
    expect(mocks.installReviewed).not.toHaveBeenCalled(); finish(); await failure;
    expect(useCommunityPlugins.getState().installed[0]!.quarantined).toBe(true);
    const next = beginCommunityPluginCall(record.manifest.id); next();
  });

  it("hydrates and activates validated plugins before window restoration", async () => {
    await useCommunityPlugins.getState().hydrate();
    expect(mocks.begin).toHaveBeenCalledWith([record.manifest.id]);
    expect(appRegistry.has(communityAppId(record.manifest.id, "hello"))).toBe(true);
    expect(useCommunityPlugins.getState().installed).toHaveLength(1);
  });

  it("does not activate any community package in safe mode", async () => {
    mocks.boot.mockResolvedValue({
      active: true,
      pluginIds: [record.manifest.id],
      reason: "incomplete startup",
    });
    await useCommunityPlugins.getState().hydrate();
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(appRegistry.has(communityAppId(record.manifest.id, "hello"))).toBe(false);
    expect(useCommunityPlugins.getState().safeMode.active).toBe(true);
  });

  it("restores runtime contributions when disable persistence fails", async () => {
    await useCommunityPlugins.getState().hydrate();
    mocks.enabled.mockRejectedValueOnce(new Error("disk full"));
    const changed = await useCommunityPlugins.getState().setEnabled(record.manifest.id, false);
    expect(changed).toBe(false);
    expect(appRegistry.has(communityAppId(record.manifest.id, "hello"))).toBe(true);
    expect(useCommunityPlugins.getState().installed[0]?.enabled).toBe(true);
  });

  it("blocks disable while a privileged broker request is in flight", async () => {
    await useCommunityPlugins.getState().hydrate();
    const end = beginCommunityPluginCall(record.manifest.id);
    const changed = await useCommunityPlugins.getState().setEnabled(record.manifest.id, false);
    expect(changed).toBe(false);
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(useCommunityPlugins.getState().error).toContain("privileged plugin request");
    end();
  });

  it("revokes a workspace grant through the host even when plugin code is not involved", async () => {
    await useCommunityPlugins.getState().hydrate();
    const handle = record.workspaceHandles[0]!.id;
    const changed = await useCommunityPlugins.getState().revokeWorkspace(record.manifest.id, handle);
    expect(changed).toBe(true);
    expect(mocks.revokeWorkspace).toHaveBeenCalledWith(record.manifest.id, handle);
    expect(useCommunityPlugins.getState().installed[0]?.workspaceHandles).toEqual([]);
  });
});

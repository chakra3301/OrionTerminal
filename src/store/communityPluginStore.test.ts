import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appRegistry } from "@/plugins/appRegistry";
import { beginCommunityPluginCall, resetCommunityActivity } from "@/plugins/communityActivity";
import { communityAppId, resetCommunityRuntime } from "@/plugins/communityRuntime";
import type { InstalledCommunityPlugin } from "@/plugins/communityTypes";
import { usePluginManager } from "@/store/pluginManagerStore";

const mocks = vi.hoisted(() => ({
  boot: vi.fn(),
  list: vi.fn(),
  begin: vi.fn(),
  ready: vi.fn(),
  enabled: vi.fn(),
  quarantine: vi.fn(),
  remove: vi.fn(),
  revokeWorkspace: vi.fn(),
  clearSafe: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    pluginBootStatus: mocks.boot,
    pluginListInstalled: mocks.list,
    pluginRuntimeBegin: mocks.begin,
    pluginRuntimeReady: mocks.ready,
    pluginSetEnabled: mocks.enabled,
    pluginQuarantine: mocks.quarantine,
    pluginRemove: mocks.remove,
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

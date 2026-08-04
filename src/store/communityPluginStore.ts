import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { BUILTIN_APP_PLUGIN_CATALOG } from "@/plugins/builtinApps";
import { communityPluginDisableReason } from "@/plugins/communityActivity";
import {
  activateCommunityPlugin,
  activeCommunityPluginIds,
  deactivateCommunityPlugin,
  resetCommunityRuntime,
} from "@/plugins/communityRuntime";
import { resolveCommunityPlugins } from "@/plugins/dependencyResolver";
import { validatePluginManifest } from "@/plugins/manifest";
import type {
  CommunityPluginInspection,
  CommunityPluginSafeMode,
  InstalledCommunityPlugin,
} from "@/plugins/communityTypes";
import { usePluginManager } from "@/store/pluginManagerStore";

const EMPTY_SAFE_MODE: CommunityPluginSafeMode = {
  active: false,
  pluginIds: [],
  reason: null,
};

let runtimeReadyTimer: ReturnType<typeof setTimeout> | null = null;

function enabledBuiltinIds(): Set<string> {
  const manager = usePluginManager.getState();
  return new Set(
    BUILTIN_APP_PLUGIN_CATALOG
      .filter((plugin) => manager.isEnabled(plugin.pluginId))
      .map((plugin) => plugin.pluginId),
  );
}

function validated(records: readonly InstalledCommunityPlugin[]): {
  records: InstalledCommunityPlugin[];
  issues: Record<string, string>;
} {
  const clean: InstalledCommunityPlugin[] = [];
  const issues: Record<string, string> = {};
  for (const record of records) {
    const result = validatePluginManifest(record.manifest);
    if (!result.ok) {
      issues[record.manifest.id || "unknown"] = result.issues.join(" ");
      continue;
    }
    clean.push({ ...record, manifest: result.manifest });
  }
  return { records: clean, issues };
}

async function synchronize(records: readonly InstalledCommunityPlugin[]): Promise<{
  records: InstalledCommunityPlugin[];
  issues: Record<string, string>;
}> {
  const checked = validated(records);
  const resolution = resolveCommunityPlugins(checked.records, enabledBuiltinIds());
  const desired = new Set(resolution.activationOrder.map((plugin) => plugin.manifest.id));
  for (const pluginId of activeCommunityPluginIds()) {
    if (!desired.has(pluginId)) deactivateCommunityPlugin(pluginId);
  }

  await ipc.pluginRuntimeBegin(Array.from(desired));
  const nextRecords = [...checked.records];
  const issues = { ...checked.issues, ...resolution.issues };
  for (const plugin of resolution.activationOrder) {
    try {
      activateCommunityPlugin(plugin);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      issues[plugin.manifest.id] = reason;
      deactivateCommunityPlugin(plugin.manifest.id);
      try {
        await ipc.pluginQuarantine(plugin.manifest.id, reason);
      } catch (quarantineError) {
        log.error("community plugin quarantine failed", plugin.manifest.id, quarantineError);
      }
      const index = nextRecords.findIndex((record) => record.manifest.id === plugin.manifest.id);
      if (index >= 0) {
        nextRecords[index] = {
          ...nextRecords[index]!,
          enabled: false,
          quarantined: true,
          quarantineReason: reason,
        };
      }
    }
  }
  if (runtimeReadyTimer) clearTimeout(runtimeReadyTimer);
  runtimeReadyTimer = setTimeout(() => {
    runtimeReadyTimer = null;
    void ipc.pluginRuntimeReady().catch((error) =>
      log.error("community plugin startup marker clear failed", error),
    );
  }, 5000);
  return { records: nextRecords, issues };
}

type CommunityPluginState = {
  hydrated: boolean;
  installed: InstalledCommunityPlugin[];
  safeMode: CommunityPluginSafeMode;
  activationIssues: Record<string, string>;
  busyIds: string[];
  error: string | null;
  hydrate: () => Promise<void>;
  install: (sourcePath: string, inspection: CommunityPluginInspection) => Promise<boolean>;
  setEnabled: (pluginId: string, enabled: boolean) => Promise<boolean>;
  remove: (pluginId: string) => Promise<boolean>;
  clearSafeMode: () => Promise<boolean>;
  reportRuntimeFailure: (pluginId: string, reason: string) => Promise<void>;
  clearError: () => void;
};

export const useCommunityPlugins = create<CommunityPluginState>((set, get) => ({
  hydrated: false,
  installed: [],
  safeMode: EMPTY_SAFE_MODE,
  activationIssues: {},
  busyIds: [],
  error: null,

  hydrate: async () => {
    try {
      const [safeMode, raw] = await Promise.all([
        ipc.pluginBootStatus(),
        ipc.pluginListInstalled(),
      ]);
      const checked = validated(raw);
      if (safeMode.active) {
        resetCommunityRuntime();
        set({
          hydrated: true,
          installed: checked.records,
          safeMode,
          activationIssues: checked.issues,
          error: null,
        });
        return;
      }
      const synced = await synchronize(checked.records);
      set({
        hydrated: true,
        installed: synced.records,
        safeMode,
        activationIssues: synced.issues,
        error: null,
      });
    } catch (error) {
      resetCommunityRuntime();
      const message = error instanceof Error ? error.message : String(error);
      set({ hydrated: true, safeMode: EMPTY_SAFE_MODE, error: message });
    }
  },

  install: async (sourcePath, inspection) => {
    const pluginId = inspection.manifest.id;
    if (get().busyIds.length > 0) {
      set({ error: "Wait for the current plugin change to finish." });
      return false;
    }
    set((state) => ({ busyIds: [...state.busyIds, pluginId], error: null }));
    let persisted: InstalledCommunityPlugin | null = null;
    try {
      persisted = await ipc.pluginInstallDirectory(
        sourcePath,
        inspection.fingerprint,
        inspection.manifest.permissions,
      );
      deactivateCommunityPlugin(pluginId);
      const records = [
        ...get().installed.filter((plugin) => plugin.manifest.id !== pluginId),
        persisted,
      ];
      set({ installed: records });
      const synced = get().safeMode.active
        ? { records, issues: get().activationIssues }
        : await synchronize(records);
      set({ installed: synced.records, activationIssues: synced.issues });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ error: persisted ? `Package installed, but activation failed: ${message}` : message });
      return persisted !== null;
    } finally {
      set((state) => ({ busyIds: state.busyIds.filter((id) => id !== pluginId) }));
    }
  },

  setEnabled: async (pluginId, enabled) => {
    const state = get();
    const record = state.installed.find((plugin) => plugin.manifest.id === pluginId);
    if (!record) {
      set({ error: `Unknown community plugin: ${pluginId}` });
      return false;
    }
    if (state.busyIds.length > 0) {
      set({ error: "Wait for the current plugin change to finish." });
      return false;
    }
    if (!enabled) {
      const reason = communityPluginDisableReason(pluginId);
      if (reason) {
        set({ error: reason });
        return false;
      }
    }
    set((current) => ({ busyIds: [...current.busyIds, pluginId], error: null }));
    const previous = record;
    try {
      if (enabled) {
        await ipc.pluginSetEnabled(pluginId, true);
      } else {
        const failures = deactivateCommunityPlugin(pluginId);
        if (failures.length > 0) throw new Error("Plugin cleanup reported an error.");
        await ipc.pluginSetEnabled(pluginId, false);
      }
      const records = get().installed.map((plugin) =>
        plugin.manifest.id === pluginId
          ? { ...plugin, enabled, quarantined: false, quarantineReason: null }
          : plugin,
      );
      const synced = get().safeMode.active
        ? { records, issues: get().activationIssues }
        : await synchronize(records);
      set({ installed: synced.records, activationIssues: synced.issues });
      return true;
    } catch (error) {
      try {
        await ipc.pluginSetEnabled(pluginId, previous.enabled);
        if (previous.enabled && !get().safeMode.active) activateCommunityPlugin(previous);
        else deactivateCommunityPlugin(pluginId);
      } catch (rollbackError) {
        log.error("community plugin enablement rollback failed", pluginId, rollbackError);
      }
      const message = error instanceof Error ? error.message : String(error);
      set({ error: message });
      return false;
    } finally {
      set((current) => ({ busyIds: current.busyIds.filter((id) => id !== pluginId) }));
    }
  },

  remove: async (pluginId) => {
    const state = get();
    const previous = state.installed.find((plugin) => plugin.manifest.id === pluginId);
    if (!previous) return false;
    const reason = communityPluginDisableReason(pluginId);
    if (reason) {
      set({ error: reason });
      return false;
    }
    if (state.busyIds.length > 0) {
      set({ error: "Wait for the current plugin change to finish." });
      return false;
    }
    set((current) => ({ busyIds: [...current.busyIds, pluginId], error: null }));
    let removed = false;
    try {
      deactivateCommunityPlugin(pluginId);
      await ipc.pluginRemove(pluginId);
      removed = true;
      const records = get().installed.filter((plugin) => plugin.manifest.id !== pluginId);
      set({ installed: records });
      const synced = get().safeMode.active
        ? { records, issues: get().activationIssues }
        : await synchronize(records);
      set({ installed: synced.records, activationIssues: synced.issues });
      return true;
    } catch (error) {
      if (!removed && previous.enabled && !previous.quarantined && !get().safeMode.active) {
        try {
          activateCommunityPlugin(previous);
        } catch (rollbackError) {
          log.error("community plugin removal rollback failed", pluginId, rollbackError);
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      set({
        error: removed ? `Package removed, but runtime refresh failed: ${message}` : message,
      });
      return removed;
    } finally {
      set((current) => ({ busyIds: current.busyIds.filter((id) => id !== pluginId) }));
    }
  },

  clearSafeMode: async () => {
    try {
      await ipc.pluginSafeModeClear();
      set({ safeMode: EMPTY_SAFE_MODE, error: null });
      const synced = await synchronize(get().installed);
      set({ installed: synced.records, activationIssues: synced.issues });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  reportRuntimeFailure: async (pluginId, reason) => {
    deactivateCommunityPlugin(pluginId);
    try {
      await ipc.pluginQuarantine(pluginId, reason);
    } catch (error) {
      log.error("community plugin runtime quarantine failed", pluginId, error);
    }
    set((state) => ({
      installed: state.installed.map((plugin) =>
        plugin.manifest.id === pluginId
          ? { ...plugin, enabled: false, quarantined: true, quarantineReason: reason }
          : plugin,
      ),
      activationIssues: { ...state.activationIssues, [pluginId]: reason },
    }));
  },

  clearError: () => set({ error: null }),
}));

export async function syncCommunityDependencies(): Promise<void> {
  const state = useCommunityPlugins.getState();
  if (!state.hydrated || state.safeMode.active) return;
  const synced = await synchronize(state.installed);
  useCommunityPlugins.setState({
    installed: synced.records,
    activationIssues: synced.issues,
  });
}

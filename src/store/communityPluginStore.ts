import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import { BUILTIN_APP_PLUGIN_CATALOG } from "@/plugins/builtinApps";
import { beginCommunityPluginCall, beginCommunityPluginChange, communityPluginDisableReason, communityPluginVersion } from "@/plugins/communityActivity";
import {
  activateCommunityPlugin,
  activeCommunityPluginIds,
  deactivateCommunityPlugin,
  resetCommunityRuntime,
} from "@/plugins/communityRuntime";
import { resolveCommunityPlugins } from "@/plugins/dependencyResolver";
import { validatePluginManifest } from "@/plugins/manifest";
import { parsePackageInspection, parseDisabledInstallReceipt } from "@/plugins/pluginInstallReview";
import type {
  CommunityPluginInspection,
  CommunityPluginSafeMode,
  InstalledCommunityPlugin,
  PreparedInstallSelection,
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
    clean.push({
      ...record,
      manifest: result.manifest,
      workspaceHandles: Array.isArray(record.workspaceHandles) ? record.workspaceHandles : [],
    });
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
  recoveryBlocked: boolean;
  installed: InstalledCommunityPlugin[];
  safeMode: CommunityPluginSafeMode;
  activationIssues: Record<string, string>;
  busyIds: string[];
  error: string | null;
  hydrate: () => Promise<void>;
  install: (sourcePath: string, inspection: CommunityPluginInspection, mode?: "intake-disabled" | "manager-reviewed", rightsReviewed?: boolean, expectedCurrent?: InstalledCommunityPlugin | null, current?: () => boolean) => Promise<boolean>;
  installPrepared: (selection: PreparedInstallSelection, rightsReviewed: boolean, current: () => boolean) => Promise<boolean>;
  rollback: (pluginId: string, current: InstalledCommunityPlugin, previous: InstalledCommunityPlugin) => Promise<boolean>;
  setEnabled: (pluginId: string, enabled: boolean) => Promise<boolean>;
  remove: (pluginId: string, expectedCurrent: InstalledCommunityPlugin) => Promise<boolean>;
  refreshResources: () => Promise<void>;
  revokeWorkspace: (pluginId: string, handle: string) => Promise<boolean>;
  clearSafeMode: () => Promise<boolean>;
  reportRuntimeFailure: (pluginId: string, reason: string) => Promise<void>;
  clearError: () => void;
};

export const useCommunityPlugins = create<CommunityPluginState>((set, get) => ({
  hydrated: false,
  recoveryBlocked: false,
  installed: [],
  safeMode: EMPTY_SAFE_MODE,
  activationIssues: {},
  busyIds: [],
  error: null,

  hydrate: async () => {
    if (get().busyIds.length) { set({ error: "Wait for the current package change before reloading." }); return; }
    set({ busyIds: ["@host/recovery"], hydrated: false });
    try {
      const [safeMode, raw] = await Promise.all([
        ipc.pluginBootStatus(),
        ipc.pluginRecoverInstalled(),
      ]);
      const checked = validated(raw);
      if (safeMode.active) {
        resetCommunityRuntime();
        set({
          hydrated: true,
          recoveryBlocked: false,
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
        recoveryBlocked: false,
        installed: synced.records,
        safeMode,
        activationIssues: synced.issues,
        error: null,
      });
    } catch (error) {
      resetCommunityRuntime();
      const message = error instanceof Error ? error.message : String(error);
      set({ hydrated: false, recoveryBlocked: true, safeMode: { active: true, pluginIds: [], reason: "Package recovery or registry load failed. Reload after resolving the error." }, error: message });
    } finally { set({ busyIds: [] }); }
  },

  install: async (sourcePath, inspection, mode, rightsReviewed = false, expectedCurrent, current = () => true) => {
    if (get().recoveryBlocked || (mode === "intake-disabled" && !get().hydrated)) { set({ error: "Reload Plugin Manager before making changes." }); return false; }
    try { inspection = mode === "intake-disabled" ? parsePackageInspection(inspection) : structuredClone(inspection); }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); return false; }
    if (mode === "intake-disabled" && !current()) { set({ error: "Package installation review was dismissed; nothing was sent." }); return false; }
    if (mode === "manager-reviewed") {
      const current = get().installed.find((p) => p.manifest.id === inspection.manifest.id) ?? null;
      if (expectedCurrent === undefined || JSON.stringify(current) !== JSON.stringify(expectedCurrent)) {
        set({ error: "Installed plugin changed after review; inspect and approve again." });
        return false;
      }
      expectedCurrent = structuredClone(expectedCurrent);
    }
    if (mode === "intake-disabled" && !rightsReviewed) {
      set({ error: "Review source rights and permission requests before installation." });
      return false;
    }
    const pluginId = inspection.manifest.id;
    if (mode === "intake-disabled" && get().installed.some((p) => p.manifest.id === pluginId)) {
      set({ error: "This identity is already installed. Manage updates in Plugin Manager." });
      return false;
    }
    if (get().busyIds.length > 0) {
      set({ error: "Wait for the current plugin change to finish." });
      return false;
    }
    let release: () => void;
    try { release = beginCommunityPluginChange(pluginId); }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); return false; }
    set((state) => ({ busyIds: [...state.busyIds, pluginId], error: null }));
    let persisted: InstalledCommunityPlugin | null = null;
    try {
      if (mode === "intake-disabled") {
        if (!current()) { set({ error: "Package installation review was dismissed; nothing was sent." }); return false; }
        const installed = parseDisabledInstallReceipt(await ipc.pluginInstallIntakeDirectory(sourcePath, inspection.fingerprint, inspection.manifest.permissions, rightsReviewed), inspection);
        persisted = installed;
        set((state) => ({ installed: [...state.installed.filter((p) => p.manifest.id !== pluginId), installed] }));
        return true;
      }
      persisted = mode === "manager-reviewed"
        ? await ipc.pluginInstallReviewedDirectory(sourcePath, inspection.fingerprint, inspection.manifest.permissions, expectedCurrent!)
        : await ipc.pluginInstallDirectory(sourcePath, inspection.fingerprint, inspection.manifest.permissions);
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
      if (mode === "intake-disabled") set({ recoveryBlocked: true, hydrated: false, error: `${message} Reload Plugin Manager before retrying; an installation may already be saved.` });
      else set({ error: persisted ? `Package installed, but activation failed: ${message}` : message });
      return persisted !== null;
    } finally {
      release();
      set((state) => ({ busyIds: state.busyIds.filter((id) => id !== pluginId) }));
    }
  },

  installPrepared: async (value, rightsReviewed, current) => {
    if (!get().hydrated || get().recoveryBlocked || get().busyIds.length) { set({ error: "Reload Plugin Manager or wait for the current package operation." }); return false; }
    const selection = structuredClone(value), inspection = selection.inspection;
    const pluginId = inspection.manifest.id, manifest = validatePluginManifest(inspection.manifest);
    if (!rightsReviewed || !manifest.ok || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(selection.id)
      || pluginId !== `dev.orion.prepared2048.${selection.id.toLowerCase()}`
      || ![selection.outputHash, selection.captureHash, inspection.fingerprint].every((h) => /^[a-f0-9]{64}$/.test(h))
      || inspection.fileCount !== 35 || !Number.isSafeInteger(inspection.totalBytes) || inspection.totalBytes < 1 || inspection.totalBytes > 2 * 1024 * 1024
      || inspection.manifest.permissions.join() !== "storage.plugin") { set({ error: "Review exact prepared bytes, source rights and permission requests before installation." }); return false; }
    if (get().installed.some((p) => p.manifest.id === pluginId)) { set({ error: "This identity is already installed. Manage updates in Plugin Manager." }); return false; }
    if (!current()) { set({ error: "Prepared installation review was dismissed; nothing was sent." }); return false; }
    let release: () => void;
    try { release = beginCommunityPluginChange(pluginId); } catch (e) { set({ error: String(e) }); return false; }
    set({ busyIds: [pluginId], error: null });
    try {
      // Recheck the UI lease after synchronous subscribers, before invoking an irreversible publication.
      if (!current()) { set({ error: "Prepared installation review was dismissed; nothing was sent." }); return false; }
      const installed = parseDisabledInstallReceipt(await ipc.pluginInstallPrepared(selection, rightsReviewed), inspection);
      set((state) => ({ installed: [...state.installed.filter((p) => p.manifest.id !== pluginId), structuredClone(installed)] }));
      return true;
    } catch (e) {
      set({ recoveryBlocked: true, hydrated: false, error: `${e instanceof Error ? e.message : String(e)} Reload Plugin Manager before retrying; an installation may already be saved.` });
      return false;
    } finally { release(); set((state) => ({ busyIds: state.busyIds.filter((id) => id !== pluginId) })); }
  },

  rollback: async (pluginId, current, previous) => {
    if (get().recoveryBlocked || get().busyIds.length) { set({ error: "Reload recovery or wait for the current package operation." }); return false; }
    if (current.manifest.id !== pluginId || previous.manifest.id !== pluginId || JSON.stringify(get().installed.find((p) => p.manifest.id === pluginId)) !== JSON.stringify(current)) { set({ error: "Package changed since rollback review." }); return false; }
    const expected = structuredClone(current), target = structuredClone(previous);
    let release: () => void;
    try { release = beginCommunityPluginChange(pluginId); } catch (e) { set({ error: String(e) }); return false; }
    set({ busyIds: [pluginId], error: null });
    try {
      const restored = await ipc.pluginRollbackReviewed(pluginId, expected, target);
      deactivateCommunityPlugin(pluginId);
      if (!restored || restored.manifest?.id !== pluginId || restored.fingerprint !== target.fingerprint || restored.enabled !== false || !Array.isArray(restored.workspaceHandles) || restored.workspaceHandles.length > 0 || !Number.isSafeInteger(restored.installedAt) || restored.installedAt <= expected.installedAt) {
        set({ recoveryBlocked: true, hydrated: false });
        throw new Error("Unexpected rollback receipt. Reload packages before making changes.");
      }
      const installed = get().installed.map((p) => p.manifest.id === pluginId ? restored : p);
      const resolution = resolveCommunityPlugins(installed, enabledBuiltinIds());
      const desired = new Set(resolution.activationOrder.map((p) => p.manifest.id));
      for (const id of activeCommunityPluginIds()) if (!desired.has(id)) deactivateCommunityPlugin(id);
      set({ installed, activationIssues: { ...resolution.issues, [pluginId]: "Rolled back disabled. Review stored data compatibility, then enable explicitly." } });
      return true;
    } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); return false; }
    finally { release(); set({ busyIds: [] }); }
  },

  setEnabled: async (pluginId, enabled) => {
    if (get().recoveryBlocked) { set({ error: "Reload package recovery before making changes." }); return false; }
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

  remove: async (pluginId, expectedCurrent) => {
    if (get().recoveryBlocked) { set({ error: "Reload package recovery before making changes." }); return false; }
    const state = get();
    const previous = state.installed.find((plugin) => plugin.manifest.id === pluginId);
    if (!previous) return false;
    if (JSON.stringify(previous) !== JSON.stringify(expectedCurrent)) { set({ error: "Package changed since removal review. Review it again." }); return false; }
    const reviewed = structuredClone(expectedCurrent);
    const reason = communityPluginDisableReason(pluginId);
    if (reason) {
      set({ error: reason });
      return false;
    }
    if (state.busyIds.length > 0) {
      set({ error: "Wait for the current plugin change to finish." });
      return false;
    }
    let release: () => void;
    try { release = beginCommunityPluginChange(pluginId); } catch (e) { set({ error: String(e) }); return false; }
    set((current) => ({ busyIds: [...current.busyIds, pluginId], error: null }));
    let removed = false;
    try {
      deactivateCommunityPlugin(pluginId);
      await ipc.pluginRemoveReviewed(pluginId, reviewed);
      removed = true;
      const records = get().installed.filter((plugin) => plugin.manifest.id !== pluginId);
      set({ installed: records });
      const synced = get().safeMode.active
        ? { records, issues: get().activationIssues }
        : await synchronize(records);
      set({ installed: synced.records, activationIssues: synced.issues });
      return true;
    } catch (error) {
      if (!removed) {
        resetCommunityRuntime();
        set({ recoveryBlocked: true, hydrated: false });
      }
      const message = error instanceof Error ? error.message : String(error);
      set({
        error: removed ? `Package removed, but runtime refresh failed: ${message}` : `Removal not confirmed. Reload packages to recover before making changes. ${message}`,
      });
      return removed;
    } finally {
      release();
      set((current) => ({ busyIds: current.busyIds.filter((id) => id !== pluginId) }));
    }
  },

  refreshResources: async () => {
    if (get().busyIds.length || get().recoveryBlocked) return;
    const before = new Map(get().installed.map((p) => [p.manifest.id, JSON.stringify(p)]));
    try {
      const checked = validated(await ipc.pluginListInstalled());
      const resources = new Map(checked.records.map((p) => [p.manifest.id, p]));
      set((state) => ({
        installed: state.installed.map((plugin) => {
          const native = resources.get(plugin.manifest.id);
          if (!native || JSON.stringify(plugin) !== before.get(plugin.manifest.id) || communityPluginVersion(native) !== communityPluginVersion(plugin)) return plugin;
          return { ...plugin, workspaceHandles: native.workspaceHandles };
        }),
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  revokeWorkspace: async (pluginId, handle) => {
    if (get().recoveryBlocked) { set({ error: "Reload package recovery before making changes." }); return false; }
    const state = get();
    if (!state.installed.some((plugin) => plugin.manifest.id === pluginId)) {
      set({ error: `Unknown community plugin: ${pluginId}` });
      return false;
    }
    if (state.busyIds.length > 0) {
      set({ error: "Wait for the current plugin change to finish." });
      return false;
    }
    set((current) => ({ busyIds: [...current.busyIds, pluginId], error: null }));
    try {
      const workspaceHandles = await ipc.pluginWorkspaceRevoke(pluginId, handle);
      set((current) => ({
        installed: current.installed.map((plugin) =>
          plugin.manifest.id === pluginId ? { ...plugin, workspaceHandles } : plugin,
        ),
      }));
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally {
      set((current) => ({ busyIds: current.busyIds.filter((id) => id !== pluginId) }));
    }
  },

  clearSafeMode: async () => {
    if (get().recoveryBlocked || get().busyIds.length) { set({ error: "Reload package recovery or wait for the current operation." }); return false; }
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
    const version = communityPluginVersion(get().installed.find((p) => p.manifest.id === pluginId));
    let release: () => void;
    try { release = beginCommunityPluginCall(pluginId); } catch { return; }
    try {
      deactivateCommunityPlugin(pluginId);
      try { await ipc.pluginQuarantine(pluginId, reason); }
      catch (error) { log.error("community plugin runtime quarantine failed", pluginId, error); }
      if (communityPluginVersion(get().installed.find((p) => p.manifest.id === pluginId)) !== version) return;
      set((state) => ({
        installed: state.installed.map((plugin) => plugin.manifest.id === pluginId
          ? { ...plugin, enabled: false, quarantined: true, quarantineReason: reason } : plugin),
        activationIssues: { ...state.activationIssues, [pluginId]: reason },
      }));
    } finally { release(); }
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

import { create } from "zustand";
import { setAppState } from "@/lib/db";
import { log } from "@/lib/log";
import {
  BUILTIN_APP_PLUGIN_CATALOG,
  BUILTIN_APP_PLUGIN_IDS,
  syncBuiltinAppPlugins,
} from "@/plugins/builtinApps";
import { useHermes } from "@/store/hermesStore";
import { useCommand } from "@/store/commandStore";
import {
  archivesDisableReason,
  loadArchivesPluginData,
} from "@/apps/archives/pluginContributions";

export type PluginEnablementV1 = {
  version: 1;
  disabled: string[];
};

type PluginManagerState = {
  hydrated: boolean;
  disabledIds: string[];
  busyIds: string[];
  error: string | null;
  hydrate: (value: unknown) => void;
  isEnabled: (pluginId: string) => boolean;
  setEnabled: (pluginId: string, enabled: boolean) => Promise<boolean>;
  clearError: () => void;
};

const catalogById = new Map(
  BUILTIN_APP_PLUGIN_CATALOG.map((plugin) => [plugin.pluginId, plugin]),
);

function normalize(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const raw = value as { version?: unknown; disabled?: unknown };
  if (raw.version !== 1 || !Array.isArray(raw.disabled)) return [];
  return Array.from(
    new Set(
      raw.disabled.filter(
        (id): id is string =>
          typeof id === "string" && catalogById.get(id)?.disableable === true,
      ),
    ),
  ).sort();
}

function persisted(disabledIds: string[]): PluginEnablementV1 {
  return { version: 1, disabled: [...disabledIds].sort() };
}

function blockReason(pluginId: string): string | null {
  const plugin = catalogById.get(pluginId);
  if (!plugin) return "Unknown plugin.";
  if (!plugin.disableable) return "This built-in remains required while its private contributions migrate.";
  if (pluginId === BUILTIN_APP_PLUGIN_IDS.archives) {
    return archivesDisableReason();
  }
  if (pluginId === BUILTIN_APP_PLUGIN_IDS.hermes) {
    const hermes = useHermes.getState();
    if (
      Array.from(hermes.tasks.values()).some((task) => task.status === "running") ||
      Array.from(hermes.agents.values()).some((agent) => agent.status === "running")
    ) {
      return "Stop every running Hermes task before disabling the plugin.";
    }
  }
  if (pluginId === BUILTIN_APP_PLUGIN_IDS.command) {
    const command = useCommand.getState();
    if (command.activeRun || command.planning || command.dispatching) {
      return "Wait for Command Center planning and agent runs to finish before disabling the plugin.";
    }
  }
  return null;
}

async function loadPluginData(pluginId: string): Promise<void> {
  if (pluginId === BUILTIN_APP_PLUGIN_IDS.archives) {
    await loadArchivesPluginData();
  } else if (pluginId === BUILTIN_APP_PLUGIN_IDS.hermes) {
    await useHermes.getState().load();
  } else if (pluginId === BUILTIN_APP_PLUGIN_IDS.command) {
    await useCommand.getState().load();
  } else if (pluginId === BUILTIN_APP_PLUGIN_IDS.xdesign) {
    const { useXDProjects } = await import("@/apps/xdesign/projectsStore");
    await useXDProjects.getState().init();
  }
}

export const usePluginManager = create<PluginManagerState>((set, get) => ({
  hydrated: false,
  disabledIds: [],
  busyIds: [],
  error: null,

  hydrate: (value) => {
    const disabledIds = normalize(value);
    const failures = syncBuiltinAppPlugins(new Set(disabledIds));
    set({
      hydrated: true,
      disabledIds,
      error: failures.length > 0 ? "One or more plugins did not deactivate cleanly." : null,
    });
  },

  isEnabled: (pluginId) => get().hydrated && !get().disabledIds.includes(pluginId),

  setEnabled: async (pluginId, enabled) => {
    const current = get();
    if (!current.hydrated) {
      set({ error: "Plugin state is still loading." });
      return false;
    }
    const plugin = catalogById.get(pluginId);
    if (!plugin) {
      set({ error: `Unknown plugin: ${pluginId}` });
      return false;
    }
    const isEnabled = !current.disabledIds.includes(pluginId);
    if (isEnabled === enabled) return true;
    if (current.busyIds.length > 0) {
      set({ error: "Wait for the current plugin change to finish." });
      return false;
    }
    if (!enabled) {
      const reason = blockReason(pluginId);
      if (reason) {
        set({ error: reason });
        return false;
      }
    }

    const previous = current.disabledIds;
    const next = enabled
      ? previous.filter((id) => id !== pluginId)
      : [...previous, pluginId].sort();
    set((state) => ({
      disabledIds: next,
      busyIds: [...new Set([...state.busyIds, pluginId])],
      error: null,
    }));

    try {
      const failures = syncBuiltinAppPlugins(new Set(next));
      if (failures.length > 0) throw new Error("Plugin cleanup reported an error.");
      await setAppState("plugins.state", persisted(next));
      if (enabled) await loadPluginData(pluginId);
      return true;
    } catch (error) {
      set({ disabledIds: previous });
      let runtimeRollbackFailed = false;
      try {
        syncBuiltinAppPlugins(new Set(previous));
      } catch (rollbackError) {
        runtimeRollbackFailed = true;
        log.error("plugin enablement runtime rollback failed", rollbackError);
      }
      try {
        await setAppState("plugins.state", persisted(previous));
      } catch (rollbackError) {
        log.error("plugin enablement rollback persist failed", rollbackError);
      }
      const message = error instanceof Error ? error.message : String(error);
      log.error("plugin enablement update failed", pluginId, error);
      set({
        error: runtimeRollbackFailed
          ? `${message} Runtime recovery failed; restart Orion Terminal.`
          : message,
      });
      return false;
    } finally {
      set((state) => ({
        busyIds: state.busyIds.filter((id) => id !== pluginId),
      }));
    }
  },

  clearError: () => set({ error: null }),
}));

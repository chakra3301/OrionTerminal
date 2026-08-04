import { useSyncExternalStore } from "react";
import { Blocks } from "lucide-react";
import { registry, type Command } from "@/commands/registry";
import { appRegistry, type AppDescriptor } from "@/plugins/appRegistry";
import { DisposableScope } from "@/plugins/contracts";
import { validatePluginManifest, type PluginAppContributionV1 } from "@/plugins/manifest";
import type { InstalledCommunityPlugin } from "@/plugins/communityTypes";
import { useShell } from "@/shell/store/useShell";

const active = new Map<string, { record: InstalledCommunityPlugin; scope: DisposableScope }>();
const listeners = new Set<() => void>();
let activeSnapshot: readonly InstalledCommunityPlugin[] = [];

const ACCENTS = {
  cyan: { css: "var(--neon-cyan)", rgb: "0,224,255", foreground: "#011018" },
  green: { css: "var(--neon-green)", rgb: "57,255,136", foreground: "#001008" },
  magenta: { css: "var(--neon-magenta)", rgb: "255,62,165", foreground: "#1b0613" },
  yellow: { css: "var(--neon-yellow)", rgb: "230,255,58", foreground: "#171a02" },
  violet: { css: "var(--neon-violet)", rgb: "177,76,255", foreground: "#10051a" },
} as const;

function emit(): void {
  activeSnapshot = Array.from(active.values(), ({ record }) => record);
  for (const listener of listeners) listener();
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function communityAppId(pluginId: string, contributionId: string): string {
  return `community:${stableHash(pluginId)}:${contributionId}`;
}

function descriptorFor(
  record: InstalledCommunityPlugin,
  app: PluginAppContributionV1,
  index: number,
): AppDescriptor {
  const accent = ACCENTS[app.accent ?? "cyan"];
  const id = communityAppId(record.manifest.id, app.id);
  const window = app.window ?? {};
  return {
    id,
    name: app.name,
    order: 1000 + index,
    renderer: {
      kind: "sandboxed-plugin",
      pluginId: record.manifest.id,
      contributionId: app.id,
    },
    window: {
      title: window.title ?? app.name.toUpperCase(),
      subtitle: window.subtitle ?? "sandboxed plugin",
      defaultSize: {
        w: window.width ?? 860,
        h: window.height ?? 620,
      },
    },
    dock: {
      Icon: Blocks,
      background: `linear-gradient(135deg, rgba(${accent.rgb},0.4), rgba(${accent.rgb},0.05))`,
      glow: `0 0 14px -2px rgba(${accent.rgb},0.45)`,
      foreground: accent.foreground,
    },
    spotlight: { description: app.description ?? `Community plugin · ${record.manifest.publisher}` },
    accent: accent.css,
    menuNames: ["Plugin", "View", "Window"],
    openCommand: {
      id: `plugin.open.${stableHash(record.manifest.id)}.${app.id}`,
      label: `Open ${app.name}`,
      keywords: ["plugin", record.manifest.name, ...(app.description?.split(/\s+/).slice(0, 8) ?? [])],
    },
  };
}

export function activateCommunityPlugin(record: InstalledCommunityPlugin): void {
  const pluginId = record.manifest.id;
  if (active.has(pluginId)) return;
  if (!record.enabled || record.quarantined) throw new Error(`plugin is not eligible for activation: ${pluginId}`);
  const validation = validatePluginManifest(record.manifest);
  if (!validation.ok) throw new Error(validation.issues.join("\n"));

  const scope = new DisposableScope();
  try {
    const apps = validation.manifest.contributes?.apps ?? [];
    const appIds = new Map<string, string>();
    apps.forEach((app, index) => {
      const descriptor = descriptorFor(record, app, index);
      appIds.set(app.id, descriptor.id);
      scope.add(appRegistry.register(pluginId, descriptor));
    });
    for (const contributed of validation.manifest.contributes?.commands ?? []) {
      const appId = appIds.get(contributed.app);
      if (!appId) throw new Error(`command references missing app: ${contributed.app}`);
      const command: Command = {
        id: `plugin.command.${stableHash(pluginId)}.${contributed.id}`,
        label: contributed.title,
        group: "View",
        keywords: ["plugin", record.manifest.name, ...(contributed.keywords ?? [])],
        run: () => {
          useShell.getState().openApp(appId);
        },
      };
      scope.add(registry.register(command, pluginId));
    }
    active.set(pluginId, { record: { ...record, manifest: validation.manifest }, scope });
    emit();
  } catch (error) {
    scope.dispose();
    throw error;
  }
}

export function deactivateCommunityPlugin(pluginId: string): readonly unknown[] {
  const runtime = active.get(pluginId);
  if (!runtime) return [];
  active.delete(pluginId);
  runtime.scope.dispose();
  emit();
  return runtime.scope.errors();
}

export function activeCommunityPluginIds(): readonly string[] {
  return Array.from(active.keys());
}

export function activeCommunityPlugins(): readonly InstalledCommunityPlugin[] {
  return activeSnapshot;
}

export function useActiveCommunityPlugins(): readonly InstalledCommunityPlugin[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activeCommunityPlugins,
    activeCommunityPlugins,
  );
}

export function resetCommunityRuntime(): void {
  for (const pluginId of activeCommunityPluginIds()) deactivateCommunityPlugin(pluginId);
}

import { lazy } from "react";
import { Archive, Code2, Palette, Radar, Workflow } from "lucide-react";
import { registry, type Command } from "@/commands/registry";
import { useShell } from "@/shell/store/useShell";
import { appRegistry, type AppDescriptor } from "@/plugins/appRegistry";
import { internalPluginHost } from "@/plugins/host";
import type { InternalPlugin } from "@/plugins/contracts";

export const BUILTIN_APP_PLUGIN_IDS = {
  archives: "@orion/archives",
  orion: "@orion/editor",
  xdesign: "@orion/xdesign",
  command: "@orion/command-center",
  hermes: "@orion/hermes",
} as const;

const apps: readonly AppDescriptor[] = [
  {
    id: "archives",
    name: "Archives 47",
    order: 10,
    renderer: {
      kind: "trusted-react",
      component: lazy(() =>
        import("@/apps/archives/ArchivesApp").then((module) => ({ default: module.ArchivesApp })),
      ),
    },
    window: {
      title: "ARCHIVES 47",
      subtitle: "today",
      defaultSize: { w: 1080, h: 720 },
    },
    dock: {
      Icon: Archive,
      background: "linear-gradient(135deg, rgba(57,255,136,0.4), rgba(57,255,136,0.05))",
      glow: "0 0 14px -2px rgba(57,255,136,0.4)",
      foreground: "#001008",
    },
    spotlight: { description: "personal knowledge base" },
    accent: "var(--neon-green)",
    menuNames: ["File", "Edit", "View", "Insert", "Format"],
    openCommand: {
      id: "app.openArchives",
      label: "Open Archives 47",
      hotkey: "mod+1",
      keywords: ["archive", "notes", "journal"],
    },
  },
  {
    id: "orion",
    name: "Orion",
    order: 20,
    renderer: {
      kind: "trusted-react",
      component: lazy(() =>
        import("@/apps/orion/OrionApp").then((module) => ({ default: module.OrionApp })),
      ),
    },
    window: {
      title: "ORION",
      subtitle: "orix47",
      defaultSize: { w: 1280, h: 800 },
    },
    dock: {
      Icon: Code2,
      background: "linear-gradient(135deg, rgba(0,224,255,0.45), rgba(0,224,255,0.05))",
      glow: "0 0 14px -2px rgba(0,224,255,0.5)",
      foreground: "#011018",
    },
    spotlight: { description: "code editor" },
    accent: "var(--neon-cyan)",
    menuNames: ["File", "Edit", "Selection", "View", "Run", "Terminal"],
    openCommand: {
      id: "app.openOrion",
      label: "Open Orion (code editor)",
      hotkey: "mod+2",
      keywords: ["editor", "code", "ide"],
    },
  },
  {
    id: "xdesign",
    name: "XDesign",
    order: 30,
    renderer: {
      kind: "trusted-react",
      component: lazy(() =>
        import("@/apps/xdesign/XDesignApp").then((module) => ({ default: module.XDesignApp })),
      ),
    },
    window: {
      title: "XDESIGN",
      subtitle: "untitled frame",
      defaultSize: { w: 1180, h: 760 },
    },
    dock: {
      Icon: Palette,
      background: "linear-gradient(135deg, rgba(255,62,165,0.4), rgba(255,62,165,0.05))",
      glow: "0 0 14px -2px rgba(255,62,165,0.4)",
      foreground: "#1b0613",
    },
    spotlight: { description: "design studio" },
    accent: "var(--neon-magenta)",
    menuNames: ["File", "Edit", "Object", "Type", "Effect", "View"],
    openCommand: {
      id: "app.openXDesign",
      label: "Open XDesign",
      hotkey: "mod+3",
      keywords: ["design", "canvas", "figma"],
    },
  },
  {
    id: "command",
    name: "Command Center",
    order: 40,
    renderer: {
      kind: "trusted-react",
      component: lazy(() =>
        import("@/apps/command/CommandCenterApp").then((module) => ({
          default: module.CommandCenterApp,
        })),
      ),
    },
    window: {
      title: "COMMAND CENTER",
      subtitle: "the org",
      defaultSize: { w: 1280, h: 820 },
    },
    dock: {
      Icon: Radar,
      background: "linear-gradient(135deg, rgba(255,194,75,0.42), rgba(255,194,75,0.05))",
      glow: "0 0 14px -2px rgba(255,194,75,0.45)",
      foreground: "#1c1303",
    },
    spotlight: { description: "agent organization" },
    accent: "var(--neon-yellow)",
    menuNames: ["File", "Edit", "View", "Window"],
    openCommand: {
      id: "app.openCommandCenter",
      label: "Open Command Center",
      keywords: ["command", "organization", "agents", "wiki"],
    },
  },
  {
    id: "hermes",
    name: "Hermes",
    order: 50,
    renderer: {
      kind: "trusted-react",
      component: lazy(() =>
        import("@/apps/hermes/HermesApp").then((module) => ({ default: module.HermesApp })),
      ),
    },
    window: {
      title: "HERMES",
      subtitle: "agent board",
      defaultSize: { w: 1760, h: 1080 },
    },
    dock: {
      Icon: Workflow,
      background: "linear-gradient(135deg, rgba(255,138,61,0.42), rgba(255,138,61,0.05))",
      glow: "0 0 14px -2px rgba(255,138,61,0.45)",
      foreground: "#1c0e03",
    },
    spotlight: { description: "agent orchestration board" },
    accent: "var(--neon-violet)",
    menuNames: ["Board", "Task", "Agents", "View"],
    openCommand: {
      id: "app.openHermes",
      label: "Open Hermes",
      keywords: ["hermes", "agents", "orchestration", "board"],
    },
  },
];

function pluginFor(descriptor: AppDescriptor): InternalPlugin {
  const pluginId = BUILTIN_APP_PLUGIN_IDS[descriptor.id as keyof typeof BUILTIN_APP_PLUGIN_IDS];
  return {
    id: pluginId,
    activate: ({ pluginId: ownerId, subscriptions }) => {
      subscriptions.add(appRegistry.register(ownerId, descriptor));
      const command: Command = {
        ...descriptor.openCommand,
        group: "View",
        run: () => {
          useShell.getState().openApp(descriptor.id);
        },
      };
      subscriptions.add(registry.register(command, ownerId));
    },
  };
}

export function ensureBuiltinAppPlugins(): void {
  for (const descriptor of apps) {
    const plugin = pluginFor(descriptor);
    if (!internalPluginHost.isActive(plugin.id)) internalPluginHost.activate(plugin);
  }
}

export function deactivateBuiltinAppPlugin(pluginId: string): readonly unknown[] {
  return internalPluginHost.deactivate(pluginId);
}

export function activateBuiltinAppPlugin(appId: keyof typeof BUILTIN_APP_PLUGIN_IDS): void {
  const descriptor = apps.find((app) => app.id === appId);
  if (!descriptor) throw new Error(`unknown built-in app: ${appId}`);
  const plugin = pluginFor(descriptor);
  if (!internalPluginHost.isActive(plugin.id)) internalPluginHost.activate(plugin);
}

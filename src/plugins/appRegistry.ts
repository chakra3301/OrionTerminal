import { useSyncExternalStore, type ComponentType, type LazyExoticComponent } from "react";
import type { LucideIcon } from "lucide-react";
import { OwnerRegistry } from "@/plugins/ownerRegistry";

export type AppId = string;

export type TrustedReactRenderer = {
  kind: "trusted-react";
  component: LazyExoticComponent<ComponentType>;
};

export type SandboxedPluginRenderer = {
  kind: "sandboxed-plugin";
  pluginId: string;
  contributionId: string;
};

export type AppDescriptor = {
  id: AppId;
  name: string;
  order: number;
  renderer: TrustedReactRenderer | SandboxedPluginRenderer;
  window: {
    title: string;
    subtitle: string;
    defaultSize: { w: number; h: number };
  };
  dock: {
    Icon: LucideIcon;
    background: string;
    glow: string;
    foreground: string;
  };
  spotlight: {
    description: string;
  };
  accent: string;
  menuNames: readonly string[];
  openCommand: {
    id: string;
    label: string;
    hotkey?: string;
    keywords?: string[];
  };
};

export const appRegistry = new OwnerRegistry<AppDescriptor>(
  "app contribution",
  (a, b) => a.order - b.order || a.id.localeCompare(b.id),
);

export function useAppDescriptors(): readonly AppDescriptor[] {
  return useSyncExternalStore(
    (listener) => appRegistry.subscribe(listener),
    () => appRegistry.list(),
    () => appRegistry.list(),
  );
}

export function appName(id: AppId): string {
  return appRegistry.get(id)?.name ?? id;
}

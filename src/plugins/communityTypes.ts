import type { PluginManifestV1 } from "@/plugins/manifest";

export type InstalledCommunityPlugin = {
  manifest: PluginManifestV1;
  enabled: boolean;
  grantedPermissions: string[];
  fingerprint: string;
  installedAt: number;
  quarantined: boolean;
  quarantineReason: string | null;
  workspaceHandles: CommunityWorkspaceHandle[];
};

export type CommunityPluginInspection = {
  manifest: PluginManifestV1;
  fingerprint: string;
  fileCount: number;
  totalBytes: number;
};

export type CommunityPluginEntrypoint = {
  kind: "ui" | "background";
  content: string;
};

export type CommunityWorkspaceHandle = {
  id: string;
  label: string;
  read: boolean;
  write: boolean;
};

export type CommunityPluginSafeMode = {
  active: boolean;
  pluginIds: string[];
  reason: string | null;
};

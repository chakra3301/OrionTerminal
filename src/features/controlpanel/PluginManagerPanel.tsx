import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Blocks,
  Check,
  FolderKey,
  FolderPlus,
  Loader2,
  LockKeyhole,
  PackageCheck,
  Power,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import { confirmAction } from "@/components/ConfirmModal";
import { ipc } from "@/lib/ipc";
import {
  BUILTIN_APP_PLUGIN_CATALOG,
  builtinAppDescriptor,
} from "@/plugins/builtinApps";
import { validatePluginManifest } from "@/plugins/manifest";
import { useCommunityPlugins } from "@/store/communityPluginStore";
import { usePluginManager } from "@/store/pluginManagerStore";

const ACCENT_RGB: Record<string, string> = {
  archives: "var(--neon-green-rgb)",
  orion: "var(--neon-cyan-rgb)",
  xdesign: "var(--neon-magenta-rgb)",
  command: "var(--neon-yellow-rgb)",
  hermes: "255, 138, 61",
};

const PERMISSION_LABELS: Record<string, string> = {
  "storage.plugin": "Private plugin storage",
  "workspace.read": "Read approved workspaces",
  "workspace.write": "Write approved workspaces",
  "workspace.watch": "Watch approved workspaces",
  "clipboard.read": "Read clipboard",
  "clipboard.write": "Write clipboard",
  notifications: "Show notifications",
  "ai.chat": "Use brokered AI chat",
  "ai.tools.register": "Register AI tools",
  "process.git": "Run brokered Git operations",
  "terminal.send": "Send to an approved terminal",
  "assets.read": "Read Orion assets",
  "assets.write": "Create Orion assets",
};

function permissionLabel(permission: string): string {
  return permission.startsWith("network:")
    ? `Network · ${permission.slice("network:".length)}`
    : (PERMISSION_LABELS[permission] ?? permission);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function PluginManagerPanel() {
  const disabledIds = usePluginManager((state) => state.disabledIds);
  const builtinBusyIds = usePluginManager((state) => state.busyIds);
  const builtinError = usePluginManager((state) => state.error);
  const setBuiltinEnabled = usePluginManager((state) => state.setEnabled);
  const clearBuiltinError = usePluginManager((state) => state.clearError);

  const installed = useCommunityPlugins((state) => state.installed);
  const communityBusyIds = useCommunityPlugins((state) => state.busyIds);
  const communityError = useCommunityPlugins((state) => state.error);
  const activationIssues = useCommunityPlugins((state) => state.activationIssues);
  const safeMode = useCommunityPlugins((state) => state.safeMode);
  const installCommunity = useCommunityPlugins((state) => state.install);
  const setCommunityEnabled = useCommunityPlugins((state) => state.setEnabled);
  const removeCommunity = useCommunityPlugins((state) => state.remove);
  const refreshCommunityResources = useCommunityPlugins((state) => state.refreshResources);
  const revokeCommunityWorkspace = useCommunityPlugins((state) => state.revokeWorkspace);
  const clearSafeMode = useCommunityPlugins((state) => state.clearSafeMode);
  const clearCommunityError = useCommunityPlugins((state) => state.clearError);
  const [inspecting, setInspecting] = useState(false);

  useEffect(() => {
    if (installed.length > 0) void refreshCommunityResources();
  }, [installed.length, refreshCommunityResources]);

  const builtinEnabled = BUILTIN_APP_PLUGIN_CATALOG.length - disabledIds.length;
  const communityEnabled = installed.filter((plugin) => plugin.enabled && !plugin.quarantined).length;
  const enabledCount = builtinEnabled + communityEnabled;
  const totalCount = BUILTIN_APP_PLUGIN_CATALOG.length + installed.length;

  const toggleBuiltin = async (pluginId: string, name: string, enabled: boolean) => {
    if (enabled) {
      const approved = await confirmAction({
        title: `Disable ${name}?`,
        body: "Its window and owned commands will close immediately. Plugin data stays on disk and is restored when you enable it again.",
        confirmLabel: "Disable plugin",
        danger: true,
      });
      if (!approved) return;
    }
    await setBuiltinEnabled(pluginId, !enabled);
  };

  const inspectAndInstall = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose an .orion-plugin package folder",
    });
    if (typeof selected !== "string") return;
    setInspecting(true);
    clearCommunityError();
    try {
      const inspection = await ipc.pluginInspectDirectory(selected);
      const validation = validatePluginManifest(inspection.manifest);
      if (!validation.ok) throw new Error(validation.issues.join("\n"));
      const current = installed.find((plugin) => plugin.manifest.id === validation.manifest.id);
      const addedPermissions = validation.manifest.permissions.filter(
        (permission) => !current?.grantedPermissions.includes(permission),
      );
      const permissionCopy = validation.manifest.permissions.length > 0
        ? validation.manifest.permissions.map((permission) => `• ${permissionLabel(permission)}`).join("\n")
        : "• No privileged capabilities requested";
      const approved = await confirmAction({
        title: `${current ? "Update" : "Install"} ${validation.manifest.name}?`,
        body: [
          `${validation.manifest.publisher} · v${validation.manifest.version} · ${inspection.fileCount} files · ${formatBytes(inspection.totalBytes)}`,
          "",
          "Requested capabilities:",
          permissionCopy,
          ...(current && addedPermissions.length > 0
            ? ["", `New in this update: ${addedPermissions.map(permissionLabel).join(", ")}`]
            : []),
          "",
          "Community code runs in an opaque sandbox. Every privileged request is checked again by the native broker.",
        ].join("\n"),
        confirmLabel: current ? "Approve update" : "Install plugin",
      });
      if (!approved) return;
      await installCommunity(selected, { ...inspection, manifest: validation.manifest });
    } catch (error) {
      useCommunityPlugins.setState({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setInspecting(false);
    }
  };

  const toggleCommunity = async (pluginId: string, name: string, enabled: boolean) => {
    if (enabled) {
      const approved = await confirmAction({
        title: `Disable ${name}?`,
        body: "Its sandbox, windows, commands, and background runtime will stop immediately. Private plugin storage stays on disk.",
        confirmLabel: "Disable plugin",
        danger: true,
      });
      if (!approved) return;
    }
    await setCommunityEnabled(pluginId, !enabled);
  };

  const uninstall = async (pluginId: string, name: string) => {
    const approved = await confirmAction({
      title: `Remove ${name}?`,
      body: "The installed package will be removed. Namespaced plugin data is deliberately retained so reinstalling can restore it.",
      confirmLabel: "Remove package",
      danger: true,
    });
    if (approved) await removeCommunity(pluginId);
  };

  const revokeWorkspace = async (
    pluginId: string,
    pluginName: string,
    handle: string,
    label: string,
  ) => {
    const approved = await confirmAction({
      title: `Revoke ${label}?`,
      body: `${pluginName} will immediately lose access to this workspace. The folder and its files will not be changed. Access can only be restored through another folder-picker gesture.`,
      confirmLabel: "Revoke access",
      danger: true,
    });
    if (approved) await revokeCommunityWorkspace(pluginId, handle);
  };

  const retrySafeMode = async () => {
    const approved = await confirmAction({
      title: "Try community plugins again?",
      body: "Safe mode will end and enabled community plugins will activate. If startup fails again, Orion will return to safe mode on the next launch.",
      confirmLabel: "Exit safe mode",
    });
    if (approved) await clearSafeMode();
  };

  const visibleError = communityError ?? builtinError;
  const dismissError = communityError ? clearCommunityError : clearBuiltinError;

  return (
    <div className="pm-shell">
      <section className="pm-hero">
        <div className="pm-hero-sigil" aria-hidden>
          <PackageCheck size={28} strokeWidth={1.35} />
          <span />
        </div>
        <div className="pm-hero-copy">
          <div className="cp-eyebrow">Capability rack</div>
          <h2>One terminal. Your loadout.</h2>
          <p>
            Built-ins and local packages share one lifecycle. Community code stays outside
            shell authority and reaches the host only through explicit grants.
          </p>
        </div>
        <div className="pm-meter" aria-label={`${enabledCount} of ${totalCount} plugins enabled`}>
          <strong>{String(enabledCount).padStart(2, "0")}</strong>
          <span>/ {String(totalCount).padStart(2, "0")} live</span>
        </div>
      </section>

      <div className="pm-trustline">
        <span><ShieldCheck size={12} /> Native capability broker</span>
        <span>Opaque-origin UI</span>
        <span>API v1</span>
        <span>Data preserved on disable</span>
      </div>

      {safeMode.active && (
        <div className="pm-safe-mode" role="alert">
          <div><ShieldOff size={18} /></div>
          <span>
            <strong>Community safe mode</strong>
            {safeMode.reason ?? "Community plugins were held back after an incomplete startup."}
          </span>
          <button type="button" onClick={() => void retrySafeMode()}>
            <RotateCcw size={12} /> Try again
          </button>
        </div>
      )}

      {visibleError && (
        <div className="pm-error" role="alert">
          <span>{visibleError}</span>
          <button type="button" onClick={dismissError}>Dismiss</button>
        </div>
      )}

      <div className="cp-eyebrow">
        Built-in app plugins <span className="cp-count">{BUILTIN_APP_PLUGIN_CATALOG.length}</span>
      </div>
      <div className="pm-grid">
        {BUILTIN_APP_PLUGIN_CATALOG.map((plugin) => {
          const descriptor = builtinAppDescriptor(plugin.appId)!;
          const Icon = descriptor.dock.Icon;
          const enabled = !disabledIds.includes(plugin.pluginId);
          const busy = builtinBusyIds.includes(plugin.pluginId);
          const locked = !plugin.disableable;
          return (
            <article
              key={plugin.pluginId}
              className={`pm-card${enabled ? " live" : " disabled"}${locked ? " locked" : ""}`}
              style={{ ["--acc-rgb" as string]: ACCENT_RGB[plugin.appId] }}
            >
              <div className="pm-card-top">
                <div className="pm-icon" aria-hidden><Icon size={20} strokeWidth={1.7} /></div>
                <div className="pm-identity">
                  <h3>{descriptor.name}</h3>
                  <code>{plugin.pluginId}</code>
                </div>
                <span className={`pm-state ${enabled ? "live" : "off"}`}>
                  {enabled ? <Check size={10} /> : <Power size={10} />}
                  {enabled ? "Active" : "Disabled"}
                </span>
              </div>
              <p className="pm-description">{plugin.description}</p>
              <div className="pm-capabilities">
                {plugin.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
              </div>
              <footer className="pm-card-foot">
                <div><span>Built in</span><span>v{plugin.version}</span><span>Trusted React</span></div>
                <button
                  type="button"
                  className={`pm-switch${enabled ? " on" : ""}`}
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${enabled ? "Disable" : "Enable"} ${descriptor.name}`}
                  disabled={busy || locked}
                  onClick={() => void toggleBuiltin(plugin.pluginId, descriptor.name, enabled)}
                >
                  {busy ? <Loader2 size={12} className="pm-spin" /> : locked ? <LockKeyhole size={11} /> : <span />}
                </button>
              </footer>
            </article>
          );
        })}
      </div>

      <div className="pm-community-heading">
        <div>
          <div className="cp-eyebrow">Community sandbox <span className="cp-count">{installed.length}</span></div>
          <p>Install a validated local package folder. No plugin receives Tauri, SQLite, secrets, or shell DOM access.</p>
        </div>
        <button type="button" className="pm-install" disabled={inspecting} onClick={() => void inspectAndInstall()}>
          {inspecting ? <Loader2 size={13} className="pm-spin" /> : <FolderPlus size={13} />}
          {inspecting ? "Inspecting…" : "Install package"}
        </button>
      </div>

      {installed.length === 0 ? (
        <div className="pm-empty">
          <Blocks size={26} />
          <strong>No community packages installed</strong>
          <span>Start with <code>examples/plugins/hello-orion.orion-plugin</code>.</span>
        </div>
      ) : (
        <div className="pm-grid">
          {installed.map((plugin) => {
            const enabled = plugin.enabled && !plugin.quarantined;
            const busy = communityBusyIds.includes(plugin.manifest.id);
            const issue = plugin.quarantineReason ?? activationIssues[plugin.manifest.id];
            const held = Boolean(issue) || safeMode.active;
            const live = enabled && !held;
            return (
              <article
                key={plugin.manifest.id}
                className={`pm-card community${live ? " live" : " disabled"}${held ? " warned" : ""}`}
                style={{ ["--acc-rgb" as string]: "var(--neon-violet-rgb)" }}
              >
                <div className="pm-card-top">
                  <div className="pm-icon" aria-hidden><Blocks size={20} strokeWidth={1.6} /></div>
                  <div className="pm-identity">
                    <h3>{plugin.manifest.name}</h3>
                    <code>{plugin.manifest.id}</code>
                  </div>
                  <span className={`pm-state ${live ? "live" : held ? "warn" : "off"}`}>
                    {held ? <AlertTriangle size={10} /> : live ? <Check size={10} /> : <Power size={10} />}
                    {held ? "Held" : live ? "Active" : "Disabled"}
                  </span>
                </div>
                <p className="pm-description">
                  {plugin.manifest.publisher} · API {plugin.manifest.apiVersion} · opaque sandbox
                </p>
                <div className="pm-capabilities">
                  {plugin.grantedPermissions.length > 0
                    ? plugin.grantedPermissions.slice(0, 5).map((permission) => (
                        <span key={permission}>{permissionLabel(permission)}</span>
                      ))
                    : <span>No grants</span>}
                </div>
                {plugin.workspaceHandles.length > 0 && (
                  <div className="pm-resource-grants">
                    <div className="pm-resource-title"><FolderKey size={11} /> Approved workspaces</div>
                    {plugin.workspaceHandles.map((workspace) => (
                      <div className="pm-resource-row" key={workspace.id}>
                        <span>
                          <strong>{workspace.label}</strong>
                          <small>{workspace.write ? "Read + write" : "Read only"}</small>
                        </span>
                        <button
                          type="button"
                          title={`Revoke access to ${workspace.label}`}
                          aria-label={`Revoke ${plugin.manifest.name} access to ${workspace.label}`}
                          disabled={busy}
                          onClick={() => void revokeWorkspace(
                            plugin.manifest.id,
                            plugin.manifest.name,
                            workspace.id,
                            workspace.label,
                          )}
                        ><X size={11} /></button>
                      </div>
                    ))}
                  </div>
                )}
                {issue && <div className="pm-plugin-issue">{issue}</div>}
                <footer className="pm-card-foot">
                  <div><span>Local</span><span>v{plugin.manifest.version}</span><span>{plugin.manifest.publisher}</span></div>
                  <div className="pm-card-actions">
                    <button
                      type="button"
                      className="pm-remove"
                      title={`Remove ${plugin.manifest.name}`}
                      disabled={busy}
                      onClick={() => void uninstall(plugin.manifest.id, plugin.manifest.name)}
                    ><Trash2 size={12} /></button>
                    <button
                      type="button"
                      className={`pm-switch${enabled ? " on" : ""}`}
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.manifest.name}`}
                      disabled={busy || safeMode.active}
                      onClick={() => void toggleCommunity(plugin.manifest.id, plugin.manifest.name, enabled)}
                    >{busy ? <Loader2 size={12} className="pm-spin" /> : <span />}</button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <div className="pm-footnote">
        <LockKeyhole size={12} /> Package code and namespaced data are removed separately. Archive signing,
        publisher identity, and marketplace updates remain locked for distribution hardening.
      </div>
    </div>
  );
}

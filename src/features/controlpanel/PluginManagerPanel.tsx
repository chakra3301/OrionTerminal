import { Check, Loader2, LockKeyhole, PackageCheck, Power, ShieldCheck } from "lucide-react";
import { confirmAction } from "@/components/ConfirmModal";
import {
  BUILTIN_APP_PLUGIN_CATALOG,
  builtinAppDescriptor,
} from "@/plugins/builtinApps";
import { usePluginManager } from "@/store/pluginManagerStore";

const ACCENT_RGB: Record<string, string> = {
  archives: "var(--neon-green-rgb)",
  orion: "var(--neon-cyan-rgb)",
  xdesign: "var(--neon-magenta-rgb)",
  command: "var(--neon-yellow-rgb)",
  hermes: "255, 138, 61",
};

export function PluginManagerPanel() {
  const disabledIds = usePluginManager((state) => state.disabledIds);
  const busyIds = usePluginManager((state) => state.busyIds);
  const error = usePluginManager((state) => state.error);
  const setEnabled = usePluginManager((state) => state.setEnabled);
  const clearError = usePluginManager((state) => state.clearError);
  const enabledCount = BUILTIN_APP_PLUGIN_CATALOG.length - disabledIds.length;

  const toggle = async (pluginId: string, name: string, enabled: boolean) => {
    if (enabled) {
      const approved = await confirmAction({
        title: `Disable ${name}?`,
        body: "Its window and owned commands will close immediately. Plugin data stays on disk and is restored when you enable it again.",
        confirmLabel: "Disable plugin",
        danger: true,
      });
      if (!approved) return;
    }
    await setEnabled(pluginId, !enabled);
  };

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
            Enable only the capabilities you use. Disabled plugins leave the shell,
            commands, Dock, and Spotlight while their data remains untouched.
          </p>
        </div>
        <div className="pm-meter" aria-label={`${enabledCount} of ${BUILTIN_APP_PLUGIN_CATALOG.length} plugins enabled`}>
          <strong>{String(enabledCount).padStart(2, "0")}</strong>
          <span>/ {String(BUILTIN_APP_PLUGIN_CATALOG.length).padStart(2, "0")} live</span>
        </div>
      </section>

      <div className="pm-trustline">
        <span><ShieldCheck size={12} /> Orion signed</span>
        <span>API v1</span>
        <span>Data preserved on disable</span>
      </div>

      {error && (
        <div className="pm-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={clearError}>Dismiss</button>
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
          const busy = busyIds.includes(plugin.pluginId);
          const locked = !plugin.disableable;
          return (
            <article
              key={plugin.pluginId}
              className={`pm-card${enabled ? " live" : " disabled"}${locked ? " locked" : ""}`}
              style={{ ["--acc-rgb" as string]: ACCENT_RGB[plugin.appId] }}
            >
              <div className="pm-card-top">
                <div className="pm-icon" aria-hidden>
                  <Icon size={20} strokeWidth={1.7} />
                </div>
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
                {plugin.capabilities.map((capability) => (
                  <span key={capability}>{capability}</span>
                ))}
              </div>

              <footer className="pm-card-foot">
                <div>
                  <span>Built in</span>
                  <span>v{plugin.version}</span>
                  <span>Trusted React</span>
                </div>
                <button
                  type="button"
                  className={`pm-switch${enabled ? " on" : ""}`}
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${enabled ? "Disable" : "Enable"} ${descriptor.name}`}
                  title={locked ? "Locked until its remaining private contributions migrate" : undefined}
                  disabled={busy || locked}
                  onClick={() => void toggle(plugin.pluginId, descriptor.name, enabled)}
                >
                  {busy ? <Loader2 size={12} className="pm-spin" /> : locked ? <LockKeyhole size={11} /> : <span />}
                </button>
              </footer>

              {locked && (
                <div className="pm-migration-note">
                  Compatibility locked · contribution migration in progress
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="pm-footnote">
        <LockKeyhole size={12} /> Community package installation remains locked until the
        capability broker and safe mode are complete.
      </div>
    </div>
  );
}

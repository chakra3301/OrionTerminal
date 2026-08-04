import { SandboxPluginFrame } from "@/plugins/SandboxPluginFrame";
import { useActiveCommunityPlugins } from "@/plugins/communityRuntime";

export function CommunityPluginRuntimeHost() {
  const plugins = useActiveCommunityPlugins();
  return (
    <div className="plugin-background-host" aria-hidden>
      {plugins
        .filter((plugin) =>
          Boolean(plugin.manifest.entrypoints?.background) &&
          (plugin.manifest.activationEvents ?? []).includes("onStartup"),
        )
        .map((plugin) => (
          <SandboxPluginFrame
            key={plugin.manifest.id}
            pluginId={plugin.manifest.id}
            kind="background"
          />
        ))}
    </div>
  );
}

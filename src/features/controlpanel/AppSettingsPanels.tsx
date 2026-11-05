import { useEffect, useState } from "react";
import type { Provider } from "@/features/agents/agentTypes";
import { useTerminalStore } from "@/store/terminalStore";
import { defaultImageModelForProvider } from "@/apps/xdesign/imageGen";
import { resolveImageProvider } from "@/apps/xdesign/imageProviderRuntime";
import { useProvidersStore } from "@/store/providersStore";
import { AppEditor, ACCENT_RGB } from "./AppEditor";
export { ArchivesSettings } from "./ArchivesSettings";

// ── Orion (editor) ──────────────────────────────────────────────────────────

export function OrionSettings() {
  const termOpen = useTerminalStore((s) => s.open);
  const termHeight = useTerminalStore((s) => s.height);
  return (
    <div>
      <AppEditor app="orion" surface="orion" />
      <div className="cp-eyebrow">Workspace</div>
      <div className="cp-list">
        <div className="cp-card" style={{ ["--acc-rgb" as string]: ACCENT_RGB.orion }}>
          <div className="cp-card-main">
            <div className="cp-card-title">Integrated terminal</div>
            <div className="cp-card-sub">
              {termOpen ? "open" : "hidden"} · panel height {termHeight}%
            </div>
          </div>
          <span className={`cp-badge ${termOpen ? "live" : "wait"}`}>{termOpen ? "open" : "hidden"}</span>
        </div>
      </div>
    </div>
  );
}

// ── XDesign ─────────────────────────────────────────────────────────────────

export function XDesignSettings() {
  const providers = useProvidersStore((s) => s.providers);
  const [imageProvider, setImageProvider] = useState<Provider | null>(null);
  const [imageChecked, setImageChecked] = useState(false);

  useEffect(() => {
    let active = true;
    void resolveImageProvider(providers).then((provider) => {
      if (active) {
        setImageProvider(provider);
        setImageChecked(true);
      }
    });
    return () => { active = false; };
  }, [providers]);

  return (
    <div>
      <AppEditor app="xdesign" surface="xdesign" />

      <div className="cp-eyebrow">Image generation</div>
      <div className="cp-list">
        <div className="cp-card" style={{ ["--acc-rgb" as string]: ACCENT_RGB.xdesign }}>
          <div className="cp-card-main">
            <div className="cp-card-title">Raster image model</div>
            <div className="cp-card-sub">
              {imageProvider
                ? `${imageProvider.name} · ${defaultImageModelForProvider(imageProvider)}`
                : imageChecked
                  ? "Connect ChatGPT or add an image-capable provider"
                  : "Checking provider readiness…"}
            </div>
          </div>
          <span className={`cp-badge ${imageProvider ? "live" : "wait"}`}>
            {imageProvider ? "ready" : imageChecked ? "none" : "checking"}
          </span>
        </div>
      </div>
    </div>
  );
}

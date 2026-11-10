import { useEffect, useRef } from "react";
import { capturePluginAppearance, type PluginAppearance, type PluginSkin } from "./pluginAppearance";
import { usePluginAppearance } from "@/store/pluginAppearanceStore";

type Props = {
  pluginId: string;
  skin: PluginSkin;
  publish: (snapshot: PluginAppearance) => void;
  register: (refresh: (() => void) | null) => void;
};
export function PluginAppearanceControls({ pluginId, skin, publish, register }: Props) {
  const prefs = usePluginAppearance();
  const mode = Object.hasOwn(prefs.modes, pluginId) ? prefs.modes[pluginId] : "orion";
  const modeRef = useRef(mode); modeRef.current = mode;
  useEffect(() => { void usePluginAppearance.getState().load(); }, []);
  useEffect(() => {
    let disposed = false, queued = 0;
    const refresh = () => { if (!disposed) publish(capturePluginAppearance(modeRef.current)); };
    const schedule = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; refresh(); }); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme", "data-color-mode", "data-custom-surface"] });
    const media = ["(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)"].map(q => window.matchMedia?.(q)).filter(Boolean);
    media.forEach(m => m?.addEventListener("change", schedule));
    register(refresh); refresh();
    return () => { disposed = true; register(null); observer.disconnect(); media.forEach(m => m?.removeEventListener("change", schedule)); if (queued) cancelAnimationFrame(queued); };
  }, [publish, register]);
  useEffect(() => { publish(capturePluginAppearance(mode)); }, [mode, publish]);
  return <div className="plugin-appearance-controls">
    <span title={skin === "2048" ? "Appearance v1 · 2048 chrome, board, overlays, storage feedback and notices. Game code unchanged." : "Appearance v1 · explicitly mapped UI roles only. Document and canvas contents are not restyled."}>Appearance</span>
    <div role="group" aria-label="Imported app styling">
      {(["orion", "original"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value}
        disabled={!prefs.loaded || prefs.busy} onClick={() => void prefs.change(pluginId, value)}>{value === "orion" ? "Orion" : "Original"}</button>)}
    </div>
    {prefs.error && <span className="plugin-appearance-error" role="alert">{prefs.error}
      {!prefs.loaded && <button type="button" onClick={() => void prefs.load()}>Retry</button>}</span>}
  </div>;
}

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createInstance, destroyInstance, isMetalFxSupported, redrawInstance, setSharedPreset, setSharedPresetMode, updateInstance, type MetalFxInstance } from "metal-fx";
import type { ThemeExtras } from "@/store/themeExtrasStore";
import { keepMetalRendererWarm } from "./metalRuntime";
import { metalMaterial } from "./metalMaterials";
import { isLightTheme, useThemeStore } from "@/store/themeStore";

export function MetalBorder({ settings, active, radius }: { settings: ThemeExtras; active: boolean; radius: number }) {
  const mode = useThemeStore(s => isLightTheme(s.theme) ? "light" : "dark");
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const instance = useRef<MetalFxInstance | null>(null);
  const latest = useRef({ active, radius, strength: settings.strength });
  latest.current = { active, radius, strength: settings.strength };
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    const element = root.current, surface = canvas.current;
    if (failed || !element || !surface) return;
    let resolution: MediaQueryList | undefined;
    const initialize = () => {
      if (instance.current) { destroyInstance(instance.current); instance.current = null; }
      try {
        if (!isMetalFxSupported()) { setFailed(true); return; }
        // Configure the shared shader BEFORE its first frame. The convenience
        // wrapper does this in a passive effect, which can freeze the old palette.
        setSharedPreset(settings.metalPreset, mode);
        setSharedPresetMode(metalMaterial(settings.metalPreset, mode));
        keepMetalRendererWarm();
        const current = latest.current;
        instance.current = createInstance({
          hostCanvas: surface, cssWidth: Math.max(1, element.clientWidth), cssHeight: Math.max(1, element.clientHeight),
          cornerRadius: current.radius, kind: "pill", ringCssPx: 1.75, shaderScale: 1.6,
          opacityMul: current.strength, glowGain: 0, paused: !current.active,
        });
      } catch { setFailed(true); }
    };
    const resize = () => {
      const current = instance.current;
      if (!current) return;
      const width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight);
      if (width === current.cssWidth && height === current.cssHeight) return;
      updateInstance(current, { cssWidth: width, cssHeight: height });
      if (current.everCopied) redrawInstance(surface);
    };
    const pixelRatioChanged = () => { initialize(); watchResolution(); };
    const watchResolution = () => {
      resolution?.removeEventListener("change", pixelRatioChanged);
      resolution = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolution?.addEventListener("change", pixelRatioChanged);
    };
    initialize(); watchResolution();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(element);
    return () => {
      observer?.disconnect(); resolution?.removeEventListener("change", pixelRatioChanged);
      if (instance.current) { destroyInstance(instance.current); instance.current = null; }
    };
  }, [failed, settings.metalPreset, mode]);

  useLayoutEffect(() => {
    const current = instance.current;
    if (!current) return;
    updateInstance(current, { paused: !active, opacityMul: settings.strength, cornerRadius: radius });
    // A frozen texture survives opacity/radius/size changes. Re-composite it;
    // never snapshot an uninitialized shader or remount a canvas to change alpha.
    if (current.everCopied) redrawInstance(current.canvas);
  }, [active, radius, settings.strength, settings.metalPreset]);

  return <div ref={root} className={`ot-border-effect ot-metal-border ${failed ? "metal-fx-fallback" : "metal-fx-root"}`}
    data-preset={settings.metalPreset} data-paused={!active}
    style={{ borderRadius: radius, "--ot-border-strength": settings.strength } as CSSProperties}>
    {!failed && <canvas ref={canvas} className="metal-fx-canvas" />}
  </div>;
}

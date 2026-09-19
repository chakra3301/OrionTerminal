import { Component, lazy, Suspense, type ReactNode } from "react";
import { useThemeStore } from "@/store/themeStore";
import { DEFAULT_THEME_EXTRAS, useThemeExtras, type ThemeExtras } from "@/store/themeExtrasStore";
import { log } from "@/lib/log";
import { useVisualActivity } from "./useVisualActivity";
import { useBorderGeometry } from "./useBorderGeometry";
import { BorderStill } from "./BorderStill";
import "./effects.css";

const BorderEffect = lazy(() => import("./BorderEffect"));
class EffectBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { log.warn("Decorative border unavailable; keeping native border", error); }
  override render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function BorderLayer({ settings, active, theme }: { settings: ThemeExtras; active: boolean; theme: string }) {
  const { ref, active: moving } = useVisualActivity<HTMLDivElement>(active && settings.animate);
  const geometry = useBorderGeometry(ref, theme);
  const radius = geometry?.radius ?? 0;
  const fallback = <BorderStill settings={settings} radius={radius} />;
  return <div ref={ref} className="ot-themed-border" aria-hidden="true" inert data-no-drag
    style={geometry && { top: geometry.top, right: geometry.right, bottom: geometry.bottom, left: geometry.left, borderRadius: radius }}
    data-border={settings.border} data-palette={settings.border === "beam" ? settings.beamPalette : undefined}
    data-finish={settings.border === "metal" ? settings.metalPreset : undefined} data-shape={settings.border === "beam" ? settings.beamSize : undefined}>
    {geometry && <EffectBoundary key={`${theme}:${settings.border}`} fallback={fallback}>
      <Suspense fallback={fallback}><BorderEffect settings={settings} active={moving} radius={radius} /></Suspense>
    </EffectBoundary>}
  </div>;
}

// A decorative sibling, never a wrapper around live editors: switching effects
// must not remount application state or change window/flex layout.
export function ThemeBorder({ active = true, preview }: { active?: boolean; preview?: ThemeExtras }) {
  const theme = useThemeStore((s) => s.theme);
  const saved = useThemeExtras((s) => s.themes[theme]);
  const settings = preview ?? saved ?? DEFAULT_THEME_EXTRAS;
  if (settings.border === "default" || settings.strength === 0) return null;
  return <BorderLayer settings={settings} active={active} theme={theme} />;
}

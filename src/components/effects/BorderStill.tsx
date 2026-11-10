import type { ThemeExtras } from "@/store/themeExtrasStore";

export function BorderStill({ settings, radius }: { settings: ThemeExtras; radius: number }) {
  return <div className="ot-border-effect ot-border-still" data-palette={settings.border === "beam" ? settings.beamPalette : undefined}
    data-shape={settings.border === "beam" ? settings.beamSize : undefined}
    style={{ opacity: settings.strength, borderRadius: radius }} />;
}

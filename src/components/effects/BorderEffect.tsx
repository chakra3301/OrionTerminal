import { BorderBeam } from "border-beam";
import type { ThemeExtras } from "@/store/themeExtrasStore";
import { BorderStill } from "./BorderStill";
import { MetalBorder } from "./MetalBorder";
import { isLightTheme, useThemeStore } from "@/store/themeStore";

export default function BorderEffect({ settings, active, radius }: { settings: ThemeExtras; active: boolean; radius: number }) {
  const light = useThemeStore(s => isLightTheme(s.theme));
  if (settings.border === "beam" && !active) return <BorderStill settings={settings} radius={radius} />;
  if (settings.border === "beam") return <BorderBeam className="ot-border-effect" size={settings.beamSize} colorVariant={settings.beamPalette}
    theme={light ? "light" : "dark"} strength={settings.strength} brightness={1.3} borderRadius={radius} active duration={5}>
    <div className="ot-border-effect-host" />
  </BorderBeam>;
  if (settings.border === "metal") return <MetalBorder settings={settings} active={active} radius={radius} />;
  return null;
}

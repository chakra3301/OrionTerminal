import { RotateCcw, Check } from "lucide-react";
import { ThemeBorder } from "@/components/effects/ThemeBorder";
import { OrionOrb } from "@/components/effects/OrionOrb";
import { THEMES, customThemeFor, useThemeStore } from "@/store/themeStore";
import { BEAM_PALETTES, BEAM_SIZES, BORDER_STYLES, DEFAULT_THEME_EXTRAS, METAL_PRESETS, useThemeExtras } from "@/store/themeExtrasStore";
import { SettingsSlider } from "./SettingsSlider";
import "./themeExtras.css";

const styleNames = { default: "Default", beam: "Beam", metal: "Metal" };
const styleDescriptions = { default: "Your theme’s original edge.", beam: "Colored light that travels or breathes along the edge.", metal: "One reflective metal edge. No traveling glow or stacked outlines." };
const sizeNames = { md: "Full border", sm: "Compact", line: "Bottom line", "pulse-inner": "Inner pulse", "pulse-outside": "Outer pulse" };
const capital = (value: string) => value[0]!.toUpperCase() + value.slice(1);

export function ThemeExtrasSection() {
  const theme = useThemeStore(s => s.theme);
  const settings = useThemeExtras(s => s.themes[theme] ?? DEFAULT_THEME_EXTRAS);
  const update = useThemeExtras(s => s.update);
  const reset = useThemeExtras(s => s.reset);
  const saveError = useThemeExtras(s => s.saveError);
  const name = THEMES.find(t => t.id === theme)?.label ?? customThemeFor(theme)?.name ?? theme;
  return <section className="ot-theme-extras" aria-labelledby="theme-extras-title">
    <div className="ot-extras-heading">
      <div><h3 id="theme-extras-title">Surface finish</h3><p>A little more character. Everywhere.</p></div>
      <button type="button" className="ot-extras-reset" onClick={() => reset(theme)} title={`Reset ${name} extras`} aria-label={`Reset ${name} extras`}><RotateCcw size={14} /></button>
    </div>
    <div className="ot-extras-preview" aria-label={`${styleNames[settings.border]} border preview`}>
      <div className="ot-extras-preview-card">
        <ThemeBorder preview={settings} />
        <div className="ot-extras-preview-top"><span>{name}</span><span className="ot-extras-live"><i />Live preview</span></div>
        <div className="ot-extras-preview-core"><OrionOrb size={48} state={settings.animate ? "thinking" : "idle"} /><div><strong>Ready when you are.</strong><span>A space that feels like you.</span></div></div>
        <div className="ot-extras-preview-footer"><span>{styleNames[settings.border]} finish</span><span>{settings.border === "default" ? "Original surface" : `${Math.round(settings.strength * 100)}% intensity`}</span></div>
      </div>
    </div>
    <div className="ot-extras-styles" role="group" aria-label="Border style">
      {BORDER_STYLES.map(style => <button type="button" key={style} aria-pressed={settings.border === style}
        className={`ot-extras-style ${style}${settings.border === style ? " selected" : ""}`} onClick={() => update(theme, { border: style })}>
        <span className="ot-extras-sample" aria-hidden="true" /><span>{styleNames[style]}</span>
      </button>)}
    </div>
    <p className="ot-extras-description">{styleDescriptions[settings.border]}</p>
    {settings.border === "beam" && <>
      <fieldset className="ot-extras-options"><legend>Shape</legend><div className="ot-extras-choices">
        {BEAM_SIZES.map(size => <button type="button" key={size} aria-pressed={settings.beamSize === size} onClick={() => update(theme, { beamSize: size })}>{sizeNames[size]}</button>)}
      </div></fieldset>
      <fieldset className="ot-extras-options"><legend>Palette</legend><div className="ot-extras-choices">
        {BEAM_PALETTES.map(palette => <button type="button" key={palette} aria-pressed={settings.beamPalette === palette} onClick={() => update(theme, { beamPalette: palette })}><i className={`ot-finish-swatch ${palette}`} aria-hidden="true" />{capital(palette)}</button>)}
      </div></fieldset>
    </>}
    {settings.border === "metal" && <fieldset className="ot-extras-options"><legend>Material</legend><div className="ot-extras-choices ot-extras-materials">
      {METAL_PRESETS.map(preset => <button type="button" key={preset} aria-pressed={settings.metalPreset === preset} onClick={() => update(theme, { metalPreset: preset })}><i className={`ot-finish-swatch ${preset}`} aria-hidden="true" />{capital(preset)}{settings.metalPreset === preset && <Check size={11} aria-hidden="true" />}</button>)}
    </div></fieldset>}
    {settings.border !== "default" && <>
      <SettingsSlider label="Border intensity" value={settings.strength} valueText={`${Math.round(settings.strength * 100)}%`} onChange={strength => update(theme, { strength })} />
      <div className="ot-settings-toggle">
        <div className="ot-settings-toggle-meta"><div className="ot-settings-toggle-name">Motion</div><div className="ot-settings-toggle-blurb">A moving highlight, or a quiet, still finish.</div></div>
        <button type="button" className={`ot-switch${settings.animate ? " on" : ""}`} role="switch" aria-checked={settings.animate} aria-label="Animate borders" onClick={() => update(theme, { animate: !settings.animate })} />
      </div>
    </>}
    <p className="ot-extras-help">Customizes {name}. Applies to all app windows, dock, menubar, dialogs, Control Panel, Spotlight and R.O.S.I.E. Reduced motion is respected; Metal uses a static rim if WebGL2 is unavailable.</p>
    {saveError && <p className="ot-settings-msg" role="alert">{saveError}</p>}
  </section>;
}

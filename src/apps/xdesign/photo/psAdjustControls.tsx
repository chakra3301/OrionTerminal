import { useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Pointer } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { GradientPresetSelect } from "./toolBars";
import { useHistogram, type HistogramSource } from "./toneControls";
import { useToneSampler } from "./toneSampler";
import { autoBrightnessContrast, exposureSamplePatch, type ExposureTone } from "./psAdjustMath";
import { usePhotoWorkspace } from "./runtime";
import "./layerStyleDialog.css";

type Settings = Record<string, unknown>;
export type Swatch = { value: string; name: string; color: string };
// Colours mark image content, as the channel curves do, so they are literal rather than theme tokens.
export const MIXER_SWATCHES: Swatch[] = [{ value: "red", name: "Red", color: "#ee2a2a" }, { value: "green", name: "Green", color: "#5af05a" }, { value: "blue", name: "Blue", color: "#1a1aff" }];
export const SELECTIVE_SWATCHES: Swatch[] = [
  { value: "reds", name: "Reds", color: "#ee3a2c" }, { value: "yellows", name: "Yellows", color: "#f6e63e" }, { value: "greens", name: "Greens", color: "#5af05a" },
  { value: "cyans", name: "Cyans", color: "#4ceef2" }, { value: "blues", name: "Blues", color: "#2020ff" }, { value: "magentas", name: "Magentas", color: "#f03ae8" },
  { value: "whites", name: "Whites", color: "#ffffff" }, { value: "neutrals", name: "Neutrals", color: "#808080" }, { value: "blacks", name: "Blacks", color: "#000000" },
];

/** Photoshop 2026's coloured circle buttons: one choice, shown as the colour it means. */
export function SwatchRow({ label, text, name, swatches, selected, locked, commit }: { label: string; text?: string; name: string; swatches: Swatch[]; selected: string; locked: boolean; commit: (value: string) => void }) {
  return <div className="xd-ps-dialog-row"><div className="xd-photo-swatch-row">{text && <span>{text}</span>}
    <div role="radiogroup" aria-label={label} className="xd-photo-swatches">{swatches.map(swatch => <button key={swatch.value} type="button" role="radio" aria-checked={selected === swatch.value} aria-label={swatch.name} title={swatch.name} data-name={name} disabled={locked} style={{ "--xd-photo-swatch": swatch.color } as CSSProperties} onClick={() => commit(swatch.value)}/>)}</div>
  </div></div>;
}

function Eyedropper({ tone }: { tone: ExposureTone }) {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path className={`xd-photo-eyedropper-ink is-${tone}`} d="M3 21v-3l9-9 3 3-9 9Z"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>
  </svg>;
}
const EXPOSURE_TONES: [ExposureTone, string][] = [["black", "Set black point (Offset)"], ["gray", "Set gray point (Exposure)"], ["white", "Set white point (Exposure)"]];

/** Exposure's black, gray and white eyedroppers in the dialog's button column; a click on the image sets Offset or Exposure. */
export function ExposureEyedroppers({ slot, source, canvas, mode, locked, setValues, fail }: { slot?: HTMLElement | null; source?: HistogramSource; canvas?: HTMLElement | null; mode: string; locked: boolean; setValues: Dispatch<SetStateAction<Settings>>; fail: (message: string) => void }) {
  const [armed, setArmed] = useState<ExposureTone | null>(null), sampling = !!source && !!canvas && isTauri();
  useToneSampler(canvas ?? null, source, sampling && !!armed && !locked, color => { if (armed) setValues(current => ({ ...current, ...exposureSamplePatch(armed, color, current, mode) })); }, fail);
  return slot ? createPortal(<div className="xd-photo-tone-slot"><div className="xd-photo-tone-eyedroppers" role="toolbar" aria-label="Eyedroppers">{EXPOSURE_TONES.map(([tone, name]) => <button key={tone} type="button" aria-label={name} title={name} aria-pressed={armed === tone} disabled={locked || !sampling} onClick={() => setArmed(current => current === tone ? null : tone)}><Eyedropper tone={tone}/></button>)}</div></div>, slot) : null;
}

/** The on-image adjustment tool's button: while it is on, pressing on the image and dragging changes the setting under the pointer. */
export function OnImageButton({ title, armed, disabled, toggle }: { title: string; armed: boolean; disabled: boolean; toggle: () => void }) {
  return <button type="button" className="xd-photo-on-image" aria-label="On-image adjustment" title={title} aria-pressed={armed} disabled={disabled} onClick={toggle}><Pointer size={14}/></button>;
}

/** Brightness/Contrast's Auto, solved from the luminosity histogram. */
export function AutoBrightnessContrast({ slot, source, legacy, locked, setValues }: { slot?: HTMLElement | null; source?: HistogramSource; legacy: boolean; locked: boolean; setValues: Dispatch<SetStateAction<Settings>> }) {
  const bins = useHistogram(source, "luminosity")?.[0], patch = bins ? autoBrightnessContrast(bins, legacy) : null;
  return slot ? createPortal(<button type="button" disabled={locked || !patch} onClick={() => { if (patch) setValues(current => ({ ...current, ...patch })); }}>Auto</button>, slot) : null;
}

const HEX = /^#[\da-f]{6}/i;
const toHex = (value: unknown, fallback: string) => Array.isArray(value) && value.length >= 3 ? "#" + value.slice(0, 3).map(part => Math.round(Math.max(0, Math.min(1, Number(part))) * 255).toString(16).padStart(2, "0")).join("") : fallback;
/** Gradient Map's preset picker: the Gradient tool's presets, with foreground and background resolved to the current colours. */
export function GradientMapPresets({ stops, locked, choose }: { stops: [number, string][]; locked: boolean; choose: (stops: [number, string][]) => void }) {
  const presets = usePhotoWorkspace(state => state.state?.presets), tools = usePhotoWorkspace(state => state.state?.tools), [picked, setPicked] = useState<{ name: string; stops: string } | null>(null);
  if (!presets?.gradients.length) return null;
  const foreground = toHex(tools?.foreground, "#000000"), background = toHex(tools?.background, "#ffffff");
  const key = JSON.stringify(stops), current = { name: picked && picked.stops === key ? picked.name : "Custom", stops, transparency: [] as [number, number][] };
  return <div className="xd-ps-dialog-row"><GradientPresetSelect current={current} groups={presets.gradients} foreground={foreground} background={background} disabled={locked} select={(name, group) => {
    const preset = presets.gradients.find(item => item.name === group)?.presets.find(item => item.name === name);
    if (!preset) return;
    const next = preset.stops.map(([at, color]): [number, string] => [at, color === "foreground" ? foreground : color === "background" ? background : HEX.test(color) ? color.slice(0, 7) : "#000000"]);
    setPicked({ name, stops: JSON.stringify(next) }); choose(next);
  }}/></div>;
}

/** The dial beside an Angle field; 0° points right and angles turn counter-clockwise, as in Layer Style. */
export function AngleDial({ label, value, disabled, change }: { label: string; value: number; disabled: boolean; change: (value: number) => void }) {
  const turn = (event: { currentTarget: Element; clientX: number; clientY: number }) => {
    const box = event.currentTarget.getBoundingClientRect();
    change(Math.round(Math.atan2(box.top + box.height / 2 - event.clientY, event.clientX - box.left - box.width / 2) * 180 / Math.PI));
  };
  const radians = (Number.isFinite(value) ? value : 0) * Math.PI / 180;
  return <svg className="xd-ls-dial" viewBox="-12 -12 24 24" role="img" aria-label={`${label} dial`} aria-disabled={disabled || undefined} onPointerDown={event => { if (disabled) return; event.currentTarget.setPointerCapture?.(event.pointerId); turn(event); }} onPointerMove={event => { if (!disabled && event.buttons) turn(event); }}><circle r="10"/><line x2={Math.cos(radians) * 10} y2={-Math.sin(radians) * 10}/></svg>;
}

import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { isTauri } from "@tauri-apps/api/core";
import type { NumberControl } from "./controls";
import { hueOf } from "./hueSaturationControls";
import { OnImageButton } from "./psAdjustControls";
import { autoBlackWhite, BLACK_WHITE_KEYS } from "./psAdjustMath";
import { useTonePixels } from "./toneClipping";
import type { HistogramSource } from "./toneControls";
import { useImageDrag } from "./toneSampler";

type Settings = Record<string, unknown>;
type Slider = (field: NumberControl, value: number, commit: (value: number) => void, track: string) => ReactNode;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const HUE: NumberControl = { key: "tintHue", label: "Hue", min: 0, max: 360, value: 42 };
const SATURATION: NumberControl = { key: "tintSaturation", label: "Saturation", min: 0, max: 100, value: 20 };
// The tracks show the colours they set, so they are literal content colours rather than theme tokens.
const SPECTRUM = "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";

/** A colour's HSB, hue in degrees and the rest 0–1. */
export function hsbOf(hex: string): { hue: number; saturation: number; brightness: number } {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number], max = Math.max(r, g, b);
  return { ...hueOf([r, g, b]), brightness: max / 255 };
}
export function hsbHex(hue: number, saturation: number, brightness: number): string {
  const f = (n: number) => { const k = (n + hue / 60) % 6; return brightness * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1))); };
  return "#" + [5, 3, 1].map(n => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("");
}

/**
 * Photoshop's Black & White. The dialog has the Tint swatch beside its checkbox and Hue and Saturation sliders under it,
 * Auto in the button column, and the on-image tool always on; Properties puts the tool, Tint and Auto in one row above the
 * sliders. A drag on the image moves the slider for the colour under the pointer.
 */
export function BlackWhiteLayout({ values, change, setValues, locked, dialog, sliders, tint, tintColor, slider, slot, source, canvas, fail }: {
  values: Settings; change: (key: string, value: unknown) => void; setValues: Dispatch<SetStateAction<Settings>>; locked: boolean; dialog: boolean;
  sliders: ReactNode; tint: ReactNode; tintColor: string; slider: Slider; slot?: HTMLElement | null; source?: HistogramSource; canvas?: HTMLElement | null; fail: (message: string) => void;
}) {
  const [adjusting, setAdjusting] = useState(false), shown = useRef(values); shown.current = values;
  // Hue holds while Saturation is 0, where the colour alone has no hue to read back.
  const [held, setHeld] = useState<{ hex: string; hue: number; saturation: number } | null>(null);
  const sampling = !!source && !!canvas && isTauri(), tinted = values.tint === true, hsb = hsbOf(tintColor);
  const hue = held?.hex === tintColor ? held.hue : Math.round(hsb.hue), saturation = held?.hex === tintColor ? held.saturation : Math.round(hsb.saturation * 100);
  const setTint = (nextHue: number, nextSaturation: number) => { const hex = hsbHex(nextHue, nextSaturation / 100, hsb.brightness || 225 / 255); setHeld({ hex, hue: nextHue, saturation: nextSaturation }); change("tintColor", hex); };
  useImageDrag(canvas ?? null, source, sampling && !locked && (dialog || adjusting), "ew", color => {
    const { hue, saturation } = hueOf(color);
    if (saturation < .02) return null;
    const key = BLACK_WHITE_KEYS[Math.round(hue / 60) % 6]!, start = Number(shown.current[key]) || 0;
    return dx => change(key, clamp(Math.round(start + dx), -200, 300));
  }, fail);
  const swatch = <input aria-label="Adjustment Tint color" title="Select tint color" type="color" disabled={locked || !tinted} value={tintColor} onChange={event => change("tintColor", event.target.value)}/>;
  const auto = <AutoBlackWhite inline={!dialog} slot={slot} source={source} canvas={canvas} locked={locked || !sampling} setValues={setValues} fail={fail}/>;
  if (!dialog) return <>
    <div className="xd-ps-dialog-row xd-photo-bw-row"><OnImageButton title="Click and drag in image to modify a specific color" armed={adjusting} disabled={locked || !sampling} toggle={() => setAdjusting(current => !current)}/>{tint}{swatch}{auto}</div>
    {sliders}
  </>;
  return <>
    {sliders}
    <div className="xd-ps-dialog-row xd-photo-bw-row">{tint}{swatch}</div>
    <fieldset className="xd-photo-bw-tint" disabled={locked || !tinted}>
      {slider(HUE, hue, value => setTint(clamp(value, 0, 360), saturation), SPECTRUM)}
      {slider(SATURATION, saturation, value => setTint(hue, clamp(value, 0, 100)), `linear-gradient(90deg,${hsbHex(hue, 0, hsb.brightness || 225 / 255)},${hsbHex(hue, 1, hsb.brightness || 225 / 255)})`)}
    </fieldset>
    {auto}
  </>;
}

/** Black & White's Auto, which reads the image only once asked. */
function AutoBlackWhite({ inline, slot, source, canvas, locked, setValues, fail }: { inline: boolean; slot?: HTMLElement | null; source?: HistogramSource; canvas?: HTMLElement | null; locked: boolean; setValues: Dispatch<SetStateAction<Settings>>; fail: (message: string) => void }) {
  const [asked, setAsked] = useState(false), pixels = useTonePixels(source, canvas, asked, message => { setAsked(false); fail(message); });
  useEffect(() => {
    if (!asked || !pixels) return;
    setAsked(false);
    const weights = autoBlackWhite(pixels.rgba);
    setValues(current => ({ ...current, ...Object.fromEntries(BLACK_WHITE_KEYS.map((key, at) => [key, weights[at]])) }));
  }, [asked, pixels]);
  const button = <button type="button" disabled={locked} onClick={() => setAsked(true)}>Auto</button>;
  return inline ? button : slot ? createPortal(button, slot) : null;
}

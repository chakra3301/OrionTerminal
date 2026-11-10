import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { HUE_RANGES } from "./adjustmentSettings";
import { canonicalHueRange, HueBars, hueSaturationColor } from "./colorControls";
import { OnImageButton } from "./psAdjustControls";
import type { HistogramSource } from "./toneControls";
import { useImageDrag, useToneSampler } from "./toneSampler";

type Settings = Record<string, unknown>;
type RGB = [number, number, number];
type HueTool = "sample" | "add" | "subtract";

const turn = (value: number) => (value % 360 + 360) % 360;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const num = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const object = (value: unknown): Settings => value && typeof value === "object" && !Array.isArray(value) ? value as Settings : {};
const centreOf = (bounds: number[]) => (bounds[1]! + bounds[2]!) / 2;
const boundsOf = (values: Settings, key: string) => canonicalHueRange(object(values[key]).range);
const named = (key: string) => key[0]!.toUpperCase() + key.slice(1);
// Swatches and bars show the colours they adjust, so they are literal content colours rather than theme tokens.
const RAINBOW = "conic-gradient(red,yellow,lime,cyan,blue,magenta,red)";
const TOOLS: [HueTool, string][] = [["sample", "Eyedropper"], ["add", "Add to sample"], ["subtract", "Subtract from sample"]];

/** A sample's hue in degrees and its HSV saturation, 0–1. */
export function hueOf([r, g, b]: RGB): { hue: number; saturation: number } {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), span = max - min;
  if (!span) return { hue: 0, saturation: 0 };
  const sector = max === r ? (g - b) / span : max === g ? 2 + (b - r) / span : 4 + (r - g) / span;
  return { hue: turn(sector * 60), saturation: span / max };
}

/** Ticking Colorize, as Photoshop does: the foreground's hue (red for black, white or gray) at 25% saturation; lightness is kept. */
export function colorizeFrom(current: Settings, foreground: unknown): Settings {
  const color = Array.isArray(foreground) && foreground.length >= 3 && foreground.slice(0, 3).every(v => typeof v === "number" && Number.isFinite(v)) ? foreground.slice(0, 3).map(v => clamp(v, 0, 1) * 255) as RGB : null;
  return { ...current, colorize: true, hue: color ? Math.round(hueOf(color).hue) % 360 : 0, saturation: 25 };
}

/** The colour range whose centre lies nearest a hue. */
export function nearestHueRange(values: Settings, hue: number): string {
  let nearest = HUE_RANGES[0]!, best = Infinity;
  for (const key of HUE_RANGES) { const gap = Math.abs(turn(hue - centreOf(boundsOf(values, key)) + 180) - 180); if (gap < best) { nearest = key; best = gap; } }
  return nearest;
}

/**
 * The eyedroppers' range edits. Sample centres the range on the hue, keeping its widths; Add widens the full-strength
 * part to take the hue in and Subtract narrows the range until the hue is out, each keeping the fade beside it.
 */
export function editHueRange(bounds: number[], hue: number, tool: HueTool): number[] {
  const [a, b, c, d] = bounds as [number, number, number, number], centre = centreOf(bounds), at = centre + turn(hue - centre + 180) - 180;
  let next = [a, b, c, d];
  if (tool === "sample") next = bounds.map(value => value + at - centre);
  else if (tool === "add") next = at < b ? [Math.max(at - (b - a), d - 359), at, c, d] : at > c ? [a, b, at, Math.min(at + (d - c), a + 359)] : next;
  else if (at > a && at < d) next = at <= centre ? [at + 1, Math.min(at + 1 + b - a, c), c, d] : [a, b, Math.max(at - 1 - (d - c), b), at - 1];
  return canonicalHueRange(next.map(Math.round));
}

/** Invert swaps a range for every other hue: the fade-out becomes the fade-in and the rest of the wheel is full strength. */
export const invertHueRange = (bounds: number[]) => canonicalHueRange([bounds[2]!, bounds[3]!, bounds[0]! + 360, bounds[1]! + 360]);

/**
 * Photoshop 2026's Hue/Saturation: the on-image tool and a swatch for all colours and each range, which splits into
 * before and after once its colour changes; the sliders; Colorize, the range eyedroppers and Invert; and the before and
 * after bars. The on-image tool picks the range under the pointer, and a drag sets its Saturation, or its Hue with ⌘ or Ctrl.
 */
export function HueSaturationLayout({ values, change, range, setRange, locked, sliders, colorize, anyStep, source, canvas, fail }: {
  values: Settings; change: (key: string, value: unknown) => void; range: string; setRange: (range: string) => void; locked: boolean;
  sliders: ReactNode; colorize: ReactNode; anyStep?: boolean; source?: HistogramSource; canvas?: HTMLElement | null; fail: (message: string) => void;
}) {
  const [tool, setTool] = useState<HueTool | "adjust" | null>(null), [placed, setPlaced] = useState(0), shown = useRef(values); shown.current = values;
  const colorized = values.colorize === true, master = range === "master", sampling = !!source && !!canvas && isTauri();
  const setBounds = (key: string, bounds: number[]) => { change(key, { ...object(shown.current[key]), range: bounds }); setPlaced(count => count + 1); };
  useToneSampler(canvas ?? null, source, sampling && !locked && !colorized && !master && !!tool && tool !== "adjust", color => {
    if (tool && tool !== "adjust") setBounds(range, editHueRange(boundsOf(shown.current, range), hueOf(color).hue, tool));
  }, fail);
  useImageDrag(canvas ?? null, source, sampling && !locked && !colorized && tool === "adjust", "ew", (color, down) => {
    const { hue, saturation } = hueOf(color);
    if (saturation < .02) return null;
    const key = nearestHueRange(shown.current, hue), bounds = editHueRange(boundsOf(shown.current, key), hue, "sample");
    const setting = down.metaKey || down.ctrlKey ? "hue" : "saturation", start = num(object(shown.current[key])[setting]), limit = setting === "hue" ? 180 : 100;
    setRange(key); setBounds(key, bounds);
    return dx => change(key, { ...object(shown.current[key]), range: bounds, [setting]: clamp(Math.round(start + dx), -limit, limit) });
  }, fail);
  const swatch = (key: string) => {
    const centre = turn(centreOf(boundsOf(values, key))), before = hueSaturationColor(centre, {}), after = hueSaturationColor(centre, values);
    return { background: before === after ? before : `linear-gradient(90deg,${before} 50%,${after} 50%)` };
  };
  return <>
    <div className="xd-ps-dialog-row xd-photo-hue-swatches">
      <OnImageButton title="Click and drag in image to modify saturation. ⌘-click and drag to modify hue." armed={tool === "adjust"} disabled={locked || !sampling || colorized} toggle={() => setTool(current => current === "adjust" ? null : "adjust")}/>
      <div role="radiogroup" aria-label="Adjustment Color range" className="xd-photo-swatches">{["master", ...HUE_RANGES].map(key => <button key={key} type="button" role="radio" aria-checked={range === key} aria-label={named(key)} title={named(key)} disabled={locked || colorized && key !== "master"}
        style={{ "--xd-photo-swatch": key === "master" ? RAINBOW : swatch(key).background } as CSSProperties} onClick={() => setRange(key)}/>)}</div>
    </div>
    {sliders}
    <div className="xd-ps-dialog-row xd-photo-hue-tools">{colorize}
      <div className="xd-photo-tone-eyedroppers" role="toolbar" aria-label="Range eyedroppers">{TOOLS.map(([id, name]) => <button key={id} type="button" aria-label={name} title={name} aria-pressed={tool === id} disabled={locked || !sampling || colorized || master} onClick={() => setTool(current => current === id ? null : id)}><RangeEyedropper tool={id}/></button>)}</div>
      <button type="button" disabled={locked || colorized || master} onClick={() => setBounds(range, invertHueRange(boundsOf(values, range)))}>Invert</button>
    </div>
    <div className="xd-photo-hue-before-after"><span>Before - After</span>
      <HueBars key={`${range}:${placed}`} values={values} range={range} locked={locked} anyStep={anyStep} commit={bounds => change(range, { ...object(values[range]), range: bounds })}/>
    </div>
  </>;
}

function RangeEyedropper({ tool }: { tool: HueTool }) {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 21v-3l9-9 3 3-9 9Z"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>
    {tool !== "sample" && <path d={tool === "add" ? "M17 15v6M14 18h6" : "M14 18h6"}/>}
  </svg>;
}

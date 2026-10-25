import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { HUE_RANGES } from "./adjustmentSettings";
import { ToneSlider } from "./toneControls";

type Settings = Record<string, unknown>;

// Slider tracks show the colours they move between, as Photoshop's do, so they are literal content colours rather than theme tokens.
const BALANCE_COLORS: Record<string, string> = { Cyan: "#00ffff", Red: "#ff0000", Magenta: "#ff00ff", Green: "#00ff00", Yellow: "#ffff00", Blue: "#0000ff" };
const BLACK_WHITE_HUES: Record<string, number> = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 };
const RANGE_LABELS = ["Fade in", "Full strength start", "Full strength end", "Fade out"];

const number = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const turn = (value: number) => (value % 360 + 360) % 360;
const object = (value: unknown): Settings => value && typeof value === "object" && !Array.isArray(value) ? value as Settings : {};
export const trackStyle = (track: string) => ({ "--xd-photo-track": track }) as CSSProperties;

/** Color Balance rows put the two colours at the slider's ends, e.g. Cyan … Red. */
export function balanceSlider(label: string): { ends: [string, string]; track: string } | undefined {
  const [left, right] = label.split(" / ");
  return left && right ? { ends: [left, right], track: `linear-gradient(90deg,${BALANCE_COLORS[left] ?? "#000"},${BALANCE_COLORS[right] ?? "#fff"})` } : undefined;
}
export function blackWhiteTrack(key: string): string | undefined {
  const hue = BLACK_WHITE_HUES[key];
  return hue === undefined ? undefined : `linear-gradient(90deg,hsl(${hue} 100% 10%),hsl(${hue} 100% 50%),hsl(${hue} 100% 90%))`;
}
const spectrum = (from: number, color = (deg: number) => `hsl(${turn(deg)} 100% 50%)`) => `linear-gradient(90deg,${Array.from({ length: 25 }, (_, i) => `${color(from + i * 15)} ${(i / 24 * 100).toFixed(2)}%`).join(",")})`;

/** The engine's canonical range: increasing, within one turn, centre in -30..330. */
export function canonicalHueRange(bounds: unknown): number[] {
  const raw = Array.isArray(bounds) && bounds.length === 4 && bounds.every(value => typeof value === "number" && Number.isFinite(value)) ? bounds as number[] : [-45, -15, 15, 45];
  const out = [raw[0]!];
  for (let k = 1; k < 4; k++) out[k] = Math.min(out[k - 1]! + turn(raw[k]! - out[k - 1]!), out[0]! + 359);
  const centre = (out[1]! + out[2]!) / 2, shift = turn(centre + 30) - 30 - centre;
  return out.map(value => value + shift);
}
/** The engine's range membership for a hue in degrees, 0..1. */
export function hueWeight(bounds: number[], deg: number): number {
  const rel = (value: number) => turn(value - bounds[0]!), b = rel(bounds[1]!), c = Math.max(rel(bounds[2]!), b), d = Math.max(rel(bounds[3]!), c), h = rel(deg);
  return h <= b ? b <= 0 ? 1 : h / b : h <= c ? 1 : h <= d ? d <= c ? 1 : (d - h) / (d - c) : 0;
}
function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
/** A fully saturated hue after this Hue/Saturation, by the engine's formula, for Photoshop's lower colour bar. */
export function hueSaturationColor(deg: number, values: Settings): string {
  const colorize = values.colorize === true;
  let dh = 0, ds = 0, dl = 0;
  if (!colorize) for (const key of HUE_RANGES) {
    const range = object(values[key]), hue = number(range.hue), saturation = number(range.saturation), lightness = number(range.lightness);
    if (!hue && !saturation && !lightness) continue;
    const weight = hueWeight(canonicalHueRange(range.range), deg);
    dh += weight * hue; ds += weight * saturation / 100; dl += weight * lightness / 100;
  }
  const hue = number(values.hue) + dh, saturation = clamp(number(values.saturation) / 100 + ds, -1, 1), lightness = clamp(number(values.lightness) / 100 + dl, -1, 1);
  const rgb = hslRgb(colorize ? turn(hue) : turn(deg + hue), colorize ? Math.max(Math.abs(saturation), .25) : clamp(1 + saturation, 0, 1), .5)
    .map(value => lightness > 0 ? value + (1 - value) * lightness : value * (1 + lightness));
  return `rgb(${rgb.map(value => Math.round(clamp(value, 0, 1) * 255)).join(",")})`;
}
/** Photoshop's Hue/Saturation slider tracks: the hue wheel, grey to colour, and black through colour to white. */
export function hueSaturationTrack(key: string, values: Settings, range: string): string | undefined {
  const colorize = values.colorize === true, edited = range === "master" ? values : object(values[range]);
  const bounds = canonicalHueRange(edited.range), centre = range === "master" ? 0 : (bounds[1]! + bounds[2]!) / 2;
  const hue = colorize ? number(values.hue) : centre + number(edited.hue);
  if (key === "hue") return spectrum(colorize ? 0 : centre - 180);
  if (key === "saturation") return `linear-gradient(90deg,hsl(${turn(hue)} 0% 50%),hsl(${turn(hue)} 100% 50%))`;
  if (key === "lightness") return `linear-gradient(90deg,#000,hsl(${turn(hue)} 100% 50%),#fff)`;
  return undefined;
}

/**
 * Photoshop's two colour bars, input above and result below, with the range read out under them. With a colour range
 * chosen, the slider between them holds the fade-in triangle, the full-strength bars and the fade-out triangle. Keyed by range so the bars stay put while dragging.
 */
export function HueBars({ values, range, locked, anyStep, commit }: { values: Settings; range: string; locked: boolean; anyStep?: boolean; commit: (bounds: number[]) => void }) {
  const edited = object(values[range]), raw = Array.isArray(edited.range) ? edited.range as number[] : [];
  const [origin] = useState(() => { if (range === "master") return 0; const bounds = canonicalHueRange(edited.range); return Math.round((bounds[1]! + bounds[2]!) / 2) - 180; });
  const frame = canonicalHueRange(edited.range).map(value => origin + turn(value - origin));
  const at = (value: number) => clamp((value - origin) / 360 * 100, 0, 100);
  return <div className="xd-photo-hue-bars">
    <div className="xd-photo-hue-spectrum" style={{ background: spectrum(origin) }}/>
    {range !== "master" && <div className="xd-photo-hue-range">
      <span className="xd-photo-hue-range-fade" style={{ left: `${at(frame[0]!)}%`, right: `${100 - at(frame[3]!)}%` }}/>
      <span className="xd-photo-hue-range-full" style={{ left: `${at(frame[1]!)}%`, right: `${100 - at(frame[2]!)}%` }}/>
      <ToneSlider disabled={locked} handles={RANGE_LABELS.map((label, i) => ({ label: `Adjustment ${label} slider`, position: (frame[i]! - origin) / 360 * 255, value: frame[i]!, min: -720, max: 720, tone: i === 1 || i === 2 ? "gray" : "white" }))} move={(i, x) => {
        const lower = i ? frame[i - 1]! : Math.max(origin, frame[3]! - 359), upper = i < 3 ? frame[i + 1]! : Math.min(origin + 360, frame[0]! + 359);
        const next = clamp(Math.round(origin + x / 255 * 360), lower, upper);
        if (next !== frame[i]) commit(frame.map((value, at) => at === i ? next : value));
      }}/>
    </div>}
    <div className="xd-photo-hue-spectrum" style={{ background: spectrum(origin, deg => hueSaturationColor(turn(deg), values)) }}/>
    <div className="xd-photo-hue-range-fields">{[0, 2].map(from => range === "master" ? <span key={from}>0° / 0°</span> : <span key={from} className="xd-photo-hue-readout">{[from, from + 1].map(i => <label key={i} title={RANGE_LABELS[i]}><input aria-label={`Adjustment ${RANGE_LABELS[i]}`} type="number" required min={-720} max={720} step={anyStep ? "any" : 1} value={typeof raw[i] === "number" && Number.isFinite(raw[i]) ? raw[i] : ""} disabled={locked} onChange={event => commit(RANGE_LABELS.map((_, at) => at === i ? event.target.valueAsNumber : raw[at] ?? frame[at]!))}/><span>°</span></label>).reduce<ReactNode[]>((parts, part, at) => at ? [...parts, " / ", part] : [part], [])}</span>)}</div>
  </div>;
}

/** Photo Filter's Use choice: a named filter or any colour. Choosing a preset colour by hand still reads as that filter. */
export function PhotoFilterUse({ color, presets, locked, change }: { color: string; presets: readonly (readonly [string, string])[]; locked: boolean; change: (color: string) => void }) {
  const preset = presets.find(([, hex]) => hex === color)?.[0], [use, setUse] = useState<"filter" | "color">(preset ? "filter" : "color"), name = useId();
  return <fieldset className="xd-ps-dialog-group xd-photo-filter-use"><legend>Use</legend><div role="radiogroup" aria-label="Adjustment Use">
    <label className="xd-ps-dialog-check"><input type="radio" name={name} disabled={locked} checked={use === "filter"} onChange={() => { setUse("filter"); if (!preset && presets[0]) change(presets[0][1]); }}/>Filter:</label>
    <select aria-label="Adjustment Filter" disabled={locked || use !== "filter"} value={preset ?? ""} onChange={event => { const hex = presets.find(([name]) => name === event.target.value)?.[1]; if (hex) change(hex); }}>{!preset && <option value="" disabled>Custom</option>}{presets.map(([name]) => <option key={name} value={name}>{name.replace(/^(Warming|Cooling) (\w+)$/, "$1 Filter ($2)")}</option>)}</select>
    <label className="xd-ps-dialog-check"><input type="radio" name={name} disabled={locked} checked={use === "color"} onChange={() => setUse("color")}/>Color:</label>
    <input aria-label="Adjustment Filter color" type="color" disabled={locked || use !== "color"} value={color} onChange={event => change(event.target.value)}/>
  </div></fieldset>;
}

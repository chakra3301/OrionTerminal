import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { NumberControl } from "./controls";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument } from "./types";
import { CURVE_DISPLAY, CURVE_POINTS, curveLut, drawCurve, fitCurve, type CurveDisplay } from "./curveTools";
import type { ClipTone } from "./toneClipping";

export { curveLut };

export type CurvePoint = [number, number];
/** A layer mask (of `layer`), the Quick Mask or an alpha channel, read as one grey plane instead of the image's colours. */
export type PlaneTarget = "mask" | "quickMask" | { channel: number };
export type HistogramSource = { document: PhotoDocument; layer?: number; below: boolean; target?: PlaneTarget };
type Tones = Record<string, unknown>;

// Channel colours mark image content, as Photoshop's channel curves do, so they are literal rather than theme tokens.
const CHANNEL_COLORS: Record<string, string> = { red: "rgb(235,80,80)", green: "rgb(80,205,95)", blue: "rgb(90,140,255)", cyan: "rgb(40,200,230)", magenta: "rgb(225,70,200)", yellow: "rgb(235,210,40)", a: "rgb(220,90,140)", b: "rgb(200,180,60)" };
export const channelColor = (channel: string): string | undefined => CHANNEL_COLORS[channel];
export const histogramSpace = (channels: string[]) => channels[0] === "cyan" ? "cmyk" : channels[0] === "lightness" ? "lab" : "rgb";
export const histogramIndex = (channels: string[], channel: string) => channel === "composite" ? 0 : channels.indexOf(channel) + (channels[0] === "lightness" ? 0 : 1);

export function useHistogram(source: HistogramSource | undefined, space: string): number[][] | null {
  const projectId = usePhotoWorkspace(state => state.projectId), [bins, setBins] = useState<number[][] | null>(null);
  const key = source && projectId && isTauri() ? JSON.stringify([projectId, source.document.id, source.document.version, source.layer ?? null, source.below, space, source.target ?? null]) : "";
  useEffect(() => {
    if (!key || !source) return;
    let alive = true;
    // Live Properties edits bump the version several times a second; only the settled one is worth reading.
    const timer = window.setTimeout(() => {
      invoke<unknown>("xdesign_photo_histogram", { projectId, photoId: source.document.id, version: source.document.version, layer: source.layer ?? null, below: source.below, space, ...source.target ? { target: source.target } : {} })
        .then(next => { if (alive && Array.isArray(next) && next.length && next.every(channel => Array.isArray(channel) && channel.length === 256)) setBins(next as number[][]); })
        // A superseded version fails; the histogram is a guide, so the last good one stays until the next read.
        .catch(() => undefined);
    }, 120);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return key ? bins : null;
}

/** Area path in a 256×100 box; like Photoshop it scales to the bulk of the data so a clipped spike cannot flatten the rest. */
export function histogramPath(bins: number[]): string {
  const top = Math.max(1, ([...bins].sort((a, b) => a - b)[250] ?? 0) * 1.1);
  return `M0 100${bins.map((count, i) => `L${i + .5} ${(100 - Math.min(1, count / top) * 100).toFixed(2)}`).join("")}L256 100Z`;
}
export function Histogram({ bins, color, children }: { bins?: number[]; color?: string; children?: ReactNode }) {
  return <svg className="xd-photo-histogram" viewBox="0 0 256 100" preserveAspectRatio="none" aria-hidden="true">{bins && <path d={histogramPath(bins)} fill={color ?? "currentColor"}/>}{children}</svg>;
}

/** The engine's Auto: clip a percentage of the pixels at each end, 0.1% by default. Null when there are no pixels to measure. */
export function autoLevels(bins: number[], shadowClip = .1, highlightClip = .1): [number, number] | null {
  const total = bins.reduce((sum, count) => sum + count, 0), low = Math.floor(total * shadowClip / 100), high = Math.floor(total * highlightClip / 100);
  if (!total) return null;
  let acc = 0, lo = 0, hi = 255;
  while (lo < 253 && acc + bins[lo]! <= low) acc += bins[lo++]!;
  acc = 0;
  while (hi > lo + 2 && acc + bins[hi]! <= high) acc += bins[hi--]!;
  return [lo, hi];
}
const gammaPosition = (black: number, white: number, gamma: number) => black + (white - black) * .5 ** gamma;
const gammaFromPosition = (black: number, white: number, x: number) => Math.min(9.99, Math.max(.01, Math.round(Math.log(Math.min(.99, Math.max(.01, (x - black) / Math.max(white - black, 1)))) / Math.log(.5) * 100) / 100));
const finite = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type ToneHandle = { label: string; position: number; value: number; min: number; max: number; tone: "black" | "gray" | "white" };
/** Photoshop's triangle sliders under a histogram or gradient: a press grabs the nearest triangle. Positions are 0–255. */
/** `grab` reports the dragged triangle and whether Alt is held, for Show Clipping. */
export function ToneSlider({ handles, disabled, move, grab }: { handles: ToneHandle[]; disabled: boolean; move: (index: number, position: number) => void; grab?: (index: number | null, alt: boolean) => void }) {
  const drag = useRef<{ index: number; pointer: number; offset: number } | null>(null);
  useEffect(() => { if (disabled) drag.current = null; }, [disabled]);
  const at = (event: PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return rect.width > 0 && Number.isFinite(event.clientX) ? (event.clientX - rect.left) / rect.width * 255 : null; };
  const end = (event: PointerEvent<HTMLDivElement>) => { if (drag.current?.pointer === event.pointerId) { drag.current = null; grab?.(null, false); } };
  return <div className="xd-photo-tone-strip" onPointerDown={event => {
    if (disabled || event.button !== 0 || drag.current) return;
    const x = at(event); if (x === null) return;
    const grabbed = event.target instanceof Element ? event.target.closest("[data-tone-index]") : null;
    let index = grabbed ? Number(grabbed.getAttribute("data-tone-index")) : -1;
    if (!handles[index]) { index = 0; handles.forEach((handle, i) => { if (Math.abs(handle.position - x) < Math.abs(handles[index]!.position - x)) index = i; }); }
    drag.current = { index, pointer: event.pointerId, offset: grabbed ? handles[index]!.position - x : 0 };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    grab?.(index, event.altKey);
    if (!grabbed) move(index, x);
  }} onPointerMove={event => { const current = drag.current; if (disabled || current?.pointer !== event.pointerId) return; grab?.(current.index, event.altKey); const x = at(event); if (x !== null) move(current.index, x + current.offset); }}
    onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    {handles.map((handle, i) => <span key={handle.label} data-tone-index={i} role="slider" tabIndex={disabled ? -1 : 0} aria-label={handle.label} aria-valuemin={handle.min} aria-valuemax={handle.max} aria-valuenow={handle.value} aria-disabled={disabled || undefined}
      className={`xd-photo-tone-handle is-${handle.tone}`} style={{ left: `${clamp(handle.position, 0, 255) / 255 * 100}%` }} onKeyDown={event => {
        const step = event.shiftKey ? 10 : 1, delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -step : event.key === "ArrowRight" || event.key === "ArrowUp" ? step : 0;
        if (disabled || !delta) return;
        event.preventDefault(); move(i, handle.position + delta);
      }}><svg viewBox="0 0 11 9" aria-hidden="true"><path d="M5.5 .5L10.5 8.5H.5Z"/></svg></span>)}
  </div>;
}

// `digits` shows a fixed number of decimals, as Photoshop's gamma does, while what is typed stays as typed.
function NumberBox({ field, value, min = field.min, max = field.max, prefix, locked, anyStep, digits, commit }: { field: NumberControl; value: unknown; min?: number; max?: number; prefix: string; locked: boolean; anyStep?: boolean; digits?: number; commit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = typeof value === "number" && Number.isFinite(value) ? digits === undefined ? String(value) : value.toFixed(digits) : "";
  return <input aria-label={`${prefix} ${field.label}`} title={field.text ?? field.label} type="number" required min={min} max={max} step={anyStep ? "any" : field.step ?? 1} value={draft ?? shown} disabled={locked}
    onFocus={() => { if (digits !== undefined) setDraft(shown); }} onBlur={() => setDraft(null)} onChange={event => { if (digits !== undefined) setDraft(event.target.value); commit(event.target.valueAsNumber); }}/>;
}

/** Photoshop's Levels: histogram over black, gamma and white input triangles, then the output gradient and its two triangles. */
export function LevelsEditor({ tones, fields, bins, color, locked, anyStep, prefix, patch, clip }: { tones: Tones; fields: NumberControl[]; bins?: number[]; color?: string; locked: boolean; anyStep?: boolean; prefix: string; patch: (values: Record<string, number>) => void; clip?: ClipSignal }) {
  const black = finite(tones.inBlack, 0), white = finite(tones.inWhite, 255), gamma = finite(tones.gamma, 1), outBlack = finite(tones.outBlack, 0), outWhite = finite(tones.outWhite, 255);
  const set = (key: string, value: number) => { if (value !== tones[key]) patch({ [key]: value }); };
  const box = (key: string, limits: { min?: number; max?: number } = {}) => { const field = fields.find(item => item.key === key); return field && <NumberBox key={key} field={field} value={tones[key]} {...limits} prefix={prefix} locked={locked} anyStep={anyStep} digits={key === "gamma" ? 2 : undefined} commit={value => patch({ [key]: value })}/>; };
  return <div className="xd-photo-levels">
    <p className="xd-ps-dialog-subhead">Input Levels:</p>
    <div className="xd-photo-levels-histogram"><Histogram bins={bins} color={color}/></div>
    <ToneSlider disabled={locked} handles={[
      { label: `${prefix} Input black slider`, position: black, value: black, min: 0, max: 253, tone: "black" },
      { label: `${prefix} Gamma slider`, position: gammaPosition(black, white, gamma), value: gamma, min: .01, max: 9.99, tone: "gray" },
      { label: `${prefix} Input white slider`, position: white, value: white, min: 2, max: 255, tone: "white" },
    ]} grab={clip && ((handle, alt) => clip(handle === 0 ? "shadows" : handle === 2 ? "highlights" : null, alt))} move={(handle, x) => handle === 0 ? set("inBlack", clamp(Math.round(x), 0, Math.min(253, Math.floor(white) - 2))) : handle === 2 ? set("inWhite", clamp(Math.round(x), Math.max(2, Math.ceil(black) + 2), 255)) : set("gamma", gammaFromPosition(black, white, x))}/>
    <div className="xd-photo-levels-fields">{box("inBlack", { max: Math.min(253, white - 2) })}{box("gamma")}{box("inWhite", { min: black + 2 })}</div>
    <p className="xd-ps-dialog-subhead">Output Levels:</p>
    <div className="xd-photo-tone-bar" style={{ background: `linear-gradient(90deg,#000,${color ?? "#fff"})` }}/>
    <ToneSlider disabled={locked} handles={[
      { label: `${prefix} Output black slider`, position: outBlack, value: outBlack, min: 0, max: 255, tone: "black" },
      { label: `${prefix} Output white slider`, position: outWhite, value: outWhite, min: 0, max: 255, tone: "white" },
    ]} move={(handle, x) => set(handle ? "outWhite" : "outBlack", clamp(Math.round(x), 0, 255))}/>
    <div className="xd-photo-levels-fields">{box("outBlack")}{box("outWhite")}</div>
  </div>;
}

/** Photoshop's Threshold: the level box over a histogram marked at the level, with one triangle. */
export function ThresholdEditor({ field, value, bins, locked, anyStep, prefix, commit }: { field: NumberControl; value: unknown; bins?: number[]; locked: boolean; anyStep?: boolean; prefix: string; commit: (value: number) => void }) {
  const level = finite(value, field.value);
  return <div className="xd-photo-levels">
    <label className="xd-photo-levels-row"><span>{field.text ?? field.label}:</span><NumberBox field={field} value={value} prefix={prefix} locked={locked} anyStep={anyStep} commit={commit}/></label>
    <div className="xd-photo-levels-histogram is-threshold"><Histogram bins={bins}><path d={`M${level + .5} 0V100`} className="xd-photo-threshold-line" vectorEffect="non-scaling-stroke"/></Histogram></div>
    <ToneSlider disabled={locked} handles={[{ label: `${prefix} ${field.label} slider`, position: level, value: level, min: field.min, max: field.max, tone: "black" }]} move={(_, x) => { const next = clamp(Math.round(x), field.min, field.max); if (next !== value) commit(next); }}/>
  </div>;
}

const curveSpacing = (left: number, right: number) => Math.fround(Math.fround(right) - Math.fround(left)) >= 1;
function adjacentCurveFloat(value: number, direction: 1 | -1): number {
  const number = new Float32Array([value]), bits = new Uint32Array(number.buffer);
  if (value <= 0 && direction < 0 || value >= 255 && direction > 0) return value;
  bits[0] = bits[0]! + direction;
  return number[0]!;
}
// Squared graph units: about the 9px Photoshop allows at full size.
const CURVE_HIT = 81;
const curveLine = (values: number[]) => "M" + values.map((y, x) => `${x} ${(255 - y).toFixed(2)}`).join("L");

/** Pigment shows ink percentages, as Photoshop's Pigment/Ink % does: the graph turns half a turn, so 0% is white. */
/** Which end of the tonal range is being dragged, and whether Alt is held, for Show Clipping. */
export type ClipSignal = (tone: ClipTone | null, alt: boolean) => void;
export type CurveView = { pencil?: boolean; pigment?: boolean; display?: CurveDisplay; toggleGrid?: () => void; clip?: ClipSignal };
export function CurveEditor({ points, disabled, change, maxPoints = CURVE_POINTS, label = "Adjustment curve", bins, color, overlays = [], pencil = false, pigment = false, display = CURVE_DISPLAY, toggleGrid, clip, aside }: CurveView & {
  points: CurvePoint[]; disabled: boolean; change: (points: CurvePoint[]) => void; maxPoints?: number; label?: string; bins?: number[]; color?: string; overlays?: { color: string; points: CurvePoint[] }[];
  /** Beside the Input and Output fields, where Photoshop's dialog puts the eyedroppers and Show Clipping. */
  aside?: ReactNode;
}) {
  const [selected, setSelected] = useState(0), [fine, setFine] = useState(display.detailed), [dragging, setDragging] = useState(false);
  const drag = useRef<{ index: number; pointer: number; element: SVGSVGElement; offset: CurvePoint } | null>(null);
  const stroke = useRef<{ values: number[]; last: CurvePoint; pointer: number; element: SVGSVGElement } | null>(null), lastDrawn = useRef<CurvePoint | null>(null);
  const detailed = toggleGrid ? display.detailed : fine;
  const index = Math.max(0, Math.min(selected, points.length - 1));
  const finish = () => {
    const current = drag.current ?? stroke.current; drag.current = null; setDragging(false); clip?.(null, false);
    if (stroke.current) { lastDrawn.current = stroke.current.last; stroke.current = null; }
    if (current?.element.hasPointerCapture?.(current.pointer)) current.element.releasePointerCapture(current.pointer);
  };
  useEffect(() => { if (disabled) finish(); }, [disabled]);
  useEffect(() => () => finish(), []);
  const replace = (at: number, input: number, output: number) => {
    if (disabled || !points[at] || !Number.isFinite(input) || !Number.isFinite(output)) return;
    let x = points[at]![0];
    if (input !== x) {
      const minimum = at > 0 ? Math.fround(points[at - 1]![0]) + 1 : 0;
      const maximum = at < points.length - 1 ? Math.fround(points[at + 1]![0]) - 1 : 255;
      if (minimum > maximum) return;
      x = Math.fround(Math.max(minimum, Math.min(maximum, input)));
      // The decoder subtracts f32 coordinates; decimal rounding can shrink a one-level gap.
      if (at > 0 && !curveSpacing(points[at - 1]![0], x)) x = adjacentCurveFloat(Math.fround(minimum), 1);
      if (at < points.length - 1 && !curveSpacing(x, points[at + 1]![0])) x = adjacentCurveFloat(Math.fround(maximum), -1);
    }
    if (!Number.isFinite(x) || x < 0 || x > 255 || at > 0 && !curveSpacing(points[at - 1]![0], x) || at < points.length - 1 && !curveSpacing(x, points[at + 1]![0])) return;
    const y = Math.max(0, Math.min(255, output));
    if (x === points[at]![0] && y === points[at]![1]) return;
    change(points.map((point, i) => i === at ? [x, y] : point));
  };
  const insert = ([px, py]: CurvePoint): number => {
    if (points.length >= maxPoints) return -1;
    const inserted: CurvePoint = [Math.fround(Math.max(0, Math.min(255, px))), Math.max(0, Math.min(255, py))];
    const next = [...points, inserted].sort((a, b) => a[0] - b[0]), at = next.indexOf(inserted);
    if (at > 0 && !curveSpacing(next[at - 1]![0], inserted[0]) || at < next.length - 1 && !curveSpacing(inserted[0], next[at + 1]![0])) return -1;
    change(next);
    return at;
  };
  const shown = (value: number) => pigment ? 255 - value : value;
  const end = (at: number): ClipTone | null => at === 0 ? "shadows" : at === points.length - 1 && at > 0 ? "highlights" : null;
  const point = (event: PointerEvent<SVGSVGElement>): CurvePoint | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && Number.isFinite(event.clientX + event.clientY) ? [shown((event.clientX - rect.left) * 265 / rect.width - 5), shown(260 - (event.clientY - rect.top) * 265 / rect.height)] : null;
  };
  // Photoshop keeps the end points: they set the black and white input.
  const inner = (at: number) => points.length > 2 && at > 0 && at < points.length - 1;
  const remove = (at: number) => { if (disabled || !inner(at)) return; finish(); change(points.filter((_, i) => i !== at)); setSelected(at - 1); };
  const tint = color ?? "#fff", grid = detailed ? [1, 2, 3, 4, 5, 6, 7, 8, 9].map(step => step * 25.5) : [63.75, 127.5, 191.25], current = points[index];
  const modifier = /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl";
  const percent = (value: number) => Math.round((255 - value) / 2.55);
  return <div className="xd-photo-curves">
    <div className="xd-photo-curve-plot">
      <div className="xd-photo-curve-vbar" style={{ background: `linear-gradient(${pigment ? 180 : 0}deg,#000,${tint})` }}/>
      <svg aria-label={label} viewBox="-5 -5 265 265" data-tool={pencil ? "pencil" : undefined} onContextMenu={event => event.preventDefault()} onPointerDown={event => {
        if (disabled || drag.current || stroke.current || event.button !== 0 && event.button !== 2) return;
        const next = point(event); if (!next) return;
        const grid = () => { if (toggleGrid) toggleGrid(); else setFine(value => !value); };
        if (pencil) {
          if (event.altKey) { grid(); return; }
          if (event.button !== 0) return;
          const values = drawCurve(curveLut(points), event.shiftKey ? lastDrawn.current : null, next);
          stroke.current = { values, last: next, pointer: event.pointerId, element: event.currentTarget }; event.currentTarget.setPointerCapture?.(event.pointerId);
          change(fitCurve(values, maxPoints)); return;
        }
        const clicked = event.target instanceof Element ? event.target.closest("[data-curve-index]") : null;
        let at = clicked ? Number(clicked.getAttribute("data-curve-index")) : -1;
        if (!Number.isInteger(at) || at < 0 || at >= points.length) {
          at = -1; let distance = CURVE_HIT;
          points.forEach(([x, y], i) => { const squared = (x - next[0]) ** 2 + (y - next[1]) ** 2; if (squared < distance) { at = i; distance = squared; } });
        }
        if (event.button === 2 || event.metaKey || event.ctrlKey) { if (at >= 0) remove(at); return; }
        if (event.altKey && at < 0) { grid(); return; }
        const offset: CurvePoint = at >= 0 ? [points[at]![0] - next[0], points[at]![1] - next[1]] : [0, 0];
        if (at < 0) at = insert(next);
        if (at < 0) return;
        setSelected(at); setDragging(true); drag.current = { index: at, pointer: event.pointerId, element: event.currentTarget, offset }; event.currentTarget.setPointerCapture?.(event.pointerId); clip?.(end(at), event.altKey);
      }} onPointerMove={event => {
        const drawing = stroke.current;
        if (drawing) {
          if (disabled || drawing.pointer !== event.pointerId) return;
          const next = point(event); if (!next) return;
          drawing.values = drawCurve(drawing.values, drawing.last, next); drawing.last = next;
          change(fitCurve(drawing.values, maxPoints)); return;
        }
        const current = drag.current;
        if (disabled || !current || current.pointer !== event.pointerId) return;
        clip?.(end(current.index), event.altKey);
        const next = point(event); if (!next) return;
        const target: CurvePoint = [next[0] + current.offset[0], next[1] + current.offset[1]];
        // Photoshop drops an inner point while it is dragged off the graph and puts it back if the pointer returns.
        const outside = next.some(value => value < -12 || value > 267);
        if (current.index < 0) { if (!outside) { const at = insert(target); if (at >= 0) { current.index = at; setSelected(at); } } return; }
        if (outside && inner(current.index)) { change(points.filter((_, i) => i !== current.index)); setSelected(current.index - 1); current.index = -1; return; }
        replace(current.index, target[0], target[1]);
      }} onPointerUp={event => { if ((drag.current ?? stroke.current)?.pointer === event.pointerId) finish(); }} onPointerCancel={event => { if ((drag.current ?? stroke.current)?.pointer === event.pointerId) finish(); }} onLostPointerCapture={event => { if ((drag.current ?? stroke.current)?.pointer === event.pointerId) finish(); }}>
        <rect className="xd-photo-curve-field" width="255" height="255"/>
        {bins && display.histogram && <path className="xd-photo-curve-histogram" d={histogramPath(pigment ? [...bins].reverse() : bins)} transform="scale(.99609375 2.55)" fill={color ?? "currentColor"}/>}
        <path className="xd-photo-curve-grid" d={grid.map(step => `M0 ${step}H255M${step} 0V255`).join("") + (display.baseline ? "M0 255L255 0" : "")} vectorEffect="non-scaling-stroke"/>
        <g transform={pigment ? "rotate(180 127.5 127.5)" : undefined}>
          {display.overlays && overlays.map(overlay => <path key={overlay.color} d={curveLine(curveLut(overlay.points))} fill="none" stroke={overlay.color} vectorEffect="non-scaling-stroke"/>)}
          {dragging && display.intersection && current && <path className="xd-photo-curve-intersection" d={`M0 ${255 - current[1]}H255M${current[0]} 0V255`} vectorEffect="non-scaling-stroke"/>}
          <path d={curveLine(curveLut(points))} fill="none" stroke={color ?? "var(--xd-text)"} strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
          {!pencil && points.map(([x, y], i) => <rect key={i} className="xd-photo-curve-point" data-curve-index={i} role="button" tabIndex={disabled ? -1 : 0} aria-label={`Curve point ${i + 1}`} aria-pressed={index === i} transform={`translate(${x},${255 - y})`} x="-3.5" y="-3.5" width="7" height="7" vectorEffect="non-scaling-stroke" onFocus={() => { if (!disabled) setSelected(i); }} onKeyDown={event => {
            if (disabled) return;
            const step = (event.shiftKey ? 10 : 1) * (pigment ? -1 : 1), dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, dy = event.key === "ArrowDown" ? -step : event.key === "ArrowUp" ? step : 0;
            if (dx || dy) { event.preventDefault(); event.stopPropagation(); replace(i, x + dx, y + dy); }
            if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); remove(i); }
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setSelected(i); }
          }}/>)}
        </g>
      </svg>
    </div>
    <div className="xd-photo-curve-axis">
      <div className="xd-photo-tone-bar" style={{ background: `linear-gradient(${pigment ? 270 : 90}deg,#000,${tint})` }}/>
      <ToneSlider disabled={disabled || points.length < 2} handles={[
        { label: `${label} black point slider`, position: shown(points[0]?.[0] ?? 0), value: points[0]?.[0] ?? 0, min: 0, max: 255, tone: "black" },
        { label: `${label} white point slider`, position: shown(points.at(-1)?.[0] ?? 255), value: points.at(-1)?.[0] ?? 255, min: 0, max: 255, tone: "white" },
      ]} grab={clip && ((handle, alt) => clip(handle === null ? null : handle ? "highlights" : "shadows", alt))} move={(handle, x) => { const at = handle ? points.length - 1 : 0; replace(at, Math.round(shown(x)), points[at]![1]); }}/>
    </div>
    <div className="xd-photo-curve-under">
      <div className="xd-photo-curve-fields">{["Output", "Input"].map(text => { const axis = text === "Input" ? 0 : 1, value = current?.[axis] ?? 0; return <label key={text}><span>{text}:</span><input aria-label={`Curve ${text.toLowerCase()}`} type="number" min="0" max={pigment ? 100 : 255} step="any" disabled={disabled || !current || pencil} value={pigment ? percent(value) : value}
        onChange={event => { const typed = pigment ? 255 - event.target.valueAsNumber * 2.55 : event.target.valueAsNumber; replace(index, axis === 0 ? typed : current![0], axis === 1 ? typed : current![1]); }}/>{pigment && <span className="xd-ps-dialog-unit">%</span>}</label>; })}</div>
      {aside}
    </div>
    <p className="xd-photo-section-help">{pencil ? "Drag to draw the curve. Shift-click to draw a straight line from where the last stroke ended." : `Click to add a point. Drag a point off the graph, ${modifier}-click it or press Delete to remove it.`} Alt-click the grid for {detailed ? "coarser" : "finer"} lines.</p>
  </div>;
}

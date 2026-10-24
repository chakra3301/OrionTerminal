import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { documentUnder } from "./ColorRangeDialog";
import { selectionSamplePoint } from "./selectionSettings";
import { usePhotoWorkspace } from "./runtime";
import { curveLut } from "./curveTools";
import { autoLevels, type CurvePoint, type HistogramSource } from "./toneControls";

type Settings = Record<string, unknown>;
type RGB = [number, number, number];
export type ToneTarget = "black" | "gray" | "white";
export type AutoAlgorithm = "monochromatic" | "perChannel" | "darkLight" | "brightnessContrast";
/** Photoshop's Auto Color Correction Options: target colours are 0–255, clipping is a percentage per end. */
export type AutoOptions = { algorithm: AutoAlgorithm; snap: boolean; shadows: RGB; midtones: RGB; highlights: RGB; shadowClip: number; highlightClip: number };
export const AUTO_DEFAULTS: AutoOptions = { algorithm: "monochromatic", snap: false, shadows: [0, 0, 0], midtones: [128, 128, 128], highlights: [255, 255, 255], shadowClip: .1, highlightClip: .1 };
const STORED = "xdesign.photo.autoColorOptions";
export function readAutoOptions(): AutoOptions {
  try { const stored = JSON.parse(localStorage.getItem(STORED) ?? "null"); return stored && typeof stored === "object" ? { ...AUTO_DEFAULTS, ...stored } : { ...AUTO_DEFAULTS }; }
  catch { return { ...AUTO_DEFAULTS }; }
}
export const saveAutoOptions = (options: AutoOptions) => localStorage.setItem(STORED, JSON.stringify(options));

const RGB_KEYS = ["red", "green", "blue"] as const;
const LEVELS: Settings = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
const IDENTITY: CurvePoint[] = [[0, 0], [255, 255]];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const levelsOf = (value: unknown): Settings => ({ ...LEVELS, ...(value && typeof value === "object" && !Array.isArray(value) ? value as Settings : {}) });
const curveOf = (value: unknown): CurvePoint[] => Array.isArray(value) && value.length >= 2 ? value as CurvePoint[] : IDENTITY;
const num = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const gammaFor = (sample: number, target: number, black: number, white: number) => {
  const span = Math.max(white - black, 1), x = clamp((sample - black) / span, .001, .999), y = clamp((target - black) / span, .001, .999);
  return clamp(Math.round(Math.log(x) / Math.log(y) * 100) / 100, .1, 9.99);
};
// The gray eyedropper neutralises the sample at its own brightness, tinted towards the midtone target.
const grayTarget = (sample: RGB, midtones: RGB) => { const mean = (sample[0] + sample[1] + sample[2]) / 3, mid = (midtones[0] + midtones[1] + midtones[2]) / 3 || 1; return midtones.map(value => clamp(mean * value / mid, 0, 255)) as RGB; };

/** What a Levels or Curves eyedropper click changes: each RGB channel, or the one gray channel, as Photoshop does. */
export function samplePatch(kind: "levels" | "curves", tone: ToneTarget, sample: RGB, values: Settings, gray: boolean, options: AutoOptions = AUTO_DEFAULTS): Settings {
  const mean = (sample[0] + sample[1] + sample[2]) / 3, mid = grayTarget(sample, options.midtones);
  const levels = (current: Settings, value: number, index: number): Settings => {
    const black = num(current.inBlack, 0), white = num(current.inWhite, 255);
    if (tone === "black") return { ...current, inBlack: clamp(Math.round(value), 0, Math.min(253, white - 2)), outBlack: options.shadows[index] };
    if (tone === "white") return { ...current, inWhite: clamp(Math.round(value), Math.max(2, black + 2), 255), outWhite: options.highlights[index] };
    return { ...current, gamma: gammaFor(value, mid[index]!, black, white) };
  };
  const curve = (points: CurvePoint[], value: number, index: number): CurvePoint[] => {
    const input = clamp(Math.round(value), tone === "white" ? 2 : 0, tone === "black" ? 253 : 255);
    if (tone === "black") { const rest = points.filter(([x]) => x >= input + 1); return [[input, options.shadows[index]!], ...rest.length ? rest : [[255, points.at(-1)![1]] as CurvePoint]]; }
    if (tone === "white") { const rest = points.filter(([x]) => x <= input - 1); return [...rest.length ? rest : [[0, points[0]![1]] as CurvePoint], [input, options.highlights[index]!]]; }
    const first = points[0]![0], last = points.at(-1)![0];
    if (input <= first || input >= last) return points;
    const kept = points.filter(([x], i) => i === 0 || i === points.length - 1 || Math.abs(x - input) > 4);
    return kept.length >= 19 ? points : [...kept, [input, Math.round(mid[index]!)] as CurvePoint].sort((a, b) => a[0] - b[0]);
  };
  if (gray) return kind === "levels" ? levels(values, mean, 0) : { points: curve(curveOf(values.points), mean, 0) };
  return Object.fromEntries(RGB_KEYS.map((key, index) => [key, kind === "levels" ? levels(levelsOf(values[key]), sample[index]!, index) : curve(curveOf(values[key]), sample[index]!, index)]));
}

/** The curve with a point at `input` for the on-image tool to drag: the nearest point within a few levels, or a new one on the curve; null when the curve is full. */
export function curvePointFor(points: CurvePoint[], input: number, maxPoints = 19): { points: CurvePoint[]; x: number } | null {
  const near = points.reduce<CurvePoint | null>((best, point) => Math.abs(point[0] - input) <= 3 && (!best || Math.abs(point[0] - input) < Math.abs(best[0] - input)) ? point : best, null);
  if (near) return { points, x: near[0] };
  if (points.length >= maxPoints) return null;
  return { points: [...points, [input, Math.round(curveLut(points)[input]!)] as CurvePoint].sort((a, b) => a[0] - b[0]), x: input };
}

/** Auto with the chosen algorithm. `histograms` is the engine's RGB set: composite, then red, green and blue. */
export function autoPatch(kind: "levels" | "curves", histograms: number[][], gray: boolean, options: AutoOptions = AUTO_DEFAULTS): Settings | null {
  const clip = (bins: number[] | undefined) => bins ? autoLevels(bins, options.shadowClip, options.highlightClip) : null;
  const composite = clip(histograms[0]);
  if (!composite) return null;
  const perChannel = !gray && options.algorithm === "perChannel";
  const channel = (index: number): [number, number] => perChannel ? clip(histograms[index + 1]) ?? [0, 255] : [0, 255];
  const targeted = (index: number) => [options.shadows[index]!, options.highlights[index]!];
  if (kind === "levels") {
    const base = perChannel ? LEVELS : { ...LEVELS, inBlack: composite[0], inWhite: composite[1] };
    if (gray) return base;
    return { ...base, ...Object.fromEntries(RGB_KEYS.map((key, index) => { const [black, white] = channel(index), [outBlack, outWhite] = targeted(index); return [key, { ...LEVELS, inBlack: black, inWhite: white, outBlack, outWhite }]; })) };
  }
  const points: CurvePoint[] = perChannel ? IDENTITY : [[composite[0], 0], [composite[1], 255]];
  if (gray) return { points };
  return { points, ...Object.fromEntries(RGB_KEYS.map((key, index) => { const [black, white] = channel(index), [low, high] = targeted(index); return [key, [[black, low], [white, high]]]; })) };
}

type Drag = (dx: number, dy: number, event: PointerEvent) => void;

/** While armed, a press on the visible image samples the pixels the histogram describes; the canvas tools never see it. */
function useImagePress(canvas: HTMLElement | null, source: HistogramSource | undefined, armed: boolean, press: (sample: Promise<RGB | null>, event: PointerEvent) => void) {
  const projectId = usePhotoWorkspace(state => state.projectId);
  const latest = useRef({ source, projectId, press }); latest.current = { source, projectId, press };
  useEffect(() => {
    if (!armed || !canvas) return;
    const root = window.document.documentElement;
    const pointAt = (event: PointerEvent) => {
      const { source } = latest.current, target = event.target;
      // A beside dialog's scrim lies over the stage; a modal scrim (a nested dialog) does not take samples.
      if (!source || !(target instanceof Element) || !(target.matches(".xd-ps-dialog-scrim.is-beside") || target.closest(".xd-photo-stage"))) return null;
      const bounds = documentUnder(canvas, event.clientX, event.clientY);
      return bounds && selectionSamplePoint(event.clientX, event.clientY, bounds, source.document.width, source.document.height);
    };
    const move = (event: PointerEvent) => root.classList.toggle("xd-photo-eyedropper-cursor", !!pointAt(event));
    const down = (event: PointerEvent) => {
      const point = event.button === 0 ? pointAt(event) : null, { source, projectId } = latest.current;
      if (!point || !source) return;
      event.preventDefault(); event.stopPropagation();
      latest.current.press(invoke<RGB | null>("xdesign_photo_sample", { projectId, photoId: source.document.id, version: source.document.version, layer: source.layer ?? null, below: source.below, x: point[0], y: point[1], width: 1, height: 1 }), event);
    };
    window.addEventListener("pointermove", move, true); window.addEventListener("pointerdown", down, true);
    return () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerdown", down, true); root.classList.remove("xd-photo-eyedropper-cursor"); };
  }, [armed, canvas]);
}

export function useToneSampler(canvas: HTMLElement | null, source: HistogramSource | undefined, armed: boolean, picked: (color: RGB) => void, fail: (message: string) => void) {
  useImagePress(canvas, source, armed, sample => { sample.then(color => { if (color) picked(color); }).catch(error => fail(String(error))); });
}

/**
 * Photoshop's on-image adjustment tool: a press samples the image and `begin` says what dragging from there changes,
 * given how far the pointer has moved. A click without a drag still begins, as it picks the colour.
 */
export function useImageDrag(canvas: HTMLElement | null, source: HistogramSource | undefined, armed: boolean, axis: "ns" | "ew", begin: (color: RGB, event: PointerEvent) => Drag | null, fail: (message: string) => void) {
  useImagePress(canvas, source, armed, (sample, down) => {
    const root = window.document.documentElement, cursor = `xd-photo-drag-${axis}`;
    let drag: Drag | null = null, last: PointerEvent | null = null;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== down.pointerId) return;
      event.preventDefault(); event.stopPropagation(); last = event;
      drag?.(event.clientX - down.clientX, event.clientY - down.clientY, event);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== down.pointerId) return;
      event.stopPropagation(); root.classList.remove(cursor);
      window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true);
    };
    root.classList.add(cursor);
    window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", up, true);
    sample.then(color => {
      if (!color) return;
      drag = begin(color, down);
      if (last) drag?.(last.clientX - down.clientX, last.clientY - down.clientY, last);
    }).catch(error => fail(String(error)));
  });
}

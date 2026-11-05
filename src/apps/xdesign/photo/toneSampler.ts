import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { documentUnder } from "./ColorRangeDialog";
import { selectionSamplePoint } from "./selectionSettings";
import { usePhotoWorkspace } from "./runtime";
import { CURVE_POINTS, curveLut } from "./curveTools";
import { autoLevels, type CurvePoint, type HistogramSource } from "./toneControls";
import { rgbToLab } from "./colorModel";

type Settings = Record<string, unknown>;
type RGB = [number, number, number];
export type ToneTarget = "black" | "gray" | "white";
export type AutoAlgorithm = "monochromatic" | "perChannel" | "darkLight" | "brightnessContrast";
/** Photoshop's Auto Color Correction Options: target colours are 0–255, clipping is a percentage per end. */
export type AutoOptions = { algorithm: AutoAlgorithm; snap: boolean; shadows: RGB; midtones: RGB; highlights: RGB; shadowClip: number; highlightClip: number };
/** The host's mean colours of the darkest and lightest clip percentages by luminosity, and of the nearly neutral rest (null when there is none). */
export type AutoColors = { dark: RGB; light: RGB; neutral: RGB | null };
export const AUTO_DEFAULTS: AutoOptions = { algorithm: "brightnessContrast", snap: false, shadows: [0, 0, 0], midtones: [128, 128, 128], highlights: [255, 255, 255], shadowClip: .1, highlightClip: .1 };
const STORED = "xdesign.photo.autoColorOptions";
const ALGORITHM_IDS: AutoAlgorithm[] = ["monochromatic", "perChannel", "darkLight", "brightnessContrast"];
export function readAutoOptions(): AutoOptions {
  let stored: Record<string, unknown>;
  try { const saved: unknown = JSON.parse(localStorage.getItem(STORED) ?? "null"); if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { ...AUTO_DEFAULTS }; stored = saved as Record<string, unknown>; }
  catch { return { ...AUTO_DEFAULTS }; }
  const color = (key: "shadows" | "midtones" | "highlights"): RGB => { const value = stored[key]; return Array.isArray(value) && value.length === 3 && value.every(item => typeof item === "number" && Number.isFinite(item)) ? value.map(item => clamp(Math.round(item), 0, 255)) as RGB : [...AUTO_DEFAULTS[key]]; };
  const clip = (key: "shadowClip" | "highlightClip") => clamp(num(stored[key], AUTO_DEFAULTS[key]), 0, 9.99);
  return {
    algorithm: ALGORITHM_IDS.includes(stored.algorithm as AutoAlgorithm) ? stored.algorithm as AutoAlgorithm : AUTO_DEFAULTS.algorithm, snap: typeof stored.snap === "boolean" ? stored.snap : AUTO_DEFAULTS.snap,
    shadows: color("shadows"), midtones: color("midtones"), highlights: color("highlights"), shadowClip: clip("shadowClip"), highlightClip: clip("highlightClip"),
  };
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

// One channel's eyedropper change: the sampled level becomes the black or white input mapped to `target`, or the gray point taken to it.
function sampleLevels(tone: ToneTarget, current: Settings, value: number, target: number): Settings {
  const black = num(current.inBlack, 0), white = num(current.inWhite, 255);
  if (tone === "black") return { ...current, inBlack: clamp(Math.round(value), 0, Math.min(253, white - 2)), outBlack: target };
  if (tone === "white") return { ...current, inWhite: clamp(Math.round(value), Math.max(2, black + 2), 255), outWhite: target };
  return { ...current, gamma: gammaFor(value, target, black, white) };
}
function sampleCurve(tone: ToneTarget, points: CurvePoint[], value: number, target: number): CurvePoint[] {
  const input = clamp(Math.round(value), tone === "white" ? 2 : 0, tone === "black" ? 253 : 255);
  if (tone === "black") { const rest = points.filter(([x]) => x >= input + 1); return [[input, target], ...rest.length ? rest : [[255, points.at(-1)![1]] as CurvePoint]]; }
  if (tone === "white") { const rest = points.filter(([x]) => x <= input - 1); return [...rest.length ? rest : [[0, points[0]![1]] as CurvePoint], [input, target]]; }
  const first = points[0]![0], last = points.at(-1)![0];
  if (input <= first || input >= last) return points;
  const kept = points.filter(([x], i) => i === 0 || i === points.length - 1 || Math.abs(x - input) > 4);
  return kept.length >= CURVE_POINTS ? points : [...kept, [input, Math.round(target)] as CurvePoint].sort((a, b) => a[0] - b[0]);
}
const sampleChannel = (kind: "levels" | "curves", tone: ToneTarget, current: unknown, value: number, target: number) => kind === "levels" ? sampleLevels(tone, levelsOf(current), value, target) : sampleCurve(tone, curveOf(current), value, target);

/** What a Levels or Curves eyedropper click changes: each RGB channel, or the one gray channel, as Photoshop does. */
export function samplePatch(kind: "levels" | "curves", tone: ToneTarget, sample: RGB, values: Settings, gray: boolean, options: AutoOptions = AUTO_DEFAULTS): Settings {
  const mean = (sample[0] + sample[1] + sample[2]) / 3, mid = grayTarget(sample, options.midtones);
  const target = (index: number) => (tone === "black" ? options.shadows : tone === "white" ? options.highlights : mid)[index]!;
  if (gray) return kind === "levels" ? sampleLevels(tone, values, mean, target(0)) : { points: sampleCurve(tone, curveOf(values.points), mean, target(0)) };
  return Object.fromEntries(RGB_KEYS.map((key, index) => [key, sampleChannel(kind, tone, values[key], sample[index]!, target(index))]));
}

/** A Lab document's channel levels for a displayed colour, 0–255 as the engine holds them: L × 2.55, a + 128, b + 128. */
export const labLevels = (rgb: RGB): RGB => { const [l, a, b] = rgbToLab(rgb); return [clamp(l * 2.55, 0, 255), clamp(a + 128, 0, 255), clamp(b + 128, 0, 255)]; };

/** A Lab document's eyedroppers: black and white set Lightness from the sample to the target's lightness; gray takes a and b to the midtone target's, leaving Lightness. */
export function labSamplePatch(kind: "levels" | "curves", tone: ToneTarget, sample: RGB, values: Settings, options: AutoOptions = AUTO_DEFAULTS): Settings {
  const level = labLevels(sample), target = labLevels(tone === "black" ? options.shadows : tone === "white" ? options.highlights : options.midtones).map(Math.round);
  const keys: [string, number][] = tone === "gray" ? [["a", 1], ["b", 2]] : [["lightness", 0]];
  return Object.fromEntries(keys.map(([key, index]) => [key, sampleChannel(kind, tone, values[key], level[index]!, target[index]!)]));
}

/** The curve with a point at `input` for the on-image tool to drag: the nearest point within a few levels, or a new one on the curve; null when the curve is full. */
export function curvePointFor(points: CurvePoint[], input: number, maxPoints = CURVE_POINTS): { points: CurvePoint[]; x: number } | null {
  const near = points.reduce<CurvePoint | null>((best, point) => Math.abs(point[0] - input) <= 3 && (!best || Math.abs(point[0] - input) < Math.abs(best[0] - input)) ? point : best, null);
  if (near) return { points, x: near[0] };
  if (points.length >= maxPoints) return null;
  return { points: [...points, [input, Math.round(curveLut(points)[input]!)] as CurvePoint].sort((a, b) => a[0] - b[0]), x: input };
}

const total = (bins: number[]) => bins.reduce((sum, count) => sum + count, 0);
const meanOf = (bins: number[]) => bins.reduce((sum, count, level) => sum + count * level, 0) / Math.max(total(bins), 1e-9);
const unit = (value: number, black: number, white: number) => clamp((value - black) / Math.max(white - black, 1), 0, 1);
// The gamma taking a 0–1 input to a 0–1 output, to the hundredth Photoshop's Levels field keeps.
const gammaTo = (input: number, output: number) => clamp(Math.round(Math.log(clamp(input, .001, .999)) / Math.log(clamp(output, .001, .999)) * 100) / 100, .1, 9.99);

/** Find Dark & Light Colors on one channel: the average of its darkest and of its lightest clip percentage, at least a pixel each, so it clips less than stretching to those percentages does. */
function averageEnds(bins: number[], shadowClip: number, highlightClip: number): [number, number] | null {
  const count = total(bins);
  if (!count) return null;
  const average = (percent: number, levels: number[]) => {
    const wanted = Math.max(count * percent / 100, 1);
    let sum = 0, taken = 0;
    for (const level of levels) { const take = Math.min(bins[level]!, wanted - taken); sum += take * level; taken += take; if (taken >= wanted) break; }
    return sum / taken;
  };
  const levels = bins.map((_, level) => level), black = Math.min(253, Math.round(average(shadowClip, levels)));
  return [black, Math.max(black + 2, Math.round(average(highlightClip, levels.reverse())))];
}

/**
 * Auto with the chosen algorithm. `histograms` is the engine's RGB set: composite, then red, green and blue. They are
 * per channel, so Find Dark & Light Colors and Snap Neutral Midtones read each channel on its own, and the channel
 * averages stand for the image's average colour.
 */
export function autoPatch(kind: "levels" | "curves", histograms: number[][], gray: boolean, options: AutoOptions = AUTO_DEFAULTS, colors?: AutoColors | null): Settings | null {
  const darkLight = options.algorithm === "darkLight";
  const ends = (bins: number[] | undefined) => !bins ? null : darkLight ? averageEnds(bins, options.shadowClip, options.highlightClip) : autoLevels(bins, options.shadowClip, options.highlightClip);
  const composite = ends(histograms[0]);
  if (!composite) return null;
  const separate = !gray && (options.algorithm === "perChannel" || darkLight), [low, high] = separate ? [0, 255] : composite;
  // Enhance Brightness and Contrast also brings the average to mid-gray, as Auto Brightness/Contrast does.
  const average = meanOf(histograms[0]!), lift = options.algorithm === "brightnessContrast" ? gammaTo(unit(average, low, high), .5) : 1;
  const found = (index: number): [number, number] => { const black = Math.min(253, Math.round(colors!.dark[index]!)); return [black, Math.max(black + 2, Math.round(colors!.light[index]!))]; };
  const channel = (index: number): [number, number] => separate ? (darkLight && colors ? found(index) : ends(histograms[index + 1])) ?? [0, 255] : [0, 255];
  const targeted = (index: number) => [options.shadows[index]!, options.highlights[index]!];
  const means = colors ? RGB_KEYS.map((_, index) => colors.neutral?.[index] ?? null) : RGB_KEYS.map((_, index) => { const bins = histograms[index + 1]; return bins && total(bins) ? meanOf(bins) : null; });
  const brightest = Math.max(...means.map(value => value ?? 0));
  // Snap Neutral Midtones takes a nearly neutral average colour, under 25% HSB saturation, to gray at its own brightness; the host's neutral is already one.
  const snapping = !gray && options.snap && means.every(value => value !== null) && (!!colors || brightest - Math.min(...means as number[]) < .25 * brightest);
  // Levels applies the composite before each channel; Curves applies each channel first.
  const before = (index: number) => kind === "levels" ? 255 * unit(means[index]!, low, high) ** (1 / lift) : means[index]!;
  const reached = RGB_KEYS.map((_, index) => { if (!snapping) return 0; const [black, white] = channel(index), [outBlack, outWhite] = targeted(index); return outBlack! + (outWhite! - outBlack!) * unit(before(index), black, white); }) as RGB;
  const neutral = grayTarget(reached, options.midtones);
  if (kind === "levels") {
    const base = { ...LEVELS, inBlack: low, inWhite: high, gamma: lift };
    if (gray) return base;
    return { ...base, ...Object.fromEntries(RGB_KEYS.map((key, index) => {
      const [black, white] = channel(index), [outBlack, outWhite] = targeted(index);
      const gamma = snapping ? gammaTo(unit(before(index), black, white), unit(neutral[index]!, outBlack!, outWhite!)) : 1;
      return [key, { ...LEVELS, inBlack: black, inWhite: white, gamma, outBlack, outWhite }];
    })) };
  }
  const middle = Math.round(average), points: CurvePoint[] = separate ? IDENTITY : lift !== 1 && middle > low + 2 && middle < high - 2 ? [[low, 0], [middle, 128], [high, 255]] : [[low, 0], [high, 255]];
  if (gray) return { points };
  return { points, ...Object.fromEntries(RGB_KEYS.map((key, index) => {
    const [black, white] = channel(index), [outBlack, outWhite] = targeted(index), input = snapping ? Math.round(means[index]!) : -1, output = Math.round(neutral[index]!);
    const bend = snapping && input > black + 2 && input < white - 2 && output !== Math.round(reached[index]!);
    return [key, bend ? [[black, outBlack], [input, output], [white, outWhite]] : [[black, outBlack], [white, outWhite]]];
  })) };
}

const colorOf = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? value as RGB : null;
const autoColorsOf = (value: unknown): AutoColors | null => {
  const found = value as Record<string, unknown> | null, dark = colorOf(found?.dark), light = colorOf(found?.light), neutral = colorOf(found?.neutral);
  return dark && light && (neutral || found?.neutral === null) ? { dark, light, neutral } : null;
};
/** Find Dark & Light Colors and Snap Neutral Midtones read the pixels the histogram counts, for one pair of clip percentages; null until the host answers. */
export function useAutoColors(source: HistogramSource | undefined, wanted: boolean, shadowClip: number, highlightClip: number): AutoColors | null {
  const projectId = usePhotoWorkspace(state => state.projectId), [found, setFound] = useState<{ key: string; colors: AutoColors } | null>(null);
  const key = wanted && source && !source.target && projectId && isTauri() ? JSON.stringify([projectId, source.document.id, source.document.version, source.layer ?? null, source.below, shadowClip, highlightClip]) : "";
  useEffect(() => {
    if (!key || !source) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      invoke<unknown>("xdesign_photo_auto_colors", { projectId, photoId: source.document.id, version: source.document.version, layer: source.layer ?? null, below: source.below, shadowClip, highlightClip })
        .then(next => { const colors = autoColorsOf(next); if (alive && colors) setFound({ key, colors }); })
        // Until a read succeeds, Auto estimates the colours from the per-channel histograms.
        .catch(() => undefined);
    }, 120);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return key && found?.key === key ? found.colors : null;
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
      latest.current.press(invoke<number[] | null>("xdesign_photo_sample", { projectId, photoId: source.document.id, version: source.document.version, layer: source.layer ?? null, below: source.below, x: point[0], y: point[1], width: 1, height: 1, ...source.target ? { target: source.target } : {} })
        .then(sample => sample?.length === 1 ? [sample[0]!, sample[0]!, sample[0]!] as RGB : sample as RGB | null), event);
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

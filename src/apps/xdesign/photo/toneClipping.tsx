import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { usePhotoWorkspace } from "./runtime";
import { curveLut } from "./curveTools";
import type { CurvePoint, HistogramSource } from "./toneControls";

type Settings = Record<string, unknown>;
type Levels = { inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number };
export type ClipTone = "shadows" | "highlights";
export type TonePixels = { width: number; height: number; rgba: Uint8Array };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const num = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const levelsOf = (value: unknown): Levels => { const tones = value && typeof value === "object" ? value as Settings : {}; return { inBlack: num(tones.inBlack, 0), inWhite: num(tones.inWhite, 255), gamma: num(tones.gamma, 1), outBlack: num(tones.outBlack, 0), outWhite: num(tones.outWhite, 255) }; };
const curveOf = (value: unknown): CurvePoint[] => Array.isArray(value) && value.length >= 2 ? value as CurvePoint[] : [[0, 0], [255, 255]];
const LEVELS = Array.from({ length: 256 }, (_, value) => value);

/** The engine's Levels on 0–255, with the soft shadow toe it gives a midtone gamma over 1. */
function levels(tones: Levels, value: number) {
  const u = clamp((value - tones.inBlack) / Math.max(tones.inWhite - tones.inBlack, 1e-6), 0, 1), gamma = Math.max(tones.gamma, .01);
  let t = u ** (1 / gamma);
  if (gamma > 1) { const line = .93 * 2 ** gamma * u; t = t <= 1e-6 || line <= 1e-6 ? Math.min(t, line) : (t ** -10 + line ** -10) ** -.1; }
  return tones.outBlack + t * (tones.outWhite - tones.outBlack);
}
const lookup = (lut: number[], value: number) => { const x = clamp(value, 0, 255), at = Math.min(254, Math.floor(x)); return lut[at]! + (lut[at + 1]! - lut[at]!) * (x - at); };

/** Each channel's 256 results, composed as the engine does: Levels applies the composite first, Curves last. */
export function toneLuts(kind: "levels" | "curves", values: Settings, channels: string[]): number[][] {
  if (kind === "levels") { const master = levelsOf(values); return channels.map(key => { const tones = key === "composite" ? levelsOf({}) : levelsOf(values[key]); return LEVELS.map(value => levels(tones, levels(master, value))); }); }
  const master = curveLut(curveOf(values.points));
  return channels.map(key => key === "composite" ? master : curveLut(curveOf(values[key])).map(value => lookup(master, value)));
}

/** Photoshop's clipping display: shadows show white with each clipped channel turned off, highlights black with each
 * clipped channel on, so one channel shows black and white. A level is clipped when it gives the same result as 0 or 255. */
export function clippingPixels({ width, height, rgba }: TonePixels, luts: number[][], tone: ClipTone, channels: number[]): Uint8ClampedArray {
  const lit = tone === "highlights", tables = luts.map(lut => { const end = lut[lit ? 255 : 0]!; return lut.map(value => Math.abs(value - end) < .01 === lit ? 255 : 0); });
  const out = new Uint8ClampedArray(width * height * 4);
  for (let at = 0; at < out.length; at += 4) {
    if (tables.length === 1) out[at] = out[at + 1] = out[at + 2] = tables[0]![rgba[at + channels[0]!]!]!;
    else for (let channel = 0; channel < 3; channel++) out[at + channel] = tables[channel]![rgba[at + channels[channel]!]!]!;
    out[at + 3] = 255;
  }
  return out;
}

export function parseTonePixels(data: unknown): TonePixels | null {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : Array.isArray(data) ? Uint8Array.from(data) : null;
  if (!bytes || bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(0, true), height = view.getUint32(4, true);
  return width && height && bytes.length === 8 + width * height * 4 ? { width, height, rgba: bytes.subarray(8) } : null;
}

/** The pixels the histogram reads, at about the size the image is shown, fetched once a clipping display is wanted. */
export function useTonePixels(source: HistogramSource | undefined, canvas: HTMLElement | null | undefined, wanted: boolean, fail: (message: string) => void): TonePixels | null {
  const projectId = usePhotoWorkspace(state => state.projectId);
  const key = source ? JSON.stringify([projectId, source.document.id, source.document.version, source.layer ?? null, source.below]) : "";
  const [loaded, setLoaded] = useState<{ key: string; pixels: TonePixels } | null>(null), asked = useRef("");
  const failed = useRef(fail); failed.current = fail;
  useEffect(() => {
    if (!wanted || !source || !canvas || asked.current === key) return;
    asked.current = key;
    const shown = canvas.getBoundingClientRect(), size = clamp(Math.ceil(Math.max(shown.width, shown.height) * (window.devicePixelRatio || 1)), 256, 2048);
    invoke<ArrayBuffer>("xdesign_photo_tone_pixels", { projectId, photoId: source.document.id, version: source.document.version, layer: source.layer ?? null, below: source.below, size })
      .then(data => { const pixels = parseTonePixels(data); if (pixels) setLoaded({ key, pixels }); else failed.current("Show Clipping received invalid pixels"); })
      .catch(error => { asked.current = ""; failed.current(String(error)); });
  }, [wanted, key, canvas]);
  return loaded?.key === key ? loaded.pixels : null;
}

export function ClippingOverlay({ canvas, pixels, luts, tone, channels }: { canvas: HTMLElement; pixels: TonePixels; luts: number[][]; tone: ClipTone; channels: number[] }) {
  const drawn = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = drawn.current?.getContext("2d");
    context?.putImageData(new ImageData(clippingPixels(pixels, luts, tone, channels), pixels.width, pixels.height), 0, 0);
  });
  return createPortal(<canvas ref={drawn} className="xd-photo-canvas-preview xd-photo-clipping" width={pixels.width} height={pixels.height} aria-hidden="true"/>, canvas);
}

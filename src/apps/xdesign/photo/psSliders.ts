import type { CSSProperties } from "react";
import type { NumberControl } from "./controls";
import { trackStyle } from "./colorControls";

type Scale = { min: number; max: number; step: number; position: (value: number) => number; value: (position: number) => number };
// 1.00 is the middle of Photoshop's Gamma slider, so it moves on a log scale.
const LOG = new Set(["exposure.gamma"]);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const centreOf = (id: string, field: NumberControl) => LOG.has(`${id}.${field.key}`) ? 1 : field.min < 0 && field.max > 0 ? 0 : null;

/** A slider whose zero sits in the middle of the track even when the range is lopsided: each half runs its own scale. Null when the plain range already centres. */
function scaleOf(id: string, field: NumberControl, step: number | "any"): Scale | null {
  const centre = centreOf(id, field), log = LOG.has(`${id}.${field.key}`);
  if (centre === null || !log && Math.abs(centre - field.min - (field.max - centre)) < 1e-9) return null;
  const decimals = typeof step === "number" ? Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) : 6;
  const above = (value: number) => value >= centre;
  const toward = (value: number) => above(value) ? field.max : field.min;
  return {
    min: -1000, max: 1000, step: 1,
    position: raw => {
      const value = clamp(raw, field.min, field.max), bound = toward(value);
      const share = log ? Math.log(value / centre) / Math.log(bound / centre) : (value - centre) / (bound - centre);
      return Math.round(1000 * share) * (above(value) ? 1 : -1) || 0;
    },
    value: position => {
      const p = clamp(position, -1000, 1000) / 1000, bound = p >= 0 ? field.max : field.min;
      const raw = log ? centre * (bound / centre) ** Math.abs(p) : centre + Math.abs(p) * (bound - centre);
      const snapped = typeof step === "number" ? Math.round(raw / step) * step : raw;
      return clamp(Number(snapped.toFixed(decimals)), field.min, field.max);
    },
  };
}

/** Photoshop 2026's slider: round thumb, and a bipolar slider fills from its centre. */
export function psSlider(id: string, field: NumberControl, value: number, step: number | "any", track?: string) {
  const scale = scaleOf(id, field, step), centre = centreOf(id, field);
  const fraction = (at: number) => scale ? (scale.position(at) + 1000) / 2000 : (clamp(at, field.min, field.max) - field.min) / (field.max - field.min);
  const from = centre === null ? 0 : fraction(centre), to = fraction(value), style: CSSProperties = track ? trackStyle(track) : centre === null ? {} : { "--xd-ps-from": `${Math.min(from, to) * 100}%`, "--xd-ps-to": `${Math.max(from, to) * 100}%` } as CSSProperties;
  return { min: scale?.min ?? field.min, max: scale?.max ?? field.max, step: scale?.step ?? step, position: scale ? scale.position(value) : value, toValue: (position: number) => scale ? scale.value(position) : position, style, className: ["is-ps", track && "has-track"].filter(Boolean).join(" ") };
}

const MIXER_TRACKS: Record<string, string> = { red: "linear-gradient(90deg,#3a0808,#ff5a5a)", green: "linear-gradient(90deg,#0a2e0a,#5aff5a)", blue: "linear-gradient(90deg,#0a0a40,#6a6aff)" };
// Each CMYK slider runs from the colour it removes to the colour it adds.
const SELECTIVE_TRACKS: Record<string, string> = { cyan: "linear-gradient(90deg,#ff3a3a,#3affff)", magenta: "linear-gradient(90deg,#3aff3a,#ff3aff)", yellow: "linear-gradient(90deg,#3a3aff,#ffff3a)", black: "linear-gradient(90deg,#fff,#000)" };
export const psTrack = (id: string, key: string): string | undefined => (id === "channelMixer" ? MIXER_TRACKS : id === "selectiveColor" ? SELECTIVE_TRACKS : {})[key];
/** The dialogs laid out like Photoshop 2026; the lead switches more over by adding their ids. */
export const PS_SLIDER_ACTIONS = new Set(["brightnessContrast", "exposure", "hueSaturation", "blackWhite", "channelMixer", "selectiveColor", "gradientMap"]);

// Deterministic 10-step color ladder — a faithful, dependency-free port of
// @ant-design/colors' generate() HSV algorithm.
//
// One seed color → a 10-step ramp [5 lighter, base, 4 darker] where index 5 is
// the seed. The same algorithm on a dark background (darkColorMap blend) yields
// the dark-theme ramp. This is the single source of color coherence for the
// token engine: the LLM never invents a palette — every shade traces back to a
// seed through this math, so ramps stay internally consistent (the canonical
// Ant blue ladder reproduces exactly — see colorRamp.test.ts).

const hueStep = 2;
const saturationStep = 0.16;
const saturationStep2 = 0.05;
const brightnessStep1 = 0.05;
const brightnessStep2 = 0.15;
const lightColorCount = 5;
const darkColorCount = 4;

const darkColorMap: Array<{ index: number; opacity: number }> = [
  { index: 7, opacity: 0.15 },
  { index: 6, opacity: 0.25 },
  { index: 5, opacity: 0.3 },
  { index: 5, opacity: 0.45 },
  { index: 5, opacity: 0.65 },
  { index: 5, opacity: 0.85 },
  { index: 4, opacity: 0.9 },
  { index: 3, opacity: 0.95 },
  { index: 2, opacity: 0.97 },
  { index: 1, opacity: 0.98 },
];

interface RGB {
  r: number;
  g: number;
  b: number;
}
interface HSV {
  h: number;
  s: number;
  v: number;
}

function clampHex(component: number): number {
  return Math.max(0, Math.min(255, Math.round(component)));
}

export function parseHex(input: string): RGB {
  let hex = input.trim().replace(/^#/, "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (c: number) => clampHex(c).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsv({ r, g, b }: RGB): HSV {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    switch (max) {
      case rr:
        h = (gg - bb) / d + (gg < bb ? 6 : 0);
        break;
      case gg:
        h = (bb - rr) / d + 2;
        break;
      default:
        h = (rr - gg) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s, v };
}

function hsvToRgb({ h, s, v }: HSV): RGB {
  const hh = (h / 360) * 6;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const mod = i % 6;
  const r = [v, q, p, p, t, v][mod]!;
  const g = [t, v, v, q, p, p][mod]!;
  const b = [p, p, t, v, v, q][mod]!;
  return { r: r * 255, g: g * 255, b: b * 255 };
}

function mix(back: RGB, front: RGB, amount: number): RGB {
  return {
    r: front.r * amount + back.r * (1 - amount),
    g: front.g * amount + back.g * (1 - amount),
    b: front.b * amount + back.b * (1 - amount),
  };
}

function getHue(hsv: HSV, i: number, light: boolean): number {
  let hue: number;
  if (hsv.h >= 60 && hsv.h <= 240) {
    hue = light ? hsv.h - hueStep * i : hsv.h + hueStep * i;
  } else {
    hue = light ? hsv.h + hueStep * i : hsv.h - hueStep * i;
  }
  if (hue < 0) hue += 360;
  else if (hue >= 360) hue -= 360;
  return hue;
}

function getSaturation(hsv: HSV, i: number, light: boolean): number {
  if (hsv.h === 0 && hsv.s === 0) return hsv.s;
  let saturation: number;
  if (light) saturation = hsv.s - saturationStep * i;
  else if (i === darkColorCount) saturation = hsv.s + saturationStep;
  else saturation = hsv.s + saturationStep2 * i;
  if (saturation > 1) saturation = 1;
  if (light && i === lightColorCount && saturation > 0.1) saturation = 0.1;
  if (saturation < 0.06) saturation = 0.06;
  return Number(saturation.toFixed(2));
}

function getValue(hsv: HSV, i: number, light: boolean): number {
  let value: number;
  if (light) value = hsv.v + brightnessStep1 * i;
  else value = hsv.v - brightnessStep2 * i;
  if (value > 1) value = 1;
  return Number(value.toFixed(2));
}

export type RampMode = "light" | "dark";

/** 10-step ramp for a seed color. Index 5 ≈ the seed. In dark mode each light
 * step is re-blended onto `backgroundColor` (default #141414). */
export function generateRamp(
  baseColor: string,
  opts: { mode?: RampMode; backgroundColor?: string } = {},
): string[] {
  const patterns: string[] = [];
  const baseHsv = rgbToHsv(parseHex(baseColor));

  for (let i = lightColorCount; i > 0; i -= 1) {
    patterns.push(
      rgbToHex(
        hsvToRgb({
          h: getHue(baseHsv, i, true),
          s: getSaturation(baseHsv, i, true),
          v: getValue(baseHsv, i, true),
        }),
      ),
    );
  }
  patterns.push(rgbToHex(hsvToRgb(baseHsv)));
  for (let i = 1; i <= darkColorCount; i += 1) {
    patterns.push(
      rgbToHex(
        hsvToRgb({
          h: getHue(baseHsv, i, false),
          s: getSaturation(baseHsv, i, false),
          v: getValue(baseHsv, i, false),
        }),
      ),
    );
  }

  if (opts.mode === "dark") {
    const bg = parseHex(opts.backgroundColor || "#141414");
    return darkColorMap.map(({ index, opacity }) =>
      rgbToHex(mix(bg, parseHex(patterns[index - 1]!), opacity)),
    );
  }
  return patterns;
}

/** Relative luminance (WCAG) of a hex color, 0..1. */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Pick black or white for legible text on a given background. */
export function readableInk(bg: string, dark = "#0a0a0a", light = "#ffffff"): string {
  return luminance(bg) > 0.5 ? dark : light;
}

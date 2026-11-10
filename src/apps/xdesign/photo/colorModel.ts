export type Rgb = [number, number, number];
export type Hsb = [number, number, number];

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const byte = (value: number) => clamp(Math.round(value), 0, 255);

export function normalizeHex(text: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return null;
  const digits = match[1]!.length === 3 ? [...match[1]!].map(c => c + c).join("") : match[1]!;
  return "#" + digits.toLowerCase();
}

export function hexToRgb(hex: string): Rgb {
  const normal = normalizeHex(hex) ?? "#000000";
  return [1, 3, 5].map(i => parseInt(normal.slice(i, i + 2), 16)) as Rgb;
}

export function rgbToHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map(v => byte(v).toString(16).padStart(2, "0")).join("");
}

/** H 0-360 (0 when grey), S/B 0-100, unrounded so a round trip through hex is exact. */
export function rgbToHsb([r, g, b]: Rgb): Hsb {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn), delta = max - Math.min(rn, gn, bn);
  let h = 0;
  if (delta > 0) {
    if (max === rn) h = ((gn - bn) / delta + 6) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
  }
  return [h * 60, max === 0 ? 0 : (delta / max) * 100, max * 100];
}

export function hsbToRgb([h, s, b]: Hsb): Rgb {
  const hue = (((h % 360) + 360) % 360) / 60, sat = clamp(s, 0, 100) / 100, val = clamp(b, 0, 100) / 100;
  const channel = (n: number) => {
    const k = (n + hue) % 6;
    return byte(255 * val * (1 - sat * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [channel(5), channel(3), channel(1)];
}

/** Hex cannot hold hue at B=0 or saturation at S=0 or B=0; keep the previous ones so a drag does not jump to red. */
export function hsbPreserving(rgb: Rgb, previous: Hsb): Hsb {
  const [h, s, b] = rgbToHsb(rgb);
  if (b === 0) return [previous[0], previous[1], 0];
  if (s === 0) return [previous[0], 0, b];
  return [h, s, b];
}

export function grayPercent(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return Math.round(100 * (1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255));
}

export function grayHex(percent: number): string {
  const v = byte(255 * (1 - clamp(percent, 0, 100) / 100));
  return rgbToHex([v, v, v]);
}

const WEB_STEP = 0x33;
export const isWebSafe = (hex: string) => hexToRgb(hex).every(v => v % WEB_STEP === 0);
export const snapWebChannel = (value: number) => clamp(Math.round(value / WEB_STEP) * WEB_STEP, 0, 255);
export const nearestWebSafe = (hex: string) => rgbToHex(hexToRgb(hex).map(snapWebChannel) as Rgb);

/** The panel ramp: hue left to right, white at the top fading through the pure hue to black at the bottom. */
export function spectrumColor(x: number, y: number): string {
  const hue = hsbToRgb([clamp(x, 0, 1) * 360, 100, 100]);
  const t = clamp(y, 0, 1);
  const [from, to, mix] = t < 0.5 ? [[255, 255, 255], hue, t * 2] : [hue, [0, 0, 0], (t - 0.5) * 2];
  return rgbToHex(from!.map((v, i) => v + (to![i]! - v) * mix) as Rgb);
}

const hueStops = [360, 300, 240, 180, 120, 60, 0].map(h => rgbToHex(hsbToRgb([h, 100, 100])));
export const HUE_STRIP_BACKGROUND = `linear-gradient(to bottom,${hueStops.join(",")})`;
export const SPECTRUM_BACKGROUND = "linear-gradient(to bottom,#fff,rgba(255,255,255,0) 50%,rgba(0,0,0,0) 50%,#000)," +
  `linear-gradient(to right,${[0, 60, 120, 180, 240, 300, 360].map(h => rgbToHex(hsbToRgb([h, 100, 100]))).join(",")})`;
export const hueFieldBackground = (hue: number) =>
  `linear-gradient(to top,#000,rgba(0,0,0,0)),linear-gradient(to right,#fff,${rgbToHex(hsbToRgb([hue, 100, 100]))})`;

export type Lab = [number, number, number];
export type Cmyk = [number, number, number, number];

type Matrix = [number, number, number, number, number, number, number, number, number];
const mul = (m: Matrix, [x, y, z]: Rgb): Rgb => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
function invert(m: Matrix): Matrix {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
}
const SRGB_TO_XYZ_D65: Matrix = [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041];
const BRADFORD_D65_TO_D50: Matrix = [1.0478112, 0.0228866, -0.050127, 0.0295424, 0.9904844, -0.0170491, -0.0092345, 0.0150436, 0.7521316];
const product = (x: Matrix, y: Matrix): Matrix => {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(x[r * 3]! * y[c]! + x[r * 3 + 1]! * y[3 + c]! + x[r * 3 + 2]! * y[6 + c]!);
  return out as Matrix;
};
const XYZ_D50_TO_LINEAR = invert(product(BRADFORD_D65_TO_D50, SRGB_TO_XYZ_D65));
const WHITE_D50: Rgb = [0.96422, 1, 0.82521];
const EPSILON = 216 / 24389, KAPPA = 24389 / 27;
const toLinear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB to CIELAB with the D50 white, which is what Photoshop reports: linear light, XYZ D65, Bradford to D50. L 0-100, a/b about -128..127, unrounded. */
export function rgbToLab(rgb: Rgb): Lab {
  const xyz = mul(BRADFORD_D65_TO_D50, mul(SRGB_TO_XYZ_D65, rgb.map(toLinear) as Rgb));
  const [fx, fy, fz] = xyz.map((v, i) => { const t = v / WHITE_D50[i]!; return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116; }) as Rgb;
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Inverse of rgbToLab; colours outside sRGB are clamped to the nearest channel values. */
export function labToRgb([l, a, b]: Lab): Rgb {
  const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const xyz = [fx, fy, fz].map((f, i) => WHITE_D50[i]! * (f ** 3 > EPSILON ? f ** 3 : (116 * f - 16) / KAPPA)) as Rgb;
  return mul(XYZ_D50_TO_LINEAR, xyz).map(v => byte(fromLinear(clamp(v, 0, 1)))) as Rgb;
}

/**
 * Plain K = 1 - max(R,G,B) separation, 0-100. The host exposes profile conversion only for a whole document, so Photoshop's working
 * profile (U.S. Web Coated SWOP v2) cannot be applied to a single colour; values therefore differ from Photoshop's (pure black is K 100, not C75 M68 Y67 K90).
 */
export function rgbToCmyk([r, g, b]: Rgb): Cmyk {
  const k = 1 - Math.max(r, g, b) / 255;
  if (k >= 1) return [0, 0, 0, 100];
  return [(1 - r / 255 - k) / (1 - k) * 100, (1 - g / 255 - k) / (1 - k) * 100, (1 - b / 255 - k) / (1 - k) * 100, k * 100];
}

export function cmykToRgb([c, m, y, k]: Cmyk): Rgb {
  const white = 1 - clamp(k, 0, 100) / 100;
  return [c, m, y].map(v => byte(255 * (1 - clamp(v, 0, 100) / 100) * white)) as Rgb;
}

/** 8-bit hex cannot hold typed Lab or CMYK values, so a remembered value stands in while it still maps to the same colour; otherwise it is recomputed. */
export function cmykFor(hex: string, remembered?: Cmyk): Cmyk {
  return remembered && rgbToHex(cmykToRgb(remembered)) === hex ? remembered : rgbToCmyk(hexToRgb(hex));
}
export function labFor(hex: string, remembered?: Lab): Lab {
  return remembered && rgbToHex(labToRgb(remembered)) === hex ? remembered : rgbToLab(hexToRgb(hex));
}

const hsbHexOf = (h: number, s: number, b: number) => rgbToHex(hsbToRgb([h, s, b]));
/** Brightness Cube field: hue left to right, saturation falling to the grey of the current brightness at the bottom. */
export const brightnessFieldBackground = (brightness: number) =>
  `linear-gradient(to top,${hsbHexOf(0, 0, brightness)},rgba(0,0,0,0)),linear-gradient(to right,${[0, 60, 120, 180, 240, 300, 360].map(h => hsbHexOf(h, 100, brightness)).join(",")})`;
export const brightnessStripBackground = (hue: number, saturation: number) =>
  `linear-gradient(to top,#000,${hsbHexOf(hue, saturation, 100)})`;

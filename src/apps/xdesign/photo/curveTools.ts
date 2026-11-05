import type { CurvePoint } from "./toneControls";

/** Photoshop's Curve Display Options; Light or Pigment is chosen per dialog from the image mode. */
export type CurveDisplay = { detailed: boolean; overlays: boolean; histogram: boolean; baseline: boolean; intersection: boolean };
export const CURVE_DISPLAY: CurveDisplay = { detailed: false, overlays: true, histogram: true, baseline: true, intersection: true };
const STORED = "xdesign.photo.curveDisplay";
export function readCurveDisplay(): CurveDisplay {
  try { const stored = JSON.parse(localStorage.getItem(STORED) ?? "null"); return stored && typeof stored === "object" ? { ...CURVE_DISPLAY, ...stored } : { ...CURVE_DISPLAY }; }
  catch { return { ...CURVE_DISPLAY }; }
}
export const saveCurveDisplay = (display: CurveDisplay) => localStorage.setItem(STORED, JSON.stringify(display));

/** The engine's natural cubic spline, so the drawn curve is the one that gets applied. */
export function curveLut(points: CurvePoint[]): number[] {
  const xs: number[] = [], ys: number[] = [];
  for (const [x, y] of points.map(([x, y]) => [x / 255, y / 255]).sort((a, b) => a[0]! - b[0]!)) if (!xs.length || x! - xs[xs.length - 1]! > 1e-6) { xs.push(x!); ys.push(y!); }
  const n = xs.length;
  if (!n) return Array.from({ length: 256 }, (_, i) => i);
  const m2 = new Array<number>(n).fill(0);
  if (n > 2) {
    const c = new Array<number>(n).fill(0), d = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const h0 = xs[i]! - xs[i - 1]!, h1 = xs[i + 1]! - xs[i]!, a = h0 / 6, b = (h0 + h1) / 3;
      const r = (ys[i + 1]! - ys[i]!) / h1 - (ys[i]! - ys[i - 1]!) / h0, denom = b - a * c[i - 1]!;
      c[i] = h1 / 6 / denom; d[i] = (r - a * d[i - 1]!) / denom;
    }
    for (let i = n - 2; i > 0; i--) m2[i] = d[i]! - c[i]! * m2[i + 1]!;
  }
  return Array.from({ length: 256 }, (_, value) => {
    const t = value / 255;
    if (t <= xs[0]!) return ys[0]! * 255;
    if (t >= xs[n - 1]!) return ys[n - 1]! * 255;
    let i = 0;
    while (i < n - 2 && t > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!, a = (xs[i + 1]! - t) / h, b = (t - xs[i]!) / h;
    return Math.max(0, Math.min(1, a * ys[i]! + b * ys[i + 1]! + ((a ** 3 - a) * m2[i]! + (b ** 3 - b) * m2[i + 1]!) * h * h / 6)) * 255;
  });
}

const level = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** Photoshop's Curves holds 16 points; the engine accepts 19, so .acv files with more still load. */
export const CURVE_POINTS = 16;

/** A drawn curve is refitted to a few points: each new point goes where the spline strays furthest. */
export function fitCurve(target: number[], maxPoints = CURVE_POINTS, tolerance = 1): CurvePoint[] {
  const points: CurvePoint[] = [[0, target[0]!], [255, target[255]!]];
  while (points.length < maxPoints) {
    const lut = curveLut(points);
    let worst = -1, error = tolerance;
    for (let x = 1; x < 255; x++) if (!points.some(([at]) => at === x) && Math.abs(lut[x]! - target[x]!) > error) { worst = x; error = Math.abs(lut[x]! - target[x]!); }
    if (worst < 0) break;
    points.push([worst, target[worst]!]); points.sort((a, b) => a[0] - b[0]);
  }
  return points.map(([x, y]) => [x, level(y)]);
}

/** A pencil stroke from `from` to `to`, drawn into a copy of the curve's 256 values. */
export function drawCurve(values: number[], from: CurvePoint | null, to: CurvePoint): number[] {
  const next = [...values], start = from ?? to, [x0, y0] = [level(start[0]), start[1]], [x1, y1] = [level(to[0]), to[1]];
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) next[x] = Math.max(0, Math.min(255, x0 === x1 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0)));
  return next;
}

/** Smooth: each click averages the curve's values over a few levels either side, as Photoshop's does. */
export function smoothCurve(points: CurvePoint[], radius = 6): CurvePoint[] {
  const values = curveLut(points);
  return fitCurve(values.map((_, x) => { let sum = 0; for (let at = x - radius; at <= x + radius; at++) sum += values[Math.max(0, Math.min(255, at))]!; return sum / (radius * 2 + 1); }));
}

const DIAGONAL: CurvePoint[] = [[0, 0], [255, 255]];
const inRange = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 255;
/** Whether a value is a curve CurveEditor could have made: 2 to 16 points within 0–255, rising left to right. */
export const isToningCurve = (value: unknown): value is CurvePoint[] => Array.isArray(value) && value.length >= 2 && value.length <= CURVE_POINTS
  && value.every((point, i) => Array.isArray(point) && point.length === 2 && inRange(point[0]) && inRange(point[1]) && (i === 0 || point[0] > value[i - 1][0]));
/** HDR Toning's Toning Curve as the dialog keeps it, or the diagonal for anything else. */
export const toningCurve = (value: unknown): CurvePoint[] => (isToningCurve(value) ? value : DIAGONAL).map(([x, y]) => [x, y]);

/** The engine joins HDR Toning's curve points with straight lines, so the spline the dialog draws is sent level by level. */
export function curveSamples(points: CurvePoint[]): CurvePoint[] | undefined {
  const lut = curveLut(points);
  return lut.every((y, x) => Math.abs(y - x) < .005) ? undefined : lut.map((y, x) => [x, Math.round(y * 100) / 100]);
}

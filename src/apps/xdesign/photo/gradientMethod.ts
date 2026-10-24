export type GradientMethod = "perceptual" | "linear" | "classic" | "smooth" | "stripes";
export type GradientStop = [number, string];
export const GRADIENT_METHODS: [GradientMethod, string][] = [["perceptual", "Perceptual"], ["linear", "Linear"], ["classic", "Classic"], ["smooth", "Smooth"], ["stripes", "Stripes"]];

type Vec3 = [number, number, number];
const lin = (c: number) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const enc = (c: number) => { const v = Math.max(0, Math.min(1, c)); return v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055; };
const toOklab = (rgb: Vec3): Vec3 => {
  const [r, g, b] = rgb.map(lin) as Vec3;
  const l = Math.cbrt(.41222146 * r + .53633255 * g + .051445995 * b), m = Math.cbrt(.2119035 * r + .6806995 * g + .10739696 * b), s = Math.cbrt(.08830246 * r + .28171885 * g + .6299787 * b);
  return [.21045426 * l + .7936178 * m - .004072047 * s, 1.9779985 * l - 2.4285922 * m + .4505937 * s, .025904037 * l + .78277177 * m - .80867577 * s];
};
const fromOklab = ([L, a, b]: Vec3): Vec3 => {
  const l = (L + .39633778 * a + .21580376 * b) ** 3, m = (L - .105561346 * a - .06385417 * b) ** 3, s = (L - .08948418 * a - 1.2914855 * b) ** 3;
  return [4.0767417 * l - 3.3077116 * m + .23096994 * s, -1.268438 * l + 2.6097574 * m - .34131938 * s, -.0041960863 * l - .7034186 * m + 1.7076147 * s].map(enc) as Vec3;
};
const rgbOf = (hex: string): Vec3 => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255) as Vec3;
const hexOf = (rgb: Vec3) => "#" + rgb.map(c => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0")).join("");

/** Colour at `t` between sorted stops; `smooth` blends linear interpolation with a Catmull-Rom spline (half-slope ends). */
function evaluate(stops: [number, Vec3][], smooth: number, t: number): Vec3 {
  const n = stops.length;
  if (t <= stops[0]![0]) return stops[0]![1];
  if (t >= stops[n - 1]![0]) return stops[n - 1]![1];
  const i = Math.max(0, stops.findIndex((stop, at) => at < n - 1 && t >= stop[0] && t <= stops[at + 1]![0]));
  const [t0, p0] = stops[i]!, [t1, p1] = stops[i + 1]!, h = Math.max(t1 - t0, 1e-6), u = (t - t0) / h;
  const tangent = (k: number) => {
    const [a, b] = k === 0 ? [0, 1] : k === n - 1 ? [n - 2, n - 1] : [k - 1, k + 1], d = Math.max(stops[b]![0] - stops[a]![0], 1e-6), half = k === 0 || k === n - 1 ? .5 : 1;
    return [0, 1, 2].map(c => (stops[b]![1][c]! - stops[a]![1][c]!) / d * half);
  };
  const m0 = tangent(i), m1 = tangent(i + 1), u2 = u * u, u3 = u2 * u;
  return [0, 1, 2].map(c => {
    const linear = p0[c]! + (p1[c]! - p0[c]!) * u;
    const spline = (2 * u3 - 3 * u2 + 1) * p0[c]! + (u3 - 2 * u2 + u) * h * m0[c]! + (-2 * u3 + 3 * u2) * p1[c]! + (u3 - u2) * h * m1[c]!;
    return linear + (spline - linear) * smooth;
  }) as Vec3;
}

/**
 * Photoshop's gradient Method as dense stops, since the engine blends stops linearly in sRGB. The model follows the
 * engine's own PSD import bake: Perceptual blends in Oklab, Linear in linear light, Classic in sRGB at the classic
 * 100% Smoothness. Smooth (Oklab at full Smoothness) and Stripes (each colour held to the middle of its segment) are
 * approximations of Photoshop's later additions. The blends give `samples + 1` stops, inside the engine's 64-stop limit.
 */
export function bakeGradient(stops: GradientStop[], method: GradientMethod, samples = 63): GradientStop[] {
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  if (sorted.length < 2) return sorted;
  if (method === "stripes") return [sorted[0]!, ...sorted.slice(1).flatMap(([t, color], at) => {
    const [before, held] = sorted[at]!, middle = (before + t) / 2;
    return [[Math.max(before, middle - 1e-4), held], [middle, color]] as GradientStop[];
  }), sorted[sorted.length - 1]!];
  const space = method === "linear" ? (rgb: Vec3) => rgb.map(lin) as Vec3 : method === "classic" ? (rgb: Vec3) => rgb : toOklab;
  const back = method === "linear" ? (v: Vec3) => v.map(enc) as Vec3 : method === "classic" ? (v: Vec3) => v : fromOklab;
  const points = sorted.map(([t, color]) => [t, space(rgbOf(color))] as [number, Vec3]), smooth = method === "classic" || method === "smooth" ? 1 : 0;
  return Array.from({ length: samples + 1 }, (_, k) => { const t = k / samples; return [Math.round(t * 1e4) / 1e4, hexOf(back(evaluate(points, smooth, t)))] as GradientStop; });
}

// Session memory of baked Gradient Maps, keyed by what the engine stores, so reopening one shows the stops the user set.
const bakedMaps = new Map<string, { at: number[]; stops: GradientStop[]; method: GradientMethod }>();
const mapKey = (stops: GradientStop[]) => stops.map(([, color]) => color.toLowerCase()).join();
const hexStops = (stops: unknown): stops is GradientStop[] => Array.isArray(stops) && stops.length >= 2 && stops.every(stop => Array.isArray(stop) && typeof stop[0] === "number" && typeof stop[1] === "string" && /^#[\da-f]{6}$/i.test(stop[1]));

/**
 * Gradient Map params for the engine. Classic goes as is: it is the engine's own model of a map (Classic, Smoothness 0),
 * so imported and saved maps reopen unchanged. The other methods go as baked stops.
 */
export function gradientMapParams(values: Record<string, unknown>): Record<string, unknown> {
  const { method, ...params } = values;
  if (!hexStops(values.stops) || !GRADIENT_METHODS.some(([id]) => id === method) || method === "classic") return params;
  const stops = bakeGradient(values.stops, method as GradientMethod);
  if (stops.length > 64) return params;
  bakedMaps.set(mapKey(stops), { at: stops.map(([t]) => t), stops: values.stops, method: method as GradientMethod });
  if (bakedMaps.size > 256) bakedMaps.delete(bakedMaps.keys().next().value!);
  return { ...params, stops };
}

/** A stored Gradient Map's editable values: the stops and Method it was baked from, else its stops as Classic. */
export function gradientMapValues(params: Record<string, unknown>): Record<string, unknown> {
  const stored = hexStops(params.stops) ? params.stops : [], key = mapKey(stored), found = bakedMaps.get(key);
  // The engine keeps positions as f32.
  const source = found?.at.every((t, at) => Math.abs(t - stored[at]![0]) < 1e-5) ? found : undefined;
  if (source) { bakedMaps.delete(key); bakedMaps.set(key, source); }
  return source ? { ...params, stops: structuredClone(source.stops), method: source.method } : { ...params, method: "classic" };
}

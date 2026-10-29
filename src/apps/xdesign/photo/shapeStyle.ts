export type GradientStyle = "linear" | "radial" | "angle" | "reflected" | "diamond";
export type ShapeGradient = { stops: [number, string][]; opacity: [number, number][]; style: GradientStyle; angle: number; scale: number; reverse: boolean };
export type PaintKind = "solid" | "gradient" | "pattern";
/** `id` is a preset id from `pattern.list`; `name` is only shown. `scale` is %, `angle` degrees counter-clockwise. */
export type ShapePattern = { id: string; name: string; scale: number; angle: number };
export type StrokeAlign = "inside" | "center" | "outside";
export type StrokeCap = "butt" | "round" | "square";
export type StrokeJoin = "miter" | "round" | "bevel";
/** `fillColor` null follows the foreground colour, as the old checkbox did. Dashes are multiples of the stroke width; empty is a solid line. */
export type ShapeStyle = {
  fill: boolean; fillKind: PaintKind; fillColor: string | null; fillGradient: ShapeGradient; fillPattern: ShapePattern;
  stroke: boolean; strokeKind: PaintKind; strokeColor: string; strokeGradient: ShapeGradient; strokePattern: ShapePattern; strokeWidth: number;
  align: StrokeAlign; cap: StrokeCap; join: StrokeJoin; dashes: number[];
};

export const GRADIENT_STYLES: readonly GradientStyle[] = ["linear", "radial", "angle", "reflected", "diamond"];
export const STROKE_ALIGNS = [["inside", "Inside"], ["center", "Center"], ["outside", "Outside"]] as const;
export const STROKE_CAPS = [["butt", "Butt"], ["round", "Round"], ["square", "Square"]] as const;
export const STROKE_JOINS = [["miter", "Miter"], ["round", "Round"], ["bevel", "Bevel"]] as const;
export const MAX_DASHES = 6;

const DEFAULT_GRADIENT: ShapeGradient = { stops: [[0, "#000000"], [1, "#ffffff"]], opacity: [[0, 1], [1, 1]], style: "linear", angle: 90, scale: 100, reverse: false };
const DEFAULT_PATTERN: ShapePattern = { id: "", name: "", scale: 100, angle: 0 };
const PAINT_KINDS: readonly PaintKind[] = ["solid", "gradient", "pattern"];
export const DEFAULT_SHAPE_STYLE: ShapeStyle = {
  fill: true, fillKind: "solid", fillColor: null, fillGradient: DEFAULT_GRADIENT, fillPattern: DEFAULT_PATTERN,
  stroke: false, strokeKind: "solid", strokeColor: "#000000", strokeGradient: DEFAULT_GRADIENT, strokePattern: DEFAULT_PATTERN, strokeWidth: 3,
  align: "inside", cap: "butt", join: "miter", dashes: [],
};

export const STROKE_PRESETS: readonly { name: string; patch: Partial<ShapeStyle> }[] = [
  { name: "Solid", patch: { dashes: [] } },
  { name: "Dashed", patch: { dashes: [4, 2], cap: "butt" } },
  { name: "Dotted", patch: { dashes: [0, 2], cap: "round" } },
];
const sameDashes = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => value === b[index]);
export function strokePresetOf(style: ShapeStyle): string {
  return STROKE_PRESETS.find(({ patch }) => sameDashes(patch.dashes!, style.dashes) && (!patch.cap || patch.cap === style.cap))?.name ?? "Custom";
}

/** One More Options field: a pair with only a dash or a gap uses it for both, and pairs stop at the first empty one, as in Photoshop. */
export function setDash(dashes: readonly number[], index: number, value: number | null): number[] {
  const slots: (number | undefined)[] = Array.from({ length: MAX_DASHES }, (_, i) => dashes[i]), out: number[] = [];
  slots[index] = value ?? undefined;
  for (let i = 0; i < MAX_DASHES; i += 2) { const dash = slots[i], gap = slots[i + 1]; if (dash === undefined && gap === undefined) break; out.push(dash ?? gap!, gap ?? dash!); }
  return out.some(entry => entry > 0) ? out : [];
}

const HEX = /^#[0-9a-f]{6}$/i;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hexOr = (value: unknown, fallback: string) => typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback;
const boolOr = (value: unknown, fallback: boolean) => typeof value === "boolean" ? value : fallback;
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => options.includes(value as T) ? value as T : fallback;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const inRange = (value: unknown, min: number, max: number, fallback: number) => finite(value) && value >= min && value <= max ? value : fallback;
const unit = (value: unknown) => finite(value) && value >= 0 && value <= 1;

function sanitizeGradient(value: unknown): ShapeGradient {
  const g = record(value);
  const stops = Array.isArray(g.stops) && g.stops.length >= 2 && g.stops.every(stop => Array.isArray(stop) && unit(stop[0]) && typeof stop[1] === "string" && HEX.test(stop[1])) ? (g.stops as [number, string][]).map(([at, hex]): [number, string] => [at, hex.toLowerCase()]) : DEFAULT_GRADIENT.stops;
  const opacity = Array.isArray(g.opacity) && g.opacity.length >= 1 && g.opacity.every(stop => Array.isArray(stop) && unit(stop[0]) && unit(stop[1])) ? (g.opacity as [number, number][]).map(([at, alpha]): [number, number] => [at, alpha]) : DEFAULT_GRADIENT.opacity;
  return { stops, opacity, style: oneOf(g.style, GRADIENT_STYLES, "linear"), angle: inRange(g.angle, -180, 180, 90), scale: inRange(g.scale, 10, 150, 100), reverse: boolOr(g.reverse, false) };
}

function sanitizePattern(value: unknown): ShapePattern {
  const p = record(value), text = (entry: unknown) => typeof entry === "string" ? entry : "";
  return { id: text(p.id), name: text(p.name), scale: inRange(p.scale, 1, 1000, 100), angle: inRange(p.angle, -180, 180, 0) };
}

function sanitizeDashes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const dashes = value.filter((entry): entry is number => finite(entry) && entry >= 0 && entry <= 1000).slice(0, MAX_DASHES);
  if (!dashes.some(entry => entry > 0)) return [];
  return dashes.length % 2 ? [...dashes, ...dashes].slice(0, Math.min(MAX_DASHES, dashes.length * 2)) : dashes;
}

export function sanitizeShapeStyle(value: unknown): ShapeStyle {
  const s = record(value), d = DEFAULT_SHAPE_STYLE;
  return {
    fill: boolOr(s.fill, d.fill), fillKind: oneOf(s.fillKind, PAINT_KINDS, d.fillKind), fillColor: typeof s.fillColor === "string" && HEX.test(s.fillColor) ? s.fillColor.toLowerCase() : null, fillGradient: sanitizeGradient(s.fillGradient), fillPattern: sanitizePattern(s.fillPattern),
    stroke: boolOr(s.stroke, d.stroke), strokeKind: oneOf(s.strokeKind, PAINT_KINDS, d.strokeKind), strokeColor: hexOr(s.strokeColor, d.strokeColor), strokeGradient: sanitizeGradient(s.strokeGradient), strokePattern: sanitizePattern(s.strokePattern),
    strokeWidth: finite(s.strokeWidth) ? Math.max(0, Math.min(1000, s.strokeWidth)) : d.strokeWidth,
    align: oneOf(s.align, ["inside", "center", "outside"], d.align), cap: oneOf(s.cap, ["butt", "round", "square"], d.cap), join: oneOf(s.join, ["miter", "round", "bevel"], d.join), dashes: sanitizeDashes(s.dashes),
  };
}

const channels = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const byte = (value: number) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0");
function sample<T>(stops: readonly [number, T][], at: number, mix: (a: T, b: T, t: number) => T): T {
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  const after = sorted.findIndex(([t]) => t >= at);
  if (after <= 0) return sorted[after < 0 ? sorted.length - 1 : 0]![1];
  const [t0, a] = sorted[after - 1]!, [t1, b] = sorted[after]!;
  return t1 === t0 ? b : mix(a, b, (at - t0) / (t1 - t0));
}
const mixHex = (a: string, b: string, t: number) => { const [x, y] = [channels(a), channels(b)]; return `#${x.map((value, index) => byte(value + (y[index]! - value) * t)).join("")}`; };

/** The engine takes one stop list with alpha, so colour and opacity stops merge at every position either has. */
export function gradientFill(gradient: ShapeGradient): { gradient: { stops: [number, string][]; style: GradientStyle; angle: number; scale: number; reverse: boolean } } {
  const positions = [...new Set([...gradient.stops.map(([at]) => at), ...gradient.opacity.map(([at]) => at)])].sort((a, b) => a - b);
  const stops = positions.map((at): [number, string] => [at, `${sample(gradient.stops, at, mixHex)}${byte(sample(gradient.opacity, at, (a, b, t) => a + (b - a) * t) * 255)}`]);
  return { gradient: { stops, style: gradient.style, angle: gradient.angle, scale: gradient.scale, reverse: gradient.reverse } };
}

const patternFill = ({ id, scale, angle }: ShapePattern) => ({ pattern: id, scale, angle });
function strokeParams(style: ShapeStyle) {
  return { width: style.strokeWidth, ...(style.strokeKind === "gradient" ? { fill: gradientFill(style.strokeGradient) } : style.strokeKind === "pattern" ? { fill: patternFill(style.strokePattern) } : { color: style.strokeColor }), align: style.align, cap: style.cap, join: style.join, dashes: style.dashes };
}
const fillParam = (style: ShapeStyle, foreground: unknown) => !style.fill ? null : style.fillKind === "gradient" ? gradientFill(style.fillGradient) : style.fillKind === "pattern" ? patternFill(style.fillPattern) : style.fillColor ?? foreground;

/** A saved pattern whose preset is gone draws with the first preset, or with Solid Color when there are none, so a stale choice never fails the shape. */
export function withPatterns(style: ShapeStyle, presets: readonly { id: string; name: string }[]): ShapeStyle {
  const fix = (kind: PaintKind, pattern: ShapePattern) => kind !== "pattern" || presets.some(preset => preset.id === pattern.id) ? null : presets[0] ? { kind, pattern: { ...pattern, id: presets[0].id, name: presets[0].name } } : { kind: "solid" as const, pattern };
  const fill = fix(style.fillKind, style.fillPattern), stroke = fix(style.strokeKind, style.strokePattern);
  return !fill && !stroke ? style : { ...style, ...(fill ? { fillKind: fill.kind, fillPattern: fill.pattern } : {}), ...(stroke ? { strokeKind: stroke.kind, strokePattern: stroke.pattern } : {}) };
}

export function shapeStyleParams(style: ShapeStyle, foreground: unknown): Record<string, unknown> {
  return { fill: fillParam(style, foreground), ...(style.stroke ? { stroke: strokeParams(style) } : {}) };
}

const FILL_KEYS: readonly (keyof ShapeStyle)[] = ["fill", "fillKind", "fillColor", "fillGradient", "fillPattern"];
/** A shape layer's edit carries only the fill or stroke the patch changed, so one control is one history step that leaves the rest alone. */
export function shapeEditParams(base: ShapeStyle, patch: Partial<ShapeStyle>, foreground: unknown): Record<string, unknown> {
  const next = { ...base, ...patch }, keys = Object.keys(patch) as (keyof ShapeStyle)[];
  return {
    ...(keys.some(key => FILL_KEYS.includes(key)) ? { fill: fillParam(next, foreground) } : {}),
    ...(keys.some(key => !FILL_KEYS.includes(key)) ? { stroke: next.stroke ? strokeParams(next) : null } : {}),
  };
}

function gradientFromInfo(value: Record<string, unknown>): ShapeGradient {
  const stops = Array.isArray(value.stops) ? value.stops.filter((stop): stop is [number, string] => Array.isArray(stop) && unit(stop[0]) && typeof stop[1] === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(stop[1])) : [];
  return sanitizeGradient({ ...value, stops: stops.map(([at, hex]) => [at, hex.slice(0, 7)]), opacity: stops.map(([at, hex]) => [at, hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1]) });
}
function paintFromInfo(value: unknown): { kind: PaintKind; color?: string; gradient?: ShapeGradient; pattern?: ShapePattern } | null {
  if (typeof value === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) return { kind: "solid", color: value.slice(0, 7).toLowerCase() };
  const paint = record(value);
  if (typeof paint.pattern === "string" && paint.pattern) return { kind: "pattern", pattern: sanitizePattern({ ...paint, id: paint.pattern }) };
  return paint.gradient ? { kind: "gradient", gradient: gradientFromInfo(record(paint.gradient)) } : null;
}

/** The bar's style for a selected shape layer, from `shape.info`; keys it leaves out keep `base`. */
export function styleFromShapeInfo(info: unknown, base: ShapeStyle): ShapeStyle {
  const i = record(info), next: Record<string, unknown> = { ...base };
  if ("fill" in i) {
    next.fill = i.fill !== null;
    const paint = paintFromInfo(i.fill);
    if (paint?.kind === "solid") Object.assign(next, { fillKind: "solid", fillColor: paint.color });
    if (paint?.kind === "gradient") Object.assign(next, { fillKind: "gradient", fillGradient: paint.gradient });
    if (paint?.kind === "pattern") Object.assign(next, { fillKind: "pattern", fillPattern: paint.pattern });
  }
  if ("stroke" in i) {
    const stroke = i.stroke === null ? null : record(i.stroke);
    next.stroke = !!stroke;
    if (stroke) {
      const paint = paintFromInfo(stroke.fill ?? stroke.color);
      if (paint?.kind === "solid") Object.assign(next, { strokeKind: "solid", strokeColor: paint.color });
      if (paint?.kind === "gradient") Object.assign(next, { strokeKind: "gradient", strokeGradient: paint.gradient });
      if (paint?.kind === "pattern") Object.assign(next, { strokeKind: "pattern", strokePattern: paint.pattern });
      for (const key of ["align", "cap", "join", "dashes"] as const) if (key in stroke) next[key] = stroke[key];
      if ("width" in stroke) next.strokeWidth = stroke.width;
    }
  }
  return sanitizeShapeStyle(next);
}

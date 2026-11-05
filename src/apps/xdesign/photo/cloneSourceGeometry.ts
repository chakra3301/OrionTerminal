import type { PhotoCloneSource } from "./types";

type Point = readonly [number, number];
const finitePoint = (point: Point | null | undefined): point is Point => !!point && point.every(Number.isFinite);

export function cloneSourcePoint(slot: PhotoCloneSource | undefined, at: Point | null, start: Point | null, params: Record<string, unknown>): [number, number] | null {
  if (!slot || !finitePoint(slot.source) || !finitePoint(at)) return null;
  const anchor = params.aligned === false ? start : slot.anchor ?? start;
  if (!finitePoint(anchor)) return [...slot.source];
  const explicit = ["scale", "rotation", "flipH", "flipV"].some(key => key in params);
  const scale = explicit ? Array.isArray(params.scale) ? params.scale : [100, 100] : [slot.width, slot.height];
  const numeric = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const rotation = explicit ? numeric(params.rotation, 0) : slot.rotation;
  if (!Number.isFinite(rotation) || !scale.every(value => typeof value !== "number" || Number.isFinite(value))) return null;
  const sx = Math.max(numeric(scale[0], 100) / 100, .001) * ((explicit ? params.flipH === true : slot.flipH) ? -1 : 1);
  const sy = Math.max(numeric(scale[1], 100) / 100, .001) * ((explicit ? params.flipV === true : slot.flipV) ? -1 : 1);
  const angle = -rotation * Math.PI / 180, sine = Math.sin(angle), cosine = Math.cos(angle), dx = at[0] - anchor[0], dy = at[1] - anchor[1];
  const result: [number, number] = [slot.source[0] + (cosine * dx + sine * dy) / sx, slot.source[1] + (-sine * dx + cosine * dy) / sy];
  return result.every(Number.isFinite) ? result : null;
}

/** The SVG transform that lays the image over the brush so each source pixel sits where it will be painted. `cloneSourcePoint` is affine in `at`, so three samples give its inverse. */
export function cloneOverlayTransform(slot: PhotoCloneSource | undefined, at: Point, start: Point | null, params: Record<string, unknown>): string | null {
  const s0 = cloneSourcePoint(slot, at, start, params), s1 = cloneSourcePoint(slot, [at[0] + 1, at[1]], start, params), s2 = cloneSourcePoint(slot, [at[0], at[1] + 1], start, params);
  if (!s0 || !s1 || !s2) return null;
  const a = s1[0] - s0[0], b = s1[1] - s0[1], c = s2[0] - s0[0], d = s2[1] - s0[1], det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return `translate(${at[0] - s0[0]} ${at[1] - s0[1]})`;
  const m = [d / det, -b / det, -c / det, a / det] as const;
  return `matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} ${at[0] - (m[0] * s0[0] + m[2] * s0[1])} ${at[1] - (m[1] * s0[0] + m[3] * s0[1])})`;
}

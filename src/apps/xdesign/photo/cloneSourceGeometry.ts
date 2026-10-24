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

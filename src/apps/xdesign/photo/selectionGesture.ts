import type { PaintOptions } from "./PaintToolOptions";

export const SELECTION_TOOLS = ["select.rect", "ellipseSelection", "select.lasso", "polygonLasso", "magneticLasso", "select.magicWand", "select.quick", "select.object", "singleRowSelection", "singleColumnSelection"];
export const LINE_SELECTION_TOOLS = ["singleRowSelection", "singleColumnSelection"];
export const RECTANGLE_TOOLS = ["select.rect", "ellipseSelection", "select.object", "crop"];
export type SelectionMode = "replace" | "add" | "subtract" | "intersect";
export type GestureModifiers = { shiftKey: boolean; altKey: boolean };
type XY = readonly number[];
export type GestureRectangle = { x: number; y: number; width: number; height: number };
const coordinate = (value: number) => Number.isFinite(value) && value >= -2147483648 && value <= 2147483647;

export function selectionGestureMode(mode: string, modifiers: GestureModifiers, tool: string): SelectionMode {
  const selected = modifiers.shiftKey && modifiers.altKey ? "intersect" : modifiers.altKey ? "subtract" : modifiers.shiftKey ? "add" : mode;
  // Quick Selection's native engine treats unsupported modes as Add.
  if (tool === "select.quick" && selected === "intersect") return modifiers.altKey ? "subtract" : "replace";
  return ["replace", "add", "subtract", "intersect"].includes(selected) ? selected as SelectionMode : "replace";
}

export function gestureRectangle(first: XY, last: XY, options: PaintOptions, start: GestureModifiers, current: GestureModifiers): GestureRectangle | null {
  if (![first[0], first[1], last[0], last[1]].every(value => typeof value === "number" && coordinate(value))) return null;
  let dx = last[0]! - first[0]!, dy = last[1]! - first[1]!;
  const fixed = options.style === "fixedSize";
  if (fixed) { dx = Number(options.fixedWidth); dy = Number(options.fixedHeight); }
  else if (options.style === "fixedRatio" || current.shiftKey && !start.shiftKey) {
    const ratio = options.style === "fixedRatio" ? Number(options.ratioWidth) / Number(options.ratioHeight) : 1;
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    const width = Math.max(Math.abs(dx), Math.abs(dy) * ratio);
    dx = (dx < 0 ? -1 : 1) * width; dy = (dy < 0 ? -1 : 1) * width / ratio;
  }
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || fixed && (dx <= 0 || dy <= 0)) return null;
  const center = options.fromCenter === true || current.altKey && !start.altKey;
  const x0 = Math.round(center ? first[0]! - Math.abs(dx) * (fixed ? .5 : 1) : Math.min(first[0]!, first[0]! + dx));
  const y0 = Math.round(center ? first[1]! - Math.abs(dy) * (fixed ? .5 : 1) : Math.min(first[1]!, first[1]! + dy));
  const x1 = Math.round(center ? first[0]! + Math.abs(dx) * (fixed ? .5 : 1) : Math.max(first[0]!, first[0]! + dx));
  const y1 = Math.round(center ? first[1]! + Math.abs(dy) * (fixed ? .5 : 1) : Math.max(first[1]!, first[1]! + dy));
  const width = x1 - x0, height = y1 - y0;
  if (![x0, y0, x1, y1, x0 + x1, y0 + y1, width, height].every(coordinate) || width < 1 || height < 1) return null;
  return { x: x0, y: y0, width, height };
}

/** The one-pixel row or column under `at`, spanning the whole canvas; null outside it. */
export function lineSelection(tool: string, at: XY, canvas: { width: number; height: number }): GestureRectangle | null {
  const x = Math.floor(at[0]!), y = Math.floor(at[1]!);
  if (tool === "singleRowSelection") return y >= 0 && y < canvas.height ? { x: 0, y, width: canvas.width, height: 1 } : null;
  return x >= 0 && x < canvas.width ? { x, y: 0, width: 1, height: canvas.height } : null;
}

export function polygonPoint(previous: XY, next: XY, snap: boolean): [number, number] {
  if (!snap) return [next[0]!, next[1]!];
  const dx = next[0]! - previous[0]!, dy = next[1]! - previous[1]!;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(dx, dy);
  return [previous[0]! + Math.cos(angle) * length, previous[1]! + Math.sin(angle) * length];
}

export function selectionGestureCommand(tool: string, points: readonly XY[], options: PaintOptions, mode: SelectionMode, start: GestureModifiers, current: GestureModifiers, canvas?: { width: number; height: number }): { id: string; params: Record<string, unknown> } | null {
  if (!points.length || points.some(point => point.length < 2 || !coordinate(point[0]!) || !coordinate(point[1]!))) return null;
  const first = points[0]!, last = points.at(-1)!;
  if (tool === "straighten") {
    if (Math.hypot(last[0]! - first[0]!, last[1]! - first[1]!) < 1) return null;
    return { id: "image.analysis.straightenLayer", params: { start: first.slice(0, 2), end: last.slice(0, 2), crop: options.scope !== "layers" } };
  }
  const edge = { feather: options.feather ?? 0, antiAlias: options.antiAlias !== false };
  if (LINE_SELECTION_TOOLS.includes(tool)) {
    // Photoshop places the line where the pointer is released and greys out Anti-alias for it.
    const rect = canvas ? lineSelection(tool, last, canvas) : null;
    return rect && { id: "select.rect", params: { ...rect, mode, ellipse: false, feather: edge.feather, antiAlias: false } };
  }
  if (RECTANGLE_TOOLS.includes(tool)) {
    const rect = gestureRectangle(first, last, options, start, current);
    if (!rect) return null;
    if (tool === "crop") return rect.width * rect.height <= 256_000_000 ? { id: "image.crop", params: { ...rect, deleteCroppedPixels: options.deleteCroppedPixels === true } } : null;
    if (tool === "select.object") return { id: tool, params: { rect: [rect.x, rect.y, rect.width, rect.height], mode, sampleAllLayers: options.sampleAllLayers === true } };
    return { id: "select.rect", params: { ...rect, mode, ellipse: tool === "ellipseSelection", ...edge } };
  }
  if (tool === "select.lasso" || tool === "polygonLasso") {
    if (points.length < 3) return null;
    return { id: "select.lasso", params: { points: points.map(point => point.slice(0, 2)), mode, ...edge } };
  }
  if (tool === "select.quick") return { id: tool, params: { points: points.map(point => point.slice(0, 2)), size: options.size ?? 30, mode: mode === "intersect" ? "subtract" : mode, sampleAllLayers: options.sampleAllLayers === true, enhanceEdge: options.enhanceEdge === true } };
  if (tool === "select.magicWand") return { id: tool, params: { x: first[0], y: first[1], mode, tolerance: options.tolerance ?? 32, contiguous: options.contiguous !== false, antiAlias: options.antiAlias !== false, sampleAllLayers: options.sampleAllLayers === true } };
  return null;
}

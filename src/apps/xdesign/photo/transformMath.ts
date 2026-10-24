import type { PhotoDocument, PhotoLayer } from "./types";

type XY = [number, number];
export type Quad = XY[];
export type Bounds = [number, number, number, number];
export type TransformSettings = { x: number; y: number; width: number; height: number; angle: number; skewX: number; skewY: number; flipX: boolean; flipY: boolean };

export function layerFrame(document: PhotoDocument, layer: PhotoLayer): Bounds {
  const supplied = layer.transformBounds ?? layer.bounds;
  return supplied && supplied[2] > 0 && supplied[3] > 0 ? supplied : [0, 0, document.width, document.height];
}
export const identityTransform = (bounds: Bounds): TransformSettings => ({ x: bounds[0] + bounds[2] / 2, y: bounds[1] + bounds[3] / 2, width: 100, height: 100, angle: 0, skewX: 0, skewY: 0, flipX: false, flipY: false });

/** Rotation times skew: the unscaled linear part [m00, m01, m10, m11]. */
function basis(settings: TransformSettings): [number, number, number, number] {
  const radians = settings.angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const tx = settings.skewX ? Math.tan(settings.skewX * Math.PI / 180) : 0, ty = settings.skewY ? Math.tan(settings.skewY * Math.PI / 180) : 0;
  return [cos - sin * ty, tx ? cos * tx - sin : -sin, sin + cos * ty, sin * tx + cos];
}
export function transformMatrix(bounds: Bounds, settings: TransformSettings): [number, number, number, number, number, number] {
  const [x, y, width, height] = bounds, cx = x + width / 2, cy = y + height / 2, [m00, m01, m10, m11] = basis(settings);
  const sx = settings.width / 100 * (settings.flipX ? -1 : 1), sy = settings.height / 100 * (settings.flipY ? -1 : 1);
  const a = m00 * sx, b = m10 * sx, c = m01 * sy, d = m11 * sy;
  return [a, b, c, d, settings.x - a * cx - c * cy, settings.y - b * cx - d * cy];
}
export function transformHandle(bounds: Bounds, settings: TransformSettings, hx: number, hy: number): XY {
  const matrix = transformMatrix(bounds, settings), px = bounds[0] + (hx + 1) * bounds[2] / 2, py = bounds[1] + (hy + 1) * bounds[3] / 2;
  return [matrix[0] * px + matrix[2] * py + matrix[4], matrix[1] * px + matrix[3] * py + matrix[5]];
}
/** Resize around the opposite handle (or the centre when `centered`) in the rotated, skewed axes, preserving flips. */
export function resizeTransform(bounds: Bounds, initial: TransformSettings, hx: number, hy: number, point: XY, linked: boolean, centered = false): TransformSettings {
  const anchor = centered ? [initial.x, initial.y] : transformHandle(bounds, initial, -hx, -hy), [m00, m01, m10, m11] = basis(initial);
  const det = m00 * m11 - m01 * m10, fx = initial.flipX ? -1 : 1, fy = initial.flipY ? -1 : 1, span = centered ? 2 : 1;
  if (Math.abs(det) < 1e-6) return initial;
  const dx = point[0] - anchor[0]!, dy = point[1] - anchor[1]!, lx = (m11 * dx - m01 * dy) / det, ly = (m00 * dy - m10 * dx) / det;
  let width = hx ? lx * fx * span / hx / bounds[2] * 100 : initial.width;
  let height = hy ? ly * fy * span / hy / bounds[3] * 100 : initial.height;
  if (linked) {
    const requested = !hx ? height / initial.height : !hy ? width / initial.width : Math.abs(width / initial.width - 1) > Math.abs(height / initial.height - 1) ? width / initial.width : height / initial.height;
    const factor = Math.max(Math.max(1 / initial.width, 1 / initial.height), Math.min(Math.min(1000 / initial.width, 1000 / initial.height), requested));
    width = initial.width * factor; height = initial.height * factor;
  }
  width = Math.max(1, Math.min(1000, width)); height = Math.max(1, Math.min(1000, height));
  if (centered) return { ...initial, width, height };
  const u = hx * bounds[2] * width / 200 * fx, v = hy * bounds[3] * height / 200 * fy;
  return { ...initial, width, height, x: anchor[0]! + m00 * u + m01 * v, y: anchor[1]! + m10 * u + m11 * v };
}

/** Quad corners in engine order: top-left, top-right, bottom-right, bottom-left. */
export const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
/** The quad corners a handle drags: itself for a corner, both ends of the side for an edge handle. */
export const distortCorners = (hx: number, hy: number): number[] => hx && hy ? [CORNERS.findIndex(([x, y]) => x === hx && y === hy)] : hy ? (hy < 0 ? [0, 1] : [2, 3]) : (hx > 0 ? [1, 2] : [3, 0]);
export function quadHandle(quad: Quad, hx: number, hy: number): XY {
  const [a, b = a] = distortCorners(hx, hy).map(index => quad[index]!);
  return [(a![0] + b![0]) / 2, (a![1] + b![1]) / 2];
}
export const quadCentre = (quad: Quad): XY => [quad.reduce((sum, p) => sum + p[0], 0) / quad.length, quad.reduce((sum, p) => sum + p[1], 0) / quad.length];
const shifted = (p: XY, d: XY): XY => [p[0] + d[0], p[1] + d[1]];
const along = (d: XY, axis: XY): XY => {
  const length = axis[0] * axis[0] + axis[1] * axis[1], t = length ? (d[0] * axis[0] + d[1] * axis[1]) / length : 0;
  return [axis[0] * t, axis[1] * t];
};
/** Skew mode: a side slides along its own line; a corner slides along whichever adjacent side the drag follows most. */
export function skewQuad(quad: Quad, hx: number, hy: number, delta: XY): Quad {
  const next = quad.map(p => [...p] as XY), [a, b] = distortCorners(hx, hy) as [number, number | undefined];
  if (b !== undefined) {
    const slide = along(delta, [quad[b]![0] - quad[a]![0], quad[b]![1] - quad[a]![1]]);
    next[a] = shifted(quad[a] as XY, slide); next[b] = shifted(quad[b] as XY, slide);
    return next;
  }
  const slides = [(a + 1) % 4, (a + 3) % 4].map(other => along(delta, [quad[other]![0] - quad[a]![0], quad[other]![1] - quad[a]![1]]));
  next[a] = shifted(quad[a] as XY, Math.hypot(...slides[0]!) >= Math.hypot(...slides[1]!) ? slides[0]! : slides[1]!);
  return next;
}
const PAIR_ACROSS = [1, 0, 3, 2], PAIR_DOWN = [3, 2, 1, 0];
/** Perspective mode (PhotoCraft's rule): a corner moves along the dominant axis and the corner sharing that side mirrors it. Side handles skew. */
export function perspectiveQuad(quad: Quad, hx: number, hy: number, delta: XY): Quad {
  if (!(hx && hy)) return skewQuad(quad, hx, hy, delta);
  const i = distortCorners(hx, hy)[0]!, across = Math.abs(delta[0]) >= Math.abs(delta[1]), j = (across ? PAIR_ACROSS : PAIR_DOWN)[i]!, move: XY = across ? [delta[0], 0] : [0, delta[1]];
  const next = quad.map(p => [...p] as XY);
  next[i] = shifted(quad[i] as XY, move); next[j] = shifted(quad[j] as XY, [-move[0], -move[1]]);
  return next;
}
/** Scale on an already-distorted quad: a corner scales everything uniformly about the opposite corner, a side only along its axis. */
export function scaleQuad(quad: Quad, hx: number, hy: number, point: XY, centred = false): Quad {
  const anchor = centred ? quadCentre(quad) : quadHandle(quad, -hx, -hy), handle = quadHandle(quad, hx, hy), v: XY = [handle[0] - anchor[0], handle[1] - anchor[1]], length = v[0] * v[0] + v[1] * v[1];
  if (!length) return quad;
  const factor = Math.max(0.01, ((point[0] - anchor[0]) * v[0] + (point[1] - anchor[1]) * v[1]) / length);
  return quad.map(p => {
    const d: XY = [p[0] - anchor[0], p[1] - anchor[1]];
    if (hx && hy) return [anchor[0] + d[0] * factor, anchor[1] + d[1] * factor] as XY;
    const t = (d[0] * v[0] + d[1] * v[1]) / length * (factor - 1);
    return [p[0] + v[0] * t, p[1] + v[1] * t] as XY;
  });
}
export function rotateQuad(quad: Quad, centre: XY, radians: number): Quad {
  const cos = Math.cos(radians), sin = Math.sin(radians);
  return quad.map(p => [centre[0] + (p[0] - centre[0]) * cos - (p[1] - centre[1]) * sin, centre[1] + (p[0] - centre[0]) * sin + (p[1] - centre[1]) * cos] as XY);
}

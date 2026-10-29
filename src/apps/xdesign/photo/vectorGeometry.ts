import type { PathData, PathKnot } from "./PathEditOverlay";
import type { XY } from "./penPath";
import { polygonPoints } from "./polygonShape";

export type ShapeGeometry =
  | { kind: "rect" | "roundedRect" | "ellipse"; rect: number[]; radii?: number | number[] }
  | { kind: "polygon"; rect: number[]; sides: number; starRatio?: number }
  | { kind: "line"; from: number[]; to: number[]; weight: number };
export type Bounds = { x: number; y: number; width: number; height: number };
export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type ShapeConstraint = { kind: "unconstrained" | "square" | "fixedSize" | "proportional"; width: number; height: number; fromCenter: boolean };

/** Handle length of a quarter-circle cubic, as the engine's live shapes use. */
const KAPPA = 0.5522847498307934;
const corner = (x: number, y: number): PathKnot => ({ anchor: [x, y], in: [x, y], out: [x, y], smooth: false });
const same = (a: XY, b: XY) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** CSS-style: adjacent radii that overrun a side all shrink by the same factor. */
function clampRadii(w: number, h: number, radii: number[]): number[] {
  const r = radii.map(value => Math.max(0, value));
  let f = 1;
  for (const [a, b, side] of [[r[0]!, r[1]!, w], [r[1]!, r[2]!, h], [r[2]!, r[3]!, w], [r[3]!, r[0]!, h]] as const) if (a + b > side && a + b > 0) f = Math.min(f, side / (a + b));
  return r.map(value => value * f);
}

function roundedRect([x, y, w, h]: number[], radii: number[]): PathKnot[] {
  const [tl, tr, br, bl] = clampRadii(w!, h!, radii), x1 = x! + w!, y1 = y! + h!;
  // Each corner is its arc's two ends, or the bare corner without a radius; clockwise from the top-left arc's end.
  const arc = (r: number, at: XY, start: XY, startOut: XY, end: XY, endIn: XY): PathKnot[] => r > 0 ? [{ anchor: start, in: start, out: startOut, smooth: false }, { anchor: end, in: endIn, out: end, smooth: false }] : [corner(at[0], at[1])];
  const tlArc = arc(tl!, [x!, y!], [x!, y! + tl!], [x!, y! + tl! - KAPPA * tl!], [x! + tl!, y!], [x! + tl! - KAPPA * tl!, y!]);
  const ring = [tlArc.at(-1)!,
    ...arc(tr!, [x1, y!], [x1 - tr!, y!], [x1 - tr! + KAPPA * tr!, y!], [x1, y! + tr!], [x1, y! + tr! - KAPPA * tr!]),
    ...arc(br!, [x1, y1], [x1, y1 - br!], [x1, y1 - br! + KAPPA * br!], [x1 - br!, y1], [x1 - br! + KAPPA * br!, y1]),
    ...arc(bl!, [x!, y1], [x! + bl!, y1], [x! + bl! - KAPPA * bl!, y1], [x!, y1 - bl!], [x!, y1 - bl! + KAPPA * bl!]),
    ...(tlArc.length > 1 ? [tlArc[0]!] : [])];
  // Radii that fill a side meet at one point: merge those knots, as the engine does.
  const out: PathKnot[] = [];
  for (const knot of ring) { const last = out.at(-1); if (last && same(last.anchor, knot.anchor)) out[out.length - 1] = { ...last, out: knot.out }; else out.push(knot); }
  if (out.length > 1 && same(out[0]!.anchor, out.at(-1)!.anchor)) { out[0] = { ...out[0]!, in: out.at(-1)!.in }; out.pop(); }
  return out;
}

function ellipse([x, y, w, h]: number[]): PathKnot[] {
  const rx = w! / 2, ry = h! / 2, cx = x! + rx, cy = y! + ry, kx = rx * KAPPA, ky = ry * KAPPA;
  const smooth = (anchor: XY, inc: XY, out: XY): PathKnot => ({ anchor, in: inc, out, smooth: true });
  return [smooth([cx, cy - ry], [cx - kx, cy - ry], [cx + kx, cy - ry]), smooth([cx + rx, cy], [cx + rx, cy - ky], [cx + rx, cy + ky]), smooth([cx, cy + ry], [cx + kx, cy + ry], [cx - kx, cy + ry]), smooth([cx - rx, cy], [cx - rx, cy + ky], [cx - rx, cy - ky])];
}

/** The engine's live shape as a path, for the shape tools' Path mode. */
export function shapeGeometryPath(geometry: ShapeGeometry): PathData {
  let knots: PathKnot[];
  if (geometry.kind === "line") {
    const [ax, ay] = geometry.from as XY, [bx, by] = geometry.to as XY, length = Math.hypot(bx - ax, by - ay), half = Math.max(0, geometry.weight) / 2;
    const [nx, ny] = length > 0 ? [-(by - ay) / length * half, (bx - ax) / length * half] : [0, half];
    knots = [corner(ax + nx, ay + ny), corner(bx + nx, by + ny), corner(bx - nx, by - ny), corner(ax - nx, ay - ny)];
  } else if (geometry.kind === "polygon") knots = polygonPoints(geometry.rect as [number, number, number, number], geometry.sides, geometry.starRatio ?? 1).map(([x, y]) => corner(x, y));
  else if (geometry.kind === "ellipse") knots = ellipse(geometry.rect);
  else {
    const radii = typeof geometry.radii === "number" ? [geometry.radii, geometry.radii, geometry.radii, geometry.radii] : geometry.radii ?? [0, 0, 0, 0];
    const [x, y, w, h] = geometry.rect as [number, number, number, number];
    knots = radii.some(value => value > 0) ? roundedRect(geometry.rect, radii) : [corner(x, y), corner(x + w, y), corner(x + w, y + h), corner(x, y + h)];
  }
  return { subpaths: [{ closed: true, knots }] };
}

type Segment = [XY, XY, XY, XY];
const segments = (knots: readonly PathKnot[], closed: boolean): Segment[] =>
  knots.slice(0, closed && knots.length > 1 ? knots.length : knots.length - 1).map((knot, index) => { const next = knots[(index + 1) % knots.length]!; return [knot.anchor, knot.out, next.in, next.anchor]; });
const at = ([p0, p1, p2, p3]: Segment, t: number): XY => {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
};
// Where the cubic's derivative is zero along one axis, inside the segment.
function extrema(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  return [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)];
}

/** The curve's own bounds (handles that overshoot it do not count), as the W and H fields show them. */
export function pathBounds(path: PathData): Bounds | null {
  const points: XY[] = [];
  for (const { knots, closed } of path.subpaths) {
    points.push(...knots.map(knot => knot.anchor));
    for (const segment of segments(knots, closed)) for (const axis of [0, 1]) for (const t of extrema(segment[0][axis]!, segment[1][axis]!, segment[2][axis]!, segment[3][axis]!)) if (t > 0 && t < 1) points.push(at(segment, t));
  }
  if (!points.length) return null;
  const round = (value: number) => Math.round(value * 1e6) / 1e6, xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const x = round(Math.min(...xs)), y = round(Math.min(...ys));
  return { x, y, width: round(Math.max(...xs)) - x, height: round(Math.max(...ys)) - y };
}

/** Scales `bounds` to `width` × `height` about its top-left corner, as Photoshop's W and H fields do. */
export function resizeMatrix(bounds: Bounds, width: number, height: number): [number, number, number, number, number, number] | null {
  if (!(bounds.width > 0 && bounds.height > 0 && width > 0 && height > 0)) return null;
  const sx = width / bounds.width, sy = height / bounds.height;
  return [sx, 0, 0, sy, bounds.x - sx * bounds.x, bounds.y - sy * bounds.y];
}

const shift = (knot: PathKnot, dx: number, dy: number): PathKnot => ({ ...knot, anchor: [knot.anchor[0] + dx, knot.anchor[1] + dy], in: [knot.in[0] + dx, knot.in[1] + dy], out: [knot.out[0] + dx, knot.out[1] + dy] });

/** Moves every component's edge or centre onto `area`'s. */
export function alignSubpaths(path: PathData, edge: AlignEdge, area: Bounds): { path: PathData; moves: XY[] } {
  const moves = path.subpaths.map((subpath): XY => {
    const b = pathBounds({ subpaths: [subpath] });
    if (!b) return [0, 0];
    switch (edge) {
      case "left": return [area.x - b.x, 0];
      case "hcenter": return [area.x + area.width / 2 - (b.x + b.width / 2), 0];
      case "right": return [area.x + area.width - (b.x + b.width), 0];
      case "top": return [0, area.y - b.y];
      case "vcenter": return [0, area.y + area.height / 2 - (b.y + b.height / 2)];
      case "bottom": return [0, area.y + area.height - (b.y + b.height)];
    }
  });
  return { moves, path: { ...path, subpaths: path.subpaths.map((subpath, index) => ({ ...subpath, knots: subpath.knots.map(knot => shift(knot, ...moves[index]!)) })) } };
}

/** One move shared by every component, so a live shape can move instead of being replaced by its path. */
export function uniformMove(moves: readonly XY[]): XY | null {
  return moves.length && moves.every(move => move[0] === moves[0]![0] && move[1] === moves[0]![1]) ? moves[0]! : null;
}

export function nearestSegment(path: PathData, point: XY, tolerance: number): { subpath: number; segment: number; t: number; distance: number } | null {
  let best: { subpath: number; segment: number; t: number; distance: number } | null = null;
  const distance = (segment: Segment, t: number) => { const p = at(segment, t); return Math.hypot(p[0] - point[0], p[1] - point[1]); };
  path.subpaths.forEach(({ knots, closed }, s) => segments(knots, closed).forEach((segment, index) => {
    let t = 0, d = Infinity;
    for (let step = 0; step <= 64; step++) { const value = distance(segment, step / 64); if (value < d) { d = value; t = step / 64; } }
    for (let span = 1 / 64; span > 1e-5; span /= 2) for (const candidate of [t - span, t + span]) if (candidate >= 0 && candidate <= 1) { const value = distance(segment, candidate); if (value < d) { d = value; t = candidate; } }
    if (d <= tolerance && (!best || d < best.distance)) best = { subpath: s, segment: index, t, distance: d };
  }));
  return best;
}

export function nearestKnot(path: PathData, point: XY, tolerance: number): { subpath: number; knot: number } | null {
  let best: { subpath: number; knot: number; distance: number } | null = null;
  path.subpaths.forEach(({ knots }, s) => knots.forEach((knot, k) => { const d = Math.hypot(knot.anchor[0] - point[0], knot.anchor[1] - point[1]); if (d <= tolerance && (!best || d < best.distance)) best = { subpath: s, knot: k, distance: d }; }));
  return best && { subpath: (best as { subpath: number }).subpath, knot: (best as { knot: number }).knot };
}

const lerp = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Splits a segment at `t` without changing its shape; a straight segment gains a corner point, as Photoshop's Add Anchor Point does. */
export function insertKnot(path: PathData, subpath: number, segment: number, t: number): PathData {
  const knots = path.subpaths[subpath]!.knots, next = (segment + 1) % knots.length, a = knots[segment]!, b = knots[next]!;
  const edited = [...knots];
  if (same(a.out, a.anchor) && same(b.in, b.anchor)) { const [x, y] = at([a.anchor, a.out, b.in, b.anchor], t); edited.splice(segment + 1, 0, corner(x, y)); }
  else {
    const p01 = lerp(a.anchor, a.out, t), p12 = lerp(a.out, b.in, t), p23 = lerp(b.in, b.anchor, t), p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
    edited[segment] = { ...a, out: p01 }; edited[next] = { ...edited[next]!, in: p23 };
    edited.splice(segment + 1, 0, { anchor: lerp(p012, p123, t), in: p012, out: p123, smooth: true });
  }
  return { ...path, subpaths: path.subpaths.map((entry, index) => index === subpath ? { ...entry, knots: edited } : entry) };
}

/** Removes a point; a component left with no points goes too. */
export function deleteKnot(path: PathData, subpath: number, knot: number): PathData {
  const subpaths = path.subpaths.map((entry, index) => index === subpath ? { ...entry, knots: entry.knots.filter((_, k) => k !== knot) } : entry);
  return { ...path, subpaths: subpaths.filter(entry => entry.knots.length > 0) };
}

/** The shape tools' gear as the rectangle gesture's options. */
export function constraintGestureOptions(constraint: ShapeConstraint): Record<string, string | number | boolean> {
  const fromCenter = constraint.fromCenter;
  if (constraint.kind === "square") return { style: "fixedRatio", ratioWidth: 1, ratioHeight: 1, fromCenter };
  if (constraint.kind === "fixedSize") return { style: "fixedSize", fixedWidth: constraint.width, fixedHeight: constraint.height, fromCenter };
  if (constraint.kind === "proportional") return { style: "fixedRatio", ratioWidth: constraint.width, ratioHeight: constraint.height, fromCenter };
  return { style: "normal", fromCenter };
}

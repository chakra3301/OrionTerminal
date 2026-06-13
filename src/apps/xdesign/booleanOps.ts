import polygonClipping from "polygon-clipping";
import type { MultiPolygon } from "polygon-clipping";
import type { Shape, PathPoint } from "./store";

const { union, intersection, xor, difference } = polygonClipping;

export type BoolOp = "union" | "subtract" | "intersect" | "exclude";

type Pt = [number, number];

const ELLIPSE_SAMPLES = 64;
const BEZIER_SAMPLES = 16;

function rotate(px: number, py: number, cx: number, cy: number, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** Map a point in the shape's local bbox space (px in [0..w], py in [0..h])
 * to absolute document coords, honoring flip + rotation. */
function localToWorld(lx: number, ly: number, s: Shape): Pt {
  let ux = lx;
  let uy = ly;
  if (s.flipX) ux = s.w - ux;
  if (s.flipY) uy = s.h - uy;
  const wx = s.x + ux;
  const wy = s.y + uy;
  const r = s.rotation ?? 0;
  if (!r) return [wx, wy];
  return rotate(wx, wy, s.x + s.w / 2, s.y + s.h / 2, r);
}

function cubicAt(
  p0: number,
  c1: number,
  c2: number,
  p1: number,
  t: number,
): number {
  const mt = 1 - t;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * t * c1 +
    3 * mt * t * t * c2 +
    t * t * t * p1
  );
}

/** Flatten one shape to an absolute-space ring (a closed polyline). */
export function shapeToRing(s: Shape): Pt[] {
  if (s.kind === "ellipse") {
    const ring: Pt[] = [];
    const rx = s.w / 2;
    const ry = s.h / 2;
    for (let i = 0; i < ELLIPSE_SAMPLES; i++) {
      const t = (2 * Math.PI * i) / ELLIPSE_SAMPLES;
      ring.push(localToWorld(rx + rx * Math.cos(t), ry + ry * Math.sin(t), s));
    }
    return ring;
  }

  if (s.kind === "path" && s.points.length >= 2) {
    // Points are unit (0..1) relative to bbox; handles share that space.
    const local = s.points.map((p) => ({
      x: p.x * s.w,
      y: p.y * s.h,
      cpOutX: p.cpOutX !== undefined ? p.cpOutX * s.w : undefined,
      cpOutY: p.cpOutY !== undefined ? p.cpOutY * s.h : undefined,
      cpInX: p.cpInX !== undefined ? p.cpInX * s.w : undefined,
      cpInY: p.cpInY !== undefined ? p.cpInY * s.h : undefined,
    }));
    const ring: Pt[] = [];
    const n = local.length;
    // Closed area: always wrap the last segment back to the first.
    for (let i = 0; i < n; i++) {
      const a = local[i]!;
      const b = local[(i + 1) % n]!;
      ring.push(localToWorld(a.x, a.y, s));
      const curved =
        a.cpOutX !== undefined ||
        a.cpOutY !== undefined ||
        b.cpInX !== undefined ||
        b.cpInY !== undefined;
      if (curved) {
        const c1x = a.cpOutX ?? a.x;
        const c1y = a.cpOutY ?? a.y;
        const c2x = b.cpInX ?? b.x;
        const c2y = b.cpInY ?? b.y;
        for (let k = 1; k < BEZIER_SAMPLES; k++) {
          const t = k / BEZIER_SAMPLES;
          ring.push(
            localToWorld(
              cubicAt(a.x, c1x, c2x, b.x, t),
              cubicAt(a.y, c1y, c2y, b.y, t),
              s,
            ),
          );
        }
      }
    }
    return ring;
  }

  // rect / frame / text / image / degenerate path → bbox rectangle.
  return [
    localToWorld(0, 0, s),
    localToWorld(s.w, 0, s),
    localToWorld(s.w, s.h, s),
    localToWorld(0, s.h, s),
  ];
}

function shapeToGeom(s: Shape): MultiPolygon {
  return [[shapeToRing(s)]];
}

export type BoolResult = {
  x: number;
  y: number;
  w: number;
  h: number;
  points: PathPoint[];
  subpaths: PathPoint[][];
};

/** Run a boolean op over shapes given in z-order (index 0 = bottom-most).
 * Returns the geometry for a single closed PathShape (with even-odd
 * subpaths for holes / disjoint regions), or null when the result is empty
 * or degenerate. */
export function booleanShapes(op: BoolOp, shapes: Shape[]): BoolResult | null {
  if (shapes.length < 2) return null;
  const geoms = shapes.map(shapeToGeom);
  const [first, ...rest] = geoms;
  if (!first) return null;

  let result: MultiPolygon;
  try {
    if (op === "union") result = union(first, ...rest);
    else if (op === "intersect") result = intersection(first, ...rest);
    else if (op === "exclude") result = xor(first, ...rest);
    else result = difference(first, ...rest);
  } catch {
    return null;
  }

  // Flatten MultiPolygon → list of rings (outers + holes); even-odd fill in
  // the renderer makes holes punch through regardless of winding.
  const rings: Pt[][] = [];
  for (const poly of result) {
    for (const ring of poly) {
      if (ring.length >= 4) rings.push(ring as Pt[]);
    }
  }
  if (rings.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [px, py] of ring) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (w <= 0 || h <= 0) return null;

  const toUnit = (ring: Pt[]): PathPoint[] => {
    // polygon-clipping returns closed rings (first == last); drop the repeat.
    const last = ring[ring.length - 1]!;
    const firstP = ring[0]!;
    const trimmed =
      last[0] === firstP[0] && last[1] === firstP[1]
        ? ring.slice(0, -1)
        : ring;
    return trimmed.map(([px, py]) => ({
      x: (px - minX) / w,
      y: (py - minY) / h,
    }));
  };

  const unitRings = rings.map(toUnit);
  return {
    x: minX,
    y: minY,
    w,
    h,
    points: unitRings[0]!,
    subpaths: unitRings.slice(1),
  };
}

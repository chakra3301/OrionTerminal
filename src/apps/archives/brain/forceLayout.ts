/** Minimal 3D force-directed layout for the Brain graph. Custom (no d3 — the
 * dependency list is locked) but the same physics: link springs, short-range
 * many-body repulsion via a uniform 3D grid (keeps ticks ~O(n) instead of
 * n²), weak centering gravity, verlet-ish integration with velocity damping.
 * Deterministic initial placement (Fibonacci-sphere direction seeded by node
 * id) so the same archive always settles into a similar shape. The renderer
 * projects the cloud with a slow orbital camera — same energy-core language
 * as the splash. */

export type LayoutNode = {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Visual radius — also used for spring rest length + collision. */
  r: number;
  /** Pinned position while dragging (null = free). */
  fx: number | null;
  fy: number | null;
  fz: number | null;
};

export type LayoutEdge = { a: number; b: number; weight: number };

const REPULSION = 2600;
const REPULSION_RADIUS = 170;
const SPRING = 0.05;
const GRAVITY = 0.014;
const DAMPING = 0.72;
const MAX_VELOCITY = 14;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic placement on a Fibonacci sphere (direction) at a hashed
 * radius — stable across sessions regardless of input order. */
export function initialPosition(id: string): { x: number; y: number; z: number } {
  const h = hashString(id);
  const i = h % 1024;
  const gold = 2.39996; // golden angle
  const y = 1 - (2 * (i + 0.5)) / 1024; // -1..1
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * gold;
  const radius = 90 + ((h >>> 10) % 260);
  return {
    x: Math.cos(theta) * ring * radius,
    y: y * radius,
    z: Math.sin(theta) * ring * radius,
  };
}

/** One simulation step. Mutates node positions/velocities in place.
 * `alpha` (0..1) scales all forces — caller decays it toward 0. */
export function stepLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  alpha: number,
): void {
  const n = nodes.length;
  if (n === 0) return;

  // Uniform 3D grid for short-range repulsion.
  const cell = REPULSION_RADIUS;
  const grid = new Map<number, number[]>();
  const keyFor = (x: number, y: number, z: number) =>
    (Math.floor(x / cell) & 0x3ff) |
    ((Math.floor(y / cell) & 0x3ff) << 10) |
    ((Math.floor(z / cell) & 0x3ff) << 20);
  for (let i = 0; i < n; i++) {
    const nd = nodes[i]!;
    const k = keyFor(nd.x, nd.y, nd.z);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  }

  for (let i = 0; i < n; i++) {
    const a = nodes[i]!;
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    const cz = Math.floor(a.z / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (let gz = cz - 1; gz <= cz + 1; gz++) {
          const bucket = grid.get(
            (gx & 0x3ff) | ((gy & 0x3ff) << 10) | ((gz & 0x3ff) << 20),
          );
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const b = nodes[j]!;
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let dz = a.z - b.z;
            let d2 = dx * dx + dy * dy + dz * dz;
            if (d2 === 0) {
              // Coincident — nudge apart deterministically.
              dx = ((i * 37) % 7) - 3 || 1;
              dy = ((j * 53) % 7) - 3 || -1;
              dz = (((i + j) * 29) % 7) - 3 || 1;
              d2 = dx * dx + dy * dy + dz * dz;
            }
            if (d2 > REPULSION_RADIUS * REPULSION_RADIUS) continue;
            const d = Math.sqrt(d2);
            const overlap = a.r + b.r + 8 - d;
            let f = (REPULSION * alpha) / d2;
            if (overlap > 0) f += overlap * 0.35; // collision push
            const fx = (dx / d) * f;
            const fy = (dy / d) * f;
            const fz = (dz / d) * f;
            a.vx += fx;
            a.vy += fy;
            a.vz += fz;
            b.vx -= fx;
            b.vy -= fy;
            b.vz -= fz;
          }
        }
      }
    }
  }

  // Link springs.
  for (const e of edges) {
    const a = nodes[e.a]!;
    const b = nodes[e.b]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const rest = 70 + a.r + b.r;
    const f = SPRING * e.weight * alpha * (d - rest);
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    const fz = (dz / d) * f;
    a.vx += fx;
    a.vy += fy;
    a.vz += fz;
    b.vx -= fx;
    b.vy -= fy;
    b.vz -= fz;
  }

  // Gravity toward origin + integrate.
  for (const nd of nodes) {
    nd.vx -= nd.x * GRAVITY * alpha;
    nd.vy -= nd.y * GRAVITY * alpha;
    nd.vz -= nd.z * GRAVITY * alpha;
    nd.vx *= DAMPING;
    nd.vy *= DAMPING;
    nd.vz *= DAMPING;
    const v = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy + nd.vz * nd.vz);
    if (v > MAX_VELOCITY) {
      const s = MAX_VELOCITY / v;
      nd.vx *= s;
      nd.vy *= s;
      nd.vz *= s;
    }
    if (nd.fx != null && nd.fy != null && nd.fz != null) {
      nd.x = nd.fx;
      nd.y = nd.fy;
      nd.z = nd.fz;
      nd.vx = 0;
      nd.vy = 0;
      nd.vz = 0;
    } else {
      nd.x += nd.vx;
      nd.y += nd.vy;
      nd.z += nd.vz;
    }
  }
}

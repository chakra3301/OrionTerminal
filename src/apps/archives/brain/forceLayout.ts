/** Minimal force-directed layout for the Brain graph. Custom (no d3 — the
 * dependency list is locked) but the same physics: link springs, short-range
 * many-body repulsion via a uniform grid (keeps ticks ~O(n) instead of n²),
 * weak centering gravity, verlet-ish integration with velocity damping.
 * Deterministic initial placement (golden-angle spiral seeded by node id)
 * so the same archive always settles into a similar shape. */

export type LayoutNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Visual radius — also used for spring rest length + collision. */
  r: number;
  /** Pinned position while dragging (null = free). */
  fx: number | null;
  fy: number | null;
};

export type LayoutEdge = { a: number; b: number; weight: number };

const REPULSION = 1800;
const REPULSION_RADIUS = 180;
const SPRING = 0.045;
const GRAVITY = 0.012;
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

/** Deterministic spiral placement — index from id hash so layout is stable
 * across sessions regardless of input order. */
export function initialPosition(id: string): { x: number; y: number } {
  const h = hashString(id);
  const i = h % 4096;
  const angle = i * 2.39996; // golden angle
  const radius = 24 * Math.sqrt(i % 512);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
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

  // Uniform grid for short-range repulsion.
  const cell = REPULSION_RADIUS;
  const grid = new Map<number, number[]>();
  const keyFor = (x: number, y: number) =>
    (Math.floor(x / cell) & 0xffff) | ((Math.floor(y / cell) & 0xffff) << 16);
  for (let i = 0; i < n; i++) {
    const nd = nodes[i]!;
    const k = keyFor(nd.x, nd.y);
    const bucket = grid.get(k);
    if (bucket) bucket.push(i);
    else grid.set(k, [i]);
  }

  for (let i = 0; i < n; i++) {
    const a = nodes[i]!;
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = grid.get((gx & 0xffff) | ((gy & 0xffff) << 16));
        if (!bucket) continue;
        for (const j of bucket) {
          if (j <= i) continue;
          const b = nodes[j]!;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 === 0) {
            // Coincident — nudge apart deterministically.
            dx = ((i * 37) % 7) - 3 || 1;
            dy = ((j * 53) % 7) - 3 || -1;
            d2 = dx * dx + dy * dy;
          }
          if (d2 > REPULSION_RADIUS * REPULSION_RADIUS) continue;
          const d = Math.sqrt(d2);
          const overlap = a.r + b.r + 6 - d;
          let f = (REPULSION * alpha) / d2;
          if (overlap > 0) f += overlap * 0.35; // collision push
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
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
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const rest = 64 + a.r + b.r;
    const f = SPRING * e.weight * alpha * (d - rest);
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // Gravity toward origin + integrate.
  for (const nd of nodes) {
    nd.vx -= nd.x * GRAVITY * alpha;
    nd.vy -= nd.y * GRAVITY * alpha;
    nd.vx *= DAMPING;
    nd.vy *= DAMPING;
    const v = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy);
    if (v > MAX_VELOCITY) {
      nd.vx = (nd.vx / v) * MAX_VELOCITY;
      nd.vy = (nd.vy / v) * MAX_VELOCITY;
    }
    if (nd.fx != null && nd.fy != null) {
      nd.x = nd.fx;
      nd.y = nd.fy;
      nd.vx = 0;
      nd.vy = 0;
    } else {
      nd.x += nd.vx;
      nd.y += nd.vy;
    }
  }
}

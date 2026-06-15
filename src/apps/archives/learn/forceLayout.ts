// src/apps/archives/learn/forceLayout.ts
export type SimNode = { id: string; x: number; y: number; vx: number; vy: number; fixed?: boolean };
export type SimEdge = { from: string; to: string };

const REPULSION = 6000;   // charge strength
const SPRING = 0.02;      // edge stiffness
const REST_LEN = 120;     // desired edge length
const CENTER_PULL = 0.01; // gravity toward center
const DAMPING = 0.85;     // velocity damping per tick
const MAX_V = 30;

const clampV = (v: number) => Math.max(-MAX_V, Math.min(MAX_V, v));

/** Deterministic ring layout around the center; used to seed the sim. */
export function initialPositions(ids: string[], w: number, h: number): Record<string, { x: number; y: number }> {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 3 || 1;
  const out: Record<string, { x: number; y: number }> = {};
  ids.forEach((id, i) => {
    const a = (i / Math.max(1, ids.length)) * Math.PI * 2;
    out[id] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
  return out;
}

/** Advance the simulation by one tick. Returns NEW node objects (pure). */
export function stepForces(nodes: SimNode[], edges: SimEdge[], w: number, h: number): SimNode[] {
  const cx = w / 2, cy = h / 2;
  const next = nodes.map((n) => ({ ...n }));
  const byId = new Map(next.map((n) => [n.id, n]));

  // pairwise repulsion
  for (let i = 0; i < next.length; i++) {
    for (let j = i + 1; j < next.length; j++) {
      const a = next[i]!, b = next[j]!;
      let dx = a.x - b.x, dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) { dx = (i - j) || 1; dy = 1; d2 = dx * dx + dy * dy; }
      const f = REPULSION / d2;
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
  }
  // spring attraction along edges
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = SPRING * (d - REST_LEN);
    const fx = (dx / d) * f, fy = (dy / d) * f;
    a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
  }
  // centering + integrate
  for (const n of next) {
    if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
    n.vx += (cx - n.x) * CENTER_PULL;
    n.vy += (cy - n.y) * CENTER_PULL;
    n.vx = clampV(n.vx * DAMPING);
    n.vy = clampV(n.vy * DAMPING);
    n.x += n.vx;
    n.y += n.vy;
  }
  return next;
}

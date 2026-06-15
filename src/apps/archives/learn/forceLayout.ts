// src/apps/archives/learn/forceLayout.ts
export type SimNode = { id: string; x: number; y: number; vx: number; vy: number; fixed?: boolean; anchor?: { x: number; y: number } };
export type SimEdge = { from: string; to: string };

// The Constellation auto-fits the settled layout to the viewport, so these
// constants only govern the SHAPE (relative spacing), not absolute scale/position.
const REPULSION = 9000;    // charge strength — separates nodes so hexes don't overlap
const SPRING = 0.035;      // edge stiffness
const REST_LEN = 110;      // desired edge length
const CENTER_PULL = 0.012; // gentle gravity — keeps disconnected components together
const DAMPING = 0.9;       // velocity damping per tick (higher = settles sooner)
const MAX_V = 30;
const BOUND_MARGIN = 40;   // keep nodes this far inside the viewport — no node can ever fly off
const ANCHOR_PULL = 0.08;   // spring toward a figure anchor (dominates when present)
const EDGE_SPRING_FIGURE = 0.012; // softened edge stiffness when any node is anchored

const clampV = (v: number) => Math.max(-MAX_V, Math.min(MAX_V, v));
const clampPos = (p: number, lo: number, hi: number) =>
  hi > lo ? Math.max(lo, Math.min(hi, p)) : p;

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
  // spring attraction along edges — softened when a figure is anchoring nodes
  const anchored = next.some((n) => n.anchor);
  const spring = anchored ? EDGE_SPRING_FIGURE : SPRING;
  for (const e of edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const f = spring * (d - REST_LEN);
    const fx = (dx / d) * f, fy = (dy / d) * f;
    a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
  }
  // anchor pull + centering + integrate
  for (const n of next) {
    if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
    if (n.anchor) {
      n.vx += (n.anchor.x - n.x) * ANCHOR_PULL;
      n.vy += (n.anchor.y - n.y) * ANCHOR_PULL;
    } else {
      n.vx += (cx - n.x) * CENTER_PULL;
      n.vy += (cy - n.y) * CENTER_PULL;
    }
    n.vx = clampV(n.vx * DAMPING);
    n.vy = clampV(n.vy * DAMPING);
    n.x += n.vx;
    n.y += n.vy;
    n.x = clampPos(n.x, BOUND_MARGIN, w - BOUND_MARGIN);
    n.y = clampPos(n.y, BOUND_MARGIN, h - BOUND_MARGIN);
  }
  return next;
}

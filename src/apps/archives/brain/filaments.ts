/**
 * "Filament" rendering for the Brain graph (owner reference, 2026-11-05: a
 * glowing neural cloud). Every link is a bundle of thin, slowly swaying curves
 * drawn additively, so overlaps brighten into light; each node is a bright
 * point with a soft glow and a few curling tendrils; fine dust drifts along
 * the links. Pure drawing code: the caller owns layout, camera and input.
 */

const TAU = Math.PI * 2;

/** Deterministic 0..1 from two integers (stable strand shapes per link). */
export function seeded(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Strands per link: heavier links get thicker bundles; a frame budget caps the total. */
export function strandCount(weight: number, edgeCount: number, budget = 3200): number {
  const wanted = 4 + Math.round(Math.max(0, Math.min(1, weight)) * 6);
  const scale = Math.min(1, budget / Math.max(1, edgeCount * 8));
  return Math.max(2, Math.round(wanted * scale));
}

export type FilamentEdge = { ia: number; ib: number; weight: number; alpha: number };
export type FilamentNode = { i: number; size: number; alpha: number; tendrils: number };

export type FilamentFrame = {
  ctx: CanvasRenderingContext2D;
  /** Seconds, for the sway. */
  t: number;
  /** [sx, sy, persp] per node index. */
  proj: Float32Array;
  /** Screen centre of the cloud (tendrils curl outward from it). */
  cx: number;
  cy: number;
  edges: FilamentEdge[];
  nodes: FilamentNode[];
  /** "r, g, b" of the ink. */
  ink: string;
  /** Additive light on dark grounds; plain alpha on light ones. */
  additive: boolean;
  /** "r, g, b" of the ground: a dark field is laid behind the cloud so it reads as light in the dark. */
  paper: string;
  /** Radius of that field, in px. */
  fieldRadius: number;
};

function bezierPoint(
  ax: number, ay: number, c1x: number, c1y: number, c2x: number, c2y: number, bx: number, by: number, u: number,
): [number, number] {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return [a * ax + b * c1x + c * c2x + d * bx, a * ay + b * c1y + c * c2y + d * by];
}

export function drawFilaments(f: FilamentFrame): void {
  const { ctx, t, proj, ink } = f;
  const col = (a: number) => `rgba(${ink}, ${a})`;
  ctx.save();
  if (f.fieldRadius > 0) {
    const field = ctx.createRadialGradient(f.cx, f.cy, 0, f.cx, f.cy, f.fieldRadius);
    field.addColorStop(0, `rgba(${f.paper}, 0.86)`);
    field.addColorStop(0.62, `rgba(${f.paper}, 0.62)`);
    field.addColorStop(1, `rgba(${f.paper}, 0)`);
    ctx.fillStyle = field;
    ctx.fillRect(f.cx - f.fieldRadius, f.cy - f.fieldRadius, f.fieldRadius * 2, f.fieldRadius * 2);
  }
  ctx.globalCompositeOperation = f.additive ? "lighter" : "source-over";
  ctx.lineCap = "round";

  // ── Link bundles ────────────────────────────────────────────────────
  const dust: number[] = [];
  for (let e = 0; e < f.edges.length; e++) {
    const edge = f.edges[e]!;
    const ax = proj[edge.ia * 3]!;
    const ay = proj[edge.ia * 3 + 1]!;
    const bx = proj[edge.ib * 3]!;
    const by = proj[edge.ib * 3 + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 2) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const n = strandCount(edge.weight, f.edges.length);
    const base = edge.alpha * (f.additive ? 0.13 : 0.1);
    for (let k = 0; k < n; k++) {
      const s1 = seeded(edge.ia * 131 + k, edge.ib);
      const s2 = seeded(edge.ib * 173 + k, edge.ia);
      const sway = Math.sin(t * (0.35 + s1 * 0.5) + s2 * TAU);
      const spread = len * (0.12 + 0.5 * s1);
      const o1 = (s2 - 0.5) * spread * 1.8 + sway * spread * 0.4;
      const o2 = (s1 - 0.5) * spread * 1.8 - sway * spread * 0.35;
      const c1x = ax + dx * 0.3 + nx * o1;
      const c1y = ay + dy * 0.3 + ny * o1;
      const c2x = ax + dx * 0.7 + nx * o2;
      const c2y = ay + dy * 0.7 + ny * o2;
      // A loop: the strand overshoots sideways and doubles back near its middle.
      const loop = (seeded(edge.ia + k * 17, edge.ib * 3) - 0.5) * spread * 1.4 + sway * spread * 0.25;
      const mx = (c1x + c2x) / 2 + nx * loop;
      const my = (c1y + c2y) / 2 + ny * loop;
      ctx.lineWidth = 0.4 + s1 * 0.55;
      ctx.strokeStyle = col(base * (0.5 + s2));
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.bezierCurveTo(c1x, c1y, c1x + nx * loop * 0.6 + dx * 0.15, c1y + ny * loop * 0.6 + dy * 0.15, mx, my);
      ctx.bezierCurveTo(c2x - nx * loop * 0.6 - dx * 0.15, c2y - ny * loop * 0.6 - dy * 0.15, c2x, c2y, bx, by);
      ctx.stroke();
      if (k < 2) {
        // Dust drifting along this strand.
        const u = (t * (0.025 + s1 * 0.05) + s2) % 1;
        const [px, py] = bezierPoint(ax, ay, c1x, c1y, c2x, c2y, bx, by, u);
        dust.push(px, py, edge.alpha);
      }
    }
  }

  // ── Tendrils: loose curling hairs leaving each node ─────────────────
  for (const node of f.nodes) {
    const x = proj[node.i * 3]!;
    const y = proj[node.i * 3 + 1]!;
    const persp = proj[node.i * 3 + 2]!;
    const out = Math.atan2(y - f.cy, x - f.cx);
    for (let k = 0; k < node.tendrils; k++) {
      const s1 = seeded(node.i * 977 + k, 7);
      const s2 = seeded(node.i * 313 + k, 11);
      const ang = out + (s1 - 0.5) * 2.4;
      const L = (20 + s2 * 70) * persp;
      const curl = (s1 > 0.5 ? 1 : -1) * (0.9 + s2 * 1.4) + Math.sin(t * 0.6 + s1 * TAU) * 0.35;
      const ex = x + Math.cos(ang) * L;
      const ey = y + Math.sin(ang) * L;
      const c1x = x + Math.cos(ang + curl * 0.4) * L * 0.5;
      const c1y = y + Math.sin(ang + curl * 0.4) * L * 0.5;
      const c2x = ex + Math.cos(ang + curl) * L * 0.45;
      const c2y = ey + Math.sin(ang + curl) * L * 0.45;
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = col(node.alpha * (f.additive ? 0.22 : 0.18) * (0.6 + s2 * 0.4));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
      ctx.stroke();
    }
  }

  // ── Dust ────────────────────────────────────────────────────────────
  for (let k = 0; k < dust.length; k += 3) {
    ctx.fillStyle = col(0.55 * dust[k + 2]!);
    ctx.fillRect(dust[k]! - 0.6, dust[k + 1]! - 0.6, 1.2, 1.2);
  }

  // ── Nodes: soft glow, then a bright point ───────────────────────────
  for (const node of f.nodes) {
    const x = proj[node.i * 3]!;
    const y = proj[node.i * 3 + 1]!;
    const r = node.size;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 6);
    glow.addColorStop(0, col(0.45 * node.alpha));
    glow.addColorStop(1, col(0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = col(Math.min(1, 0.95 * node.alpha + 0.05));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * "Neurons" rendering for the Brain graph (owner, 2026-11-07: "i want it to
 * feel like actually neurons in a brain"). Every note is a nerve cell: a soma
 * with branching, tapering dendrites. Every link is one axon that ends in small
 * synaptic branches at the other cell. Signals fire: a pulse runs down an axon
 * in the accent colour, the receiving cell flashes and may fire on in turn, so
 * activity cascades through the network. Cells never move (they're anchors for
 * clicking); only the dendrites and axons sway slightly, like living tissue.
 * Pure model + drawing: the caller owns layout, camera and input.
 */

const TAU = Math.PI * 2;

/** Deterministic 0..1 from two integers (stable shapes per cell and axon). */
export function seeded(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// ── Dendrites ─────────────────────────────────────────────────────────────

/**
 * A dendrite tree in unit space around the soma at (0, 0). One flat
 * [x0, y0, x1, y1, …] list per branching level, so each level can be drawn
 * as one path at its own width (thick near the soma, fine at the tips).
 */
export function dendriteTree(seed: number, primaries: number, depth: number): Float32Array[] {
  const levels: number[][] = Array.from({ length: depth }, () => []);
  let k = 0;
  const rnd = () => seeded(seed, k++);
  const grow = (x: number, y: number, ang: number, len: number, level: number) => {
    const steps = Math.max(2, 4 - level);
    let px = x;
    let py = y;
    let a = ang;
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 0.7;
      const nx = px + (Math.cos(a) * len) / steps;
      const ny = py + (Math.sin(a) * len) / steps;
      levels[level]!.push(px, py, nx, ny);
      px = nx;
      py = ny;
    }
    if (level + 1 < depth) {
      const fork = 0.35 + rnd() * 0.45;
      grow(px, py, a - fork, len * (0.55 + rnd() * 0.2), level + 1);
      grow(px, py, a + fork, len * (0.55 + rnd() * 0.2), level + 1);
    }
  };
  const start = rnd() * TAU;
  for (let p = 0; p < primaries; p++) {
    const ang = start + (p / primaries) * TAU + (rnd() - 0.5) * 0.9;
    grow(Math.cos(ang) * 0.1, Math.sin(ang) * 0.1, ang, 0.42 + rnd() * 0.3, 0);
  }
  return levels.map((l) => Float32Array.from(l));
}

// ── Network: firing and signals ───────────────────────────────────────────

export type Pulse = { e: number; dir: 1 | -1; u: number; speed: number };

export type Network = {
  n: number;
  key: string;
  /** ia, ib per edge. */
  ends: Int32Array;
  /** Edge indices per cell. */
  adj: number[][];
  /** 0..1 flash per cell; decays after it fires. */
  fire: Float32Array;
  /** Seconds until the cell can fire again. */
  rest: Float32Array;
  /** Time of the next spontaneous firing per cell. */
  next: Float32Array;
  pulses: Pulse[];
  trees: Float32Array[][];
};

export const MAX_PULSES = 10;
export const REFRACTORY = 1.4;

function edgeKey(n: number, edges: ReadonlyArray<readonly [number, number]>): string {
  let h = 0;
  for (const [a, b] of edges) h = (Math.imul(h, 31) + a * 7919 + b) | 0;
  return `${n}:${edges.length}:${h}`;
}

/** Rebuilds the network only when the cells or links change, so firing never resets mid-flow. */
export function ensureNetwork(
  net: Network | null,
  n: number,
  edges: ReadonlyArray<readonly [number, number]>,
  rnd: () => number = Math.random,
): Network {
  const key = edgeKey(n, edges);
  if (net && net.key === key) return net;
  const ends = new Int32Array(edges.length * 2);
  const adj: number[][] = Array.from({ length: n }, () => []);
  edges.forEach(([a, b], e) => {
    ends[e * 2] = a;
    ends[e * 2 + 1] = b;
    adj[a]?.push(e);
    adj[b]?.push(e);
  });
  const big = n > 160;
  const trees = Array.from({ length: n }, (_, i) =>
    dendriteTree(i * 2654435761, Math.min(big ? 4 : 6, 3 + Math.round(Math.sqrt(adj[i]!.length))), big ? 2 : 3),
  );
  return {
    n,
    key,
    ends,
    adj,
    fire: new Float32Array(n),
    rest: new Float32Array(n),
    next: Float32Array.from({ length: n }, () => 2 + rnd() * 30),
    pulses: [],
    trees,
  };
}

/** Fires a cell: it flashes and sends signals down most of its axons. */
export function fireCell(
  net: Network,
  i: number,
  opts: { from?: number; force?: boolean; rnd?: () => number } = {},
): boolean {
  const rnd = opts.rnd ?? Math.random;
  if (!opts.force && net.rest[i]! > 0) return false;
  net.fire[i] = 1;
  net.rest[i] = REFRACTORY;
  for (const e of net.adj[i] ?? []) {
    if (e === opts.from) continue;
    if (net.pulses.length >= MAX_PULSES) break;
    if (rnd() > 0.4) continue;
    net.pulses.push({ e, dir: net.ends[e * 2] === i ? 1 : -1, u: 0, speed: 0.22 + rnd() * 0.18 });
  }
  return true;
}

/** Advances flashes and signals; arriving signals may fire the next cell. */
export function stepNetwork(
  net: Network,
  t: number,
  dt: number,
  opts: { spontaneous?: boolean; rnd?: () => number } = {},
): void {
  const rnd = opts.rnd ?? Math.random;
  const decay = Math.exp(-dt * 1.6);
  for (let i = 0; i < net.n; i++) {
    net.fire[i] = net.fire[i]! * decay;
    net.rest[i] = Math.max(0, net.rest[i]! - dt);
    if (opts.spontaneous !== false && t >= net.next[i]!) {
      net.next[i] = t + 22 + rnd() * 40;
      fireCell(net, i, { rnd });
    }
  }
  const live: Pulse[] = [];
  const arrived: Pulse[] = [];
  for (const p of net.pulses) {
    p.u += p.speed * dt;
    (p.u >= 1 ? arrived : live).push(p);
  }
  net.pulses = live;
  for (const p of arrived) {
    const target = p.dir === 1 ? net.ends[p.e * 2 + 1]! : net.ends[p.e * 2]!;
    net.fire[target] = Math.max(net.fire[target]!, 0.35);
    if (rnd() < 0.25) fireCell(net, target, { from: p.e, rnd });
  }
}

// ── Drawing ───────────────────────────────────────────────────────────────

export type NeuronCell = {
  i: number;
  /** Soma radius, px. */
  size: number;
  /** Dendrite reach, px. */
  reach: number;
  alpha: number;
};
export type NeuronAxon = { e: number; alpha: number };

export type NeuronFrame = {
  ctx: CanvasRenderingContext2D;
  t: number;
  /** [sx, sy, persp] per cell index. */
  proj: Float32Array;
  net: Network;
  cells: NeuronCell[];
  axons: NeuronAxon[];
  /** "r, g, b" of the ink (tissue) and the accent (signals). */
  ink: string;
  accent: string;
  /** Additive light on dark grounds; plain alpha on light ones. */
  additive: boolean;
  /** "r, g, b" of the ground: a dark field under the network on dark themes. */
  paper: string;
  fieldRadius: number;
  cx: number;
  cy: number;
  /** 1 = normal sway; lower for reduced motion. */
  sway: number;
};

/** Point on an axon (a gentle quadratic arc that sways slowly). */
function axonGeometry(f: NeuronFrame, e: number) {
  const ia = f.net.ends[e * 2]!;
  const ib = f.net.ends[e * 2 + 1]!;
  const ax = f.proj[ia * 3]!;
  const ay = f.proj[ia * 3 + 1]!;
  const bx = f.proj[ib * 3]!;
  const by = f.proj[ib * 3 + 1]!;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const s = seeded(ia * 31 + 7, ib * 17 + 3);
  const bend = (s - 0.5) * 0.42 * len + Math.sin(f.t * (0.25 + s * 0.3) + s * TAU) * len * 0.03 * f.sway;
  const qx = (ax + bx) / 2 + nx * bend;
  const qy = (ay + by) / 2 + ny * bend;
  const at = (u: number): [number, number] => {
    const v = 1 - u;
    return [v * v * ax + 2 * v * u * qx + u * u * bx, v * v * ay + 2 * v * u * qy + u * u * by];
  };
  return { ia, ib, ax, ay, bx, by, len, at };
}

export function drawNeurons(f: NeuronFrame): void {
  const { ctx, proj, ink, accent, net } = f;
  const tissue = (a: number) => `rgba(${ink}, ${a})`;
  const signal = (a: number) => `rgba(${accent}, ${a})`;
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
  ctx.lineJoin = "round";
  const light = f.additive ? 1 : 0.8;

  // ── Dendrites: tapering branches, swaying a little like tissue ──────
  const LEVEL_W = [1.25, 0.75, 0.45];
  const LEVEL_A = [0.34, 0.26, 0.18];
  for (const c of f.cells) {
    const x = proj[c.i * 3]!;
    const y = proj[c.i * 3 + 1]!;
    const persp = proj[c.i * 3 + 2]!;
    const tree = net.trees[c.i];
    if (!tree) continue;
    const scale = c.reach;
    const ph = seeded(c.i, 41) * TAU;
    const fr = 0.5 + seeded(c.i, 43) * 0.5;
    const glowUp = 1 + net.fire[c.i]! * 0.9;
    const map = (ux: number, uy: number): [number, number] => {
      const d = Math.hypot(ux, uy);
      const m = d * 0.07 * f.sway * Math.sin(f.t * fr + ph + d * 4);
      return [x + (ux - uy * m) * scale, y + (uy + ux * m) * scale];
    };
    for (let level = 0; level < tree.length; level++) {
      const seg = tree[level]!;
      ctx.lineWidth = LEVEL_W[level]! * Math.max(0.6, persp);
      ctx.strokeStyle = tissue(Math.min(1, LEVEL_A[level]! * c.alpha * glowUp * light));
      ctx.beginPath();
      for (let k = 0; k < seg.length; k += 4) {
        const [x0, y0] = map(seg[k]!, seg[k + 1]!);
        const [x1, y1] = map(seg[k + 2]!, seg[k + 3]!);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    }
  }

  // ── Axons: one fibre per link, thick at the hillock, synapses at the end ─
  const sizeOf = new Map<number, number>();
  for (const c of f.cells) sizeOf.set(c.i, c.size);
  for (const a of f.axons) {
    const g = axonGeometry(f, a.e);
    if (g.len < 4) continue;
    const alpha = Math.min(1, a.alpha * light);
    // Hillock: the first stretch is a bit thicker.
    ctx.strokeStyle = tissue(0.3 * alpha);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(g.ax, g.ay);
    for (let j = 1; j <= 5; j++) {
      const [px, py] = g.at((j / 5) * 0.22);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = tissue(0.26 * alpha);
    ctx.beginPath();
    ctx.moveTo(g.ax, g.ay);
    const end = 0.86;
    for (let j = 1; j <= 16; j++) {
      const [px, py] = g.at((j / 16) * end);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    // Synaptic terminals: a few short branches ending in small boutons.
    const [tx, ty] = g.at(end);
    const back = Math.atan2(ty - g.by, tx - g.bx);
    const r = (sizeOf.get(g.ib) ?? 2) * 2.6;
    for (let k = 0; k < 3; k++) {
      const ang = back + (k - 1) * 0.65 + (seeded(a.e, k) - 0.5) * 0.4;
      const ex = g.bx + Math.cos(ang) * r;
      const ey = g.by + Math.sin(ang) * r;
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = tissue(0.24 * alpha);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo((tx + ex) / 2 + (ey - ty) * 0.2, (ty + ey) / 2 - (ex - tx) * 0.2, ex, ey);
      ctx.stroke();
      ctx.fillStyle = tissue(0.45 * alpha);
      ctx.beginPath();
      ctx.arc(ex, ey, 0.9, 0, TAU);
      ctx.fill();
    }
  }

  // ── Signals: accent pulses running down axons with a fading tail ─────
  for (const p of net.pulses) {
    const g = axonGeometry(f, p.e);
    const pos = (u: number) => g.at(p.dir === 1 ? u * 0.86 : 0.86 - u * 0.86);
    const [hx, hy] = pos(p.u);
    const TAIL = 10;
    ctx.lineWidth = 1;
    for (let j = 0; j < TAIL; j++) {
      const u0 = Math.max(0, p.u - (j + 1) * 0.022);
      const u1 = Math.max(0, p.u - j * 0.022);
      if (u1 <= 0) break;
      const [x0, y0] = pos(u0);
      const [x1, y1] = pos(u1);
      ctx.strokeStyle = signal(0.32 * (1 - j / TAIL));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 6);
    glow.addColorStop(0, signal(0.22));
    glow.addColorStop(1, signal(0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(hx, hy, 6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = signal(0.6);
    ctx.beginPath();
    ctx.arc(hx, hy, 1.1, 0, TAU);
    ctx.fill();
  }

  // ── Somas: a soft halo, the cell body, and an accent flash on firing ──
  for (const c of f.cells) {
    const x = proj[c.i * 3]!;
    const y = proj[c.i * 3 + 1]!;
    const r = c.size;
    const fire = net.fire[c.i]!;
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
    halo.addColorStop(0, tissue(0.3 * c.alpha * light));
    halo.addColorStop(1, tissue(0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 5, 0, TAU);
    ctx.fill();
    if (fire > 0.02) {
      const fr = r * (3 + 3 * fire);
      const flash = ctx.createRadialGradient(x, y, 0, x, y, fr);
      flash.addColorStop(0, signal(0.28 * fire));
      flash.addColorStop(1, signal(0));
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.arc(x, y, fr, 0, TAU);
      ctx.fill();
    }
    // Slightly irregular body: an ellipse at the cell's own angle.
    const rot = seeded(c.i, 5) * Math.PI;
    ctx.fillStyle = tissue(Math.min(1, (0.75 + 0.25 * fire) * c.alpha + 0.05));
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.15, r * 0.85, rot, 0, TAU);
    ctx.fill();
    if (fire > 0.02) {
      ctx.fillStyle = signal(0.55 * fire);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.55, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

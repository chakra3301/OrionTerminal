/**
 * "Veins" rendering for the Brain graph. Neurons are the concept, not the
 * costume (owner, 2026-11-07: "everything on this should be intentional and
 * have a purpose"). Every mark carries data:
 * - a vein is a real link; it is widest where it leaves a note and thins
 *   toward the middle, so a note's body is just where its links meet;
 * - a note is soft light at that meeting point, brighter with more links;
 *   nothing is drawn that doesn't connect to something;
 * - a signal is a faint pulse in the user's highlight colour travelling a
 *   real link, sometimes passing on to the next note.
 * Notes never move (they're click targets); veins sway slightly.
 * Pure model + drawing: the caller owns layout, camera and input.
 */

const TAU = Math.PI * 2;

/** Deterministic 0..1 from two integers (stable shapes per link). */
export function seeded(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * Vein half-width at a point `dA` px from one note and `dB` px from the other:
 * the root width of each note, falling off to a thin core along the link.
 */
export function veinWidth(dA: number, dB: number, wa: number, wb: number, core: number, falloff: number): number {
  return core + Math.max(0, wa - core) * Math.exp(-dA / falloff) + Math.max(0, wb - core) * Math.exp(-dB / falloff);
}

// ── Network: firing and signals ───────────────────────────────────────────

export type Pulse = { e: number; dir: 1 | -1; u: number; speed: number };

export type Network = {
  n: number;
  key: string;
  /** ia, ib per link. */
  ends: Int32Array;
  /** Link indices per note. */
  adj: number[][];
  /** 0..1 flash per note; decays after it fires. */
  fire: Float32Array;
  /** Seconds until the note can fire again. */
  rest: Float32Array;
  /** Time of the next spontaneous firing per note. */
  next: Float32Array;
  pulses: Pulse[];
};

export const MAX_PULSES = 10;
export const REFRACTORY = 1.4;

function edgeKey(n: number, edges: ReadonlyArray<readonly [number, number]>): string {
  let h = 0;
  for (const [a, b] of edges) h = (Math.imul(h, 31) + a * 7919 + b) | 0;
  return `${n}:${edges.length}:${h}`;
}

/** Rebuilds the network only when notes or links change, so firing never resets mid-flow. */
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
  return {
    n,
    key,
    ends,
    adj,
    fire: new Float32Array(n),
    rest: new Float32Array(n),
    next: Float32Array.from({ length: n }, () => 2 + rnd() * 30),
    pulses: [],
  };
}

/** Fires a note: it glows and sends signals down some of its links. */
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

/** Advances glows and signals; an arriving signal may fire the next note. */
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
      if (net.adj[i]!.length > 0) fireCell(net, i, { rnd });
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

export type VeinNode = {
  i: number;
  /** Vein half-width where this note's links leave it, px (grows with link count). */
  root: number;
  alpha: number;
  /** 0..1: selected or hovered, shown as highlight-coloured light. */
  focus: number;
};
export type Vein = { e: number; alpha: number };

export type VeinFrame = {
  ctx: CanvasRenderingContext2D;
  t: number;
  /** [sx, sy, persp] per note index. */
  proj: Float32Array;
  net: Network;
  nodes: VeinNode[];
  veins: Vein[];
  /** "r, g, b" of the ink (veins, notes) and the highlight (signals, focus). */
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
  /** How far a vein's root width carries along it, px. */
  falloff: number;
};

/** A link's curve: a gentle arc with its own slow sway; ends pinned to the notes. */
function veinCurve(f: VeinFrame, e: number) {
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
  const bend = (s - 0.5) * 0.36 * len + Math.sin(f.t * (0.2 + s * 0.25) + s * TAU) * len * 0.025 * f.sway;
  const qx = (ax + bx) / 2 + nx * bend;
  const qy = (ay + by) / 2 + ny * bend;
  const at = (u: number): [number, number] => {
    const v = 1 - u;
    return [v * v * ax + 2 * v * u * qx + u * u * bx, v * v * ay + 2 * v * u * qy + u * u * by];
  };
  const tangent = (u: number): [number, number] => {
    const tx = 2 * (1 - u) * (qx - ax) + 2 * u * (bx - qx);
    const ty = 2 * (1 - u) * (qy - ay) + 2 * u * (by - qy);
    const l = Math.hypot(tx, ty) || 1;
    return [tx / l, ty / l];
  };
  return { ia, ib, len, at, tangent };
}

export function drawVeins(f: VeinFrame): void {
  const { ctx, proj, ink, accent, net } = f;
  const tissue = (a: number) => `rgba(${ink}, ${a})`;
  const signal = (a: number) => `rgba(${accent}, ${a})`;
  const light = f.additive ? 1 : 0.8;
  const rootOf = new Float32Array(net.n);
  for (const node of f.nodes) rootOf[node.i] = node.root;

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

  // ── Veins: one tapered shape per real link ──────────────────────────
  const left: number[] = [];
  const right: number[] = [];
  for (const v of f.veins) {
    const c = veinCurve(f, v.e);
    if (c.len < 3) continue;
    const wa = rootOf[c.ia]!;
    const wb = rootOf[c.ib]!;
    const steps = Math.max(10, Math.min(32, Math.round(c.len / 6)));
    left.length = 0;
    right.length = 0;
    for (let j = 0; j <= steps; j++) {
      const u = j / steps;
      const [x, y] = c.at(u);
      const [tx, ty] = c.tangent(u);
      const hw = veinWidth(u * c.len, (1 - u) * c.len, wa, wb, 0.35, f.falloff);
      left.push(x - ty * hw, y + tx * hw);
      right.push(x + ty * hw, y - tx * hw);
    }
    ctx.fillStyle = tissue(Math.min(1, 0.3 * v.alpha * light));
    ctx.beginPath();
    ctx.moveTo(left[0]!, left[1]!);
    for (let k = 2; k < left.length; k += 2) ctx.lineTo(left[k]!, left[k + 1]!);
    for (let k = right.length - 2; k >= 0; k -= 2) ctx.lineTo(right[k]!, right[k + 1]!);
    ctx.closePath();
    ctx.fill();
  }

  // ── Signals: faint highlight pulses travelling real links ───────────
  ctx.lineCap = "round";
  for (const p of net.pulses) {
    const c = veinCurve(f, p.e);
    const pos = (u: number) => c.at(p.dir === 1 ? u : 1 - u);
    const TAIL = 10;
    ctx.lineWidth = 1;
    for (let j = 0; j < TAIL; j++) {
      const u1 = p.u - j * 0.022;
      if (u1 <= 0) break;
      const [x0, y0] = pos(Math.max(0, u1 - 0.022));
      const [x1, y1] = pos(u1);
      ctx.strokeStyle = signal(0.32 * (1 - j / TAIL));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    const [hx, hy] = pos(p.u);
    const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 6);
    glow.addColorStop(0, signal(0.25));
    glow.addColorStop(1, signal(0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(hx, hy, 6, 0, TAU);
    ctx.fill();
  }

  // ── Notes: soft light where the veins meet; no hard shapes ──────────
  for (const node of f.nodes) {
    const x = proj[node.i * 3]!;
    const y = proj[node.i * 3 + 1]!;
    const r = Math.max(2.5, node.root * 3);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, tissue(Math.min(1, 0.85 * node.alpha * light)));
    g.addColorStop(0.3, tissue(0.35 * node.alpha * light));
    g.addColorStop(1, tissue(0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    // Highlight light: firing (faint) or focus (hover/selection).
    const lit = Math.max(net.fire[node.i]! * 0.3, node.focus * 0.45);
    if (lit > 0.01) {
      const lr = r * 2.2;
      const a = ctx.createRadialGradient(x, y, 0, x, y, lr);
      a.addColorStop(0, signal(lit));
      a.addColorStop(1, signal(0));
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.arc(x, y, lr, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Flow for the filament Brain, after the feel of Orion's R.O.S.I.E orb (owner,
 * 2026-11-05: "more flowy … like that feeling"). The motion is reimplemented
 * here because Archives 47 must not import Orion's shell. The orb's ingredients:
 * - every point breathes on its own phase and frequency;
 * - a shared slow current moves the whole cloud together, like water;
 * - the cursor pushes points aside and they spring back with a damped wobble;
 * - one slow breath (about 6 s) pulses the glow.
 * All offsets are in screen px, applied on top of the projected layout, so
 * the force layout and saved positions never change.
 */
import { seeded } from "./filaments";

export type Flow = {
  n: number;
  ox: Float32Array;
  oy: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** 0..1 per node: how close the cursor is (brightens like the orb). */
  near: Float32Array;
  last: { x: number; y: number } | null;
};

export function createFlow(n: number): Flow {
  return {
    n,
    ox: new Float32Array(n),
    oy: new Float32Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    near: new Float32Array(n),
    last: null,
  };
}

/** Keeps the state when the node count is unchanged, so motion never jumps. */
export function ensureFlow(flow: Flow | null, n: number): Flow {
  return flow && flow.n === n ? flow : createFlow(n);
}

/** The orb's breath: 0 → 1 → 0 about every 5.7 s. */
export function breath(t: number): number {
  return 0.5 - 0.5 * Math.cos(t * 1.1);
}

/**
 * Moves each projected point (proj = [sx, sy, persp] per node) in place.
 * `reach` is the cursor's radius of influence in px.
 */
export function stepFlow(
  flow: Flow,
  proj: Float32Array,
  t: number,
  pointer: { x: number; y: number } | null,
  reach: number,
): void {
  const mv = pointer && flow.last ? { x: pointer.x - flow.last.x, y: pointer.y - flow.last.y } : { x: 0, y: 0 };
  flow.last = pointer && { ...pointer };
  const cap = reach * 0.15;
  mv.x = Math.max(-cap, Math.min(cap, mv.x));
  mv.y = Math.max(-cap, Math.min(cap, mv.y));

  for (let i = 0; i < flow.n; i++) {
    const x = proj[i * 3]!;
    const y = proj[i * 3 + 1]!;
    const persp = proj[i * 3 + 2]!;
    const ph = seeded(i, 1) * Math.PI * 2;
    const fr = 0.6 + seeded(i, 2) * 1.6;
    const sens = 0.3 + seeded(i, 3) * 1.4;
    const k = 0.025 + seeded(i, 4) * 0.06;

    // Own breath plus the shared current (a slow travelling wave across the cloud).
    const amp = 5 * persp;
    const dx = Math.sin(t * fr * 0.45 + ph) * amp + Math.sin(y * 0.006 + t * 0.42) * amp * 1.4;
    const dy = Math.cos(t * fr * 0.38 + ph * 1.3) * amp + Math.cos(x * 0.006 - t * 0.35) * amp * 1.4;

    // Cursor push with a damped spring, as in the orb.
    let ox = flow.ox[i]!;
    let oy = flow.oy[i]!;
    let vx = flow.vx[i]!;
    let vy = flow.vy[i]!;
    let near = 0;
    if (pointer) {
      const px = x + dx + ox - pointer.x;
      const py = y + dy + oy - pointer.y;
      const d2 = px * px + py * py;
      if (d2 < reach * reach) {
        const d = Math.sqrt(d2) + 1e-3;
        const fall = 1 - d / reach;
        const force = fall * fall * sens;
        vx += ((px / d) * reach * 0.03 + mv.x * 0.3) * force;
        vy += ((py / d) * reach * 0.03 + mv.y * 0.3) * force;
        near = fall;
      }
    }
    vx = (vx - ox * k) * 0.88;
    vy = (vy - oy * k) * 0.88;
    ox += vx;
    oy += vy;
    flow.ox[i] = ox;
    flow.oy[i] = oy;
    flow.vx[i] = vx;
    flow.vy[i] = vy;
    // Ease the glow so it fades out instead of blinking.
    flow.near[i] = Math.max(near, flow.near[i]! * 0.94);

    proj[i * 3] = x + dx + ox;
    proj[i * 3 + 1] = y + dy + oy;
  }
}

/**
 * Cursor and breath for the filament Brain, after the feel of Orion's
 * R.O.S.I.E orb. Nodes are anchors: they never move here, so clicking them
 * stays exact (owner, 2026-11-05: "the nodes are like anchors and everything
 * else has fluid movement"). The strands do all the moving (see filaments.ts);
 * this module only tracks an eased cursor the strands part around, and how
 * close each node is to it (for glow).
 * Reimplemented, not imported: Archives 47 must not import Orion's shell.
 */

export type Flow = {
  n: number;
  /** 0..1 per node: how close the cursor is (brightens like the orb). */
  near: Float32Array;
  /** Eased cursor position the strands react to. */
  pointer: { x: number; y: number } | null;
  /** 0..1: eases in when the cursor arrives and out when it leaves. */
  strength: number;
};

export function createFlow(n: number): Flow {
  return { n, near: new Float32Array(n), pointer: null, strength: 0 };
}

/** Keeps the state when the node count is unchanged, so motion never jumps. */
export function ensureFlow(flow: Flow | null, n: number): Flow {
  return flow && flow.n === n ? flow : createFlow(n);
}

/** The orb's breath: 0 → 1 → 0 about every 5.7 s. */
export function breath(t: number): number {
  return 0.5 - 0.5 * Math.cos(t * 1.1);
}

/** Eases the cursor and measures each node's nearness. Never moves a node. */
export function stepFlow(
  flow: Flow,
  proj: Float32Array,
  pointer: { x: number; y: number } | null,
  reach: number,
): void {
  if (pointer) {
    flow.pointer = flow.pointer
      ? {
          x: flow.pointer.x + (pointer.x - flow.pointer.x) * 0.14,
          y: flow.pointer.y + (pointer.y - flow.pointer.y) * 0.14,
        }
      : { ...pointer };
  }
  flow.strength += ((pointer ? 1 : 0) - flow.strength) * 0.06;
  if (flow.strength < 0.002 && !pointer) flow.pointer = null;
  const p = flow.pointer;
  for (let i = 0; i < flow.n; i++) {
    let near = 0;
    if (p) {
      const d = Math.hypot(proj[i * 3]! - p.x, proj[i * 3 + 1]! - p.y);
      if (d < reach) near = (1 - d / reach) * flow.strength;
    }
    // Ease the glow so it fades out instead of blinking.
    flow.near[i] = Math.max(near, flow.near[i]! * 0.94);
  }
}

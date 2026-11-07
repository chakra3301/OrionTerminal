/**
 * Idle life for the Brain (owner, 2026-11-07: "i want it constantly moving
 * like before some type of idle movement even the nodes slowly reshaping").
 * Each free note wanders on its own slow 3D path (periods of roughly 15–45 s);
 * the force layout keeps running gently underneath, so links stretch and the
 * whole network slowly reshapes instead of sliding as one block.
 * Pinned notes, the hovered note and the dragged note hold still, so clicks
 * and drags stay easy.
 */
import type { LayoutNode } from "./forceLayout";
import { seeded } from "./veins";

/** How far a note wanders from where the layout puts it, in layout units. */
export const DRIFT_AMPLITUDE = 22;
/** The layout never fully settles while drifting, so neighbours follow. */
export const DRIFT_ALPHA_FLOOR = 0.06;

/** A note's wander offset at time t (seconds): a slow Lissajous path of its own. */
export function wander(id: string, t: number, amp = DRIFT_AMPLITUDE): [number, number, number] {
  let h = 0;
  for (let k = 0; k < id.length; k++) h = (Math.imul(h, 31) + id.charCodeAt(k)) | 0;
  const out: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const f1 = (Math.PI * 2) / (15 + seeded(h, axis * 2) * 30);
    const f2 = (Math.PI * 2) / (9 + seeded(h, axis * 2 + 1) * 14);
    const p1 = seeded(h + 1, axis) * Math.PI * 2;
    const p2 = seeded(h + 2, axis) * Math.PI * 2;
    out[axis] = amp * (0.75 * Math.sin(t * f1 + p1) + 0.25 * Math.sin(t * f2 + p2));
  }
  return out;
}

/**
 * Moves every free note by how much its wander path advanced since the last
 * frame. Notes in `hold` (hovered, dragged) and pinned notes don't move.
 */
export function applyDrift(nodes: LayoutNode[], t0: number, t1: number, hold: ReadonlySet<number>, scale = 1): void {
  if (t1 <= t0) return;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    if (hold.has(i) || n.fx != null) continue;
    const a = wander(n.id, t0, DRIFT_AMPLITUDE * scale);
    const b = wander(n.id, t1, DRIFT_AMPLITUDE * scale);
    n.x += b[0] - a[0];
    n.y += b[1] - a[1];
    n.z += b[2] - a[2];
  }
}

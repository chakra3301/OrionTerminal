// Shift with painting tools, as in Photoshop and Photocraft's stroke_constraint.rs: a Shift-drag stays on a
// 0°, 45° or 90° line from where Shift took effect, locking its direction once the pointer has moved a few
// screen pixels, and the Gradient tool's Shift snaps the angle to 45°.

export type XY = [number, number];
export type Axis = { origin: XY; dir: XY | null };

const LOCK_DISTANCE = 3;

export function snappedDir(origin: XY, p: XY, step: number): XY | null {
  const dx = p[0] - origin[0], dy = p[1] - origin[1];
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1e-9 || step <= 0) return null;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [Math.cos(angle), Math.sin(angle)];
}

export function project(origin: XY, dir: XY, p: XY): XY {
  const t = (p[0] - origin[0]) * dir[0] + (p[1] - origin[1]) * dir[1];
  return [origin[0] + dir[0] * t, origin[1] + dir[1] * t];
}

export function snap45(origin: XY, p: XY): XY {
  const dir = snappedDir(origin, p, Math.PI / 4);
  return dir ? project(origin, dir, p) : p;
}

/** Constrains `p` for a stroke that has reached `last`. `axis` carries the lock between events; releasing Shift drops it. */
export function constrain(axis: { current: Axis | null }, last: XY, p: XY, shift: boolean, zoom: number): XY {
  if (!shift) { axis.current = null; return p; }
  const lock = axis.current ??= { origin: last, dir: null };
  if (!lock.dir) {
    if (Math.hypot(p[0] - lock.origin[0], p[1] - lock.origin[1]) < LOCK_DISTANCE / Math.max(zoom, 1e-3)) return lock.origin;
    lock.dir = snappedDir(lock.origin, p, Math.PI / 4);
  }
  return lock.dir ? project(lock.origin, lock.dir, p) : lock.origin;
}

export type Point3 = [number, number, number];
export type Pointer = { x: number; y: number };
export type ParticleGroup = { pts: Point3[]; ph: Float32Array; fr: Float32Array; sens: Float32Array; k: Float32Array };

export function orbModel() {
  let seed = 47;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const unit = (): Point3 => {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return [r * Math.cos(a), z, r * Math.sin(a)];
  };
  const group = (pts: Point3[]): ParticleGroup => ({
    pts,
    ph: Float32Array.from(pts, () => rnd() * Math.PI * 2),
    fr: Float32Array.from(pts, () => 0.6 + rnd() * 1.6),
    sens: Float32Array.from(pts, () => 0.3 + rnd() * 1.4),
    k: Float32Array.from(pts, () => 0.025 + rnd() * 0.06),
  });
  const centres = Array.from({ length: 18 }, unit), shell: Point3[] = [], N = 2600, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - ((i + 0.5) / N) * 2, r = Math.sqrt(1 - y * y), p: Point3 = [r * Math.cos(i * ga), y, r * Math.sin(i * ga)];
    const f = Math.max(...centres.map((c) => c[0] * p[0] + c[1] * p[1] + c[2] * p[2]));
    if (f > 0.94 || rnd() < 0.05) shell.push(p);
  }
  const nodes = Array.from({ length: 70 }, unit), links: [number, number][] = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i]!, b = nodes[j]!;
    if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.85) links.push([i, j]);
  }
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const core = Array.from({ length: 320 }, (): Point3 => [gauss() * 0.45, gauss() * 0.45, gauss() * 0.45]);
  return { shell: group(shell), nodes: group(nodes), links, spikes: group(Array.from({ length: 46 }, unit)), core: group(core) };
}

export function particlePhysics(group: ParticleGroup) {
  const n = group.pts.length;
  return { ox: new Float32Array(n), oy: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n) };
}

export function stepParticle(
  state: ReturnType<typeof particlePhysics>, group: ParticleGroup, i: number,
  point: { x: number; y: number; z: number }, mouse: Pointer | null, velocity: Pointer, radius: number,
): number {
  let ox = state.ox[i]!, oy = state.oy[i]!, vx = state.vx[i]!, vy = state.vy[i]!, near = 0;
  const reach = radius * 0.7;
  if (mouse) {
    const dx = point.x + ox - mouse.x, dy = point.y + oy - mouse.y, d2 = dx * dx + dy * dy;
    if (d2 < reach * reach) {
      const d = Math.sqrt(d2) + 1e-3, fall = 1 - d / reach;
      const force = fall * fall * group.sens[i]! * (0.55 + 0.45 * (0.5 + 0.5 * point.z));
      vx += ((dx / d) * radius * 0.03 + velocity.x * 0.3) * force;
      vy += ((dy / d) * radius * 0.03 + velocity.y * 0.3) * force;
      near = fall;
    }
  }
  const spring = group.k[i]!;
  vx = (vx - ox * spring) * 0.88; vy = (vy - oy * spring) * 0.88;
  ox += vx; oy += vy;
  state.ox[i] = ox; state.oy[i] = oy; state.vx[i] = vx; state.vy[i] = vy;
  point.x += ox; point.y += oy;
  return near;
}

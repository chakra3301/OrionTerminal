import { rgba } from "./iconCanvas";
import { stepParticle, type Point3, type ParticleGroup, type particlePhysics } from "./orbModel";
import type { OrbCanvas } from "./orbCanvas";

export function drawRosieField(o: OrbCanvas, t: number, reduced: boolean, interior?: () => void) {
  const { x, P, R, q, st, model: M, color: ORB, coreColor: ORB_CORE } = o, cx = P / 2, cy = P / 2;
  // Defer the near hemisphere so an interior sits inside the original shell.
  const foreground: { line: boolean; ax: number; ay: number; bx: number; by: number; alpha: number }[] = [];
  const dot = (px: number, py: number, size: number, z: number) => {
    if (interior && z > 0) foreground.push({ line: false, ax: px, ay: py, bx: size, by: size, alpha: x.globalAlpha });
    else x.fillRect(px, py, size, size);
  };
  const line = (ax: number, ay: number, bx: number, by: number, z: number) => {
    if (interior && z > 0) foreground.push({ line: true, ax, ay, bx, by, alpha: x.globalAlpha });
    else { x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke(); }
  };
  const motion = reduced ? t * 0.25 : t;
  const a = motion * 0.3, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(0.38), sb = Math.sin(0.38);
  const point = { x: 0, y: 0, z: 0 };
  const proj = (p: Point3, k: number) => {
    const X0 = p[0] * ca + p[2] * sa, Z0 = -p[0] * sa + p[2] * ca, Y0 = p[1] * cb - Z0 * sb, f = R * k;
    point.z = p[1] * sb + Z0 * cb; point.x = cx + X0 * f * (1 + point.z * 0.12); point.y = cy + Y0 * f * (1 + point.z * 0.12);
  };
  const m = o.m, mv = m && o.last ? { x: m.x - o.last.x, y: m.y - o.last.y } : { x: 0, y: 0 };
  o.last = m && { ...m };
  const cap = R * 0.15; mv.x = Math.max(-cap, Math.min(cap, mv.x)); mv.y = Math.max(-cap, Math.min(cap, mv.y));
  let near = 0;
  const move = (state: ReturnType<typeof particlePhysics>, group: ParticleGroup, i: number) => {
    near = stepParticle(state, group, i, point, m, mv, R);
  };

  x.clearRect(0, 0, P, P); x.globalCompositeOperation = "lighter";
  const breath = reduced ? 0.5 : 0.5 - 0.5 * Math.cos(t * 1.1), spread = 0.16 + 0.5 * breath;
  const bg = x.createRadialGradient(cx, cy, 0, cx, cy, R * 1.3);
  bg.addColorStop(0, rgba(ORB, 0.1)); bg.addColorStop(0.7, rgba(ORB, 0.04)); bg.addColorStop(1, rgba(ORB, 0));
  x.globalAlpha = 1; x.fillStyle = bg; x.fillRect(0, 0, P, P);
  const ds = Math.max(q * 0.75, R * 0.016);

  x.fillStyle = ORB;
  const SH = M.shell;
  for (let i = 0; i < SH.pts.length; i++) {
    const w = motion * SH.fr[i]! + SH.ph[i]!;
    proj(SH.pts[i]!, 1 + 0.014 * Math.sin(w)); move(st.shell, SH, i);
    x.globalAlpha = Math.min(1, (0.16 + 0.6 * (0.5 + 0.5 * point.z)) * (0.7 + 0.3 * Math.sin(w * 1.7)) + 0.45 * near);
    dot(point.x - ds / 2, point.y - ds / 2, ds, point.z);
  }
  const ND = M.nodes, xy = o.nodeXY;
  for (let i = 0; i < ND.pts.length; i++) { proj(ND.pts[i]!, 1.005 + 0.012 * Math.sin(motion * ND.fr[i]! + ND.ph[i]!)); move(st.nodes, ND, i); xy[i * 3] = point.x; xy[i * 3 + 1] = point.y; xy[i * 3 + 2] = point.z; }
  x.strokeStyle = ORB; x.lineWidth = Math.max(q * 0.5, R * 0.007);
  for (const [i, j] of M.links) {
    x.globalAlpha = 0.08 + 0.42 * (1 + (xy[i * 3 + 2]! + xy[j * 3 + 2]!) / 2) / 2;
    line(xy[i * 3]!, xy[i * 3 + 1]!, xy[j * 3]!, xy[j * 3 + 1]!, (xy[i * 3 + 2]! + xy[j * 3 + 2]!) / 2);
  }
  for (let i = 0; i < ND.pts.length; i++) { x.globalAlpha = 0.2 + 0.7 * (0.5 + 0.5 * xy[i * 3 + 2]!); dot(xy[i * 3]! - ds, xy[i * 3 + 1]! - ds, ds * 2, xy[i * 3 + 2]!); }
  const SP = M.spikes;
  for (let i = 0; i < SP.pts.length; i++) {
    const p = SP.pts[i]!, len = 1.08 + 0.04 * Math.sin(motion * SP.fr[i]! + SP.ph[i]!);
    proj(p, len); const bx = point.x, by = point.y; proj(p, 1.04); const ax = point.x, ay = point.y, az = point.z;
    move(st.spikes, SP, i); const ox = point.x - ax, oy = point.y - ay;
    x.globalAlpha = 0.1 + 0.6 * (1 - Math.abs(az)); line(ax + ox, ay + oy, bx + ox, by + oy, az);
  }
  const cg = x.createRadialGradient(cx, cy, 0, cx, cy, R * (spread + 0.12));
  cg.addColorStop(0, rgba(ORB_CORE, 0.55 * (1 - breath) + 0.12)); cg.addColorStop(1, rgba(ORB, 0));
  x.globalAlpha = 1; x.fillStyle = cg; x.fillRect(0, 0, P, P);
  x.fillStyle = ORB_CORE;
  const CO = M.core;
  for (let i = 0; i < CO.pts.length; i++) {
    proj(CO.pts[i]!, spread * (1 + 0.14 * Math.sin(motion * CO.fr[i]! + CO.ph[i]!))); move(st.core, CO, i);
    x.globalAlpha = Math.min(1, 0.95 - 0.55 * breath + 0.3 * near); x.fillRect(point.x - ds / 2, point.y - ds / 2, ds, ds);
  }
  if (interior) {
    interior();
    x.globalCompositeOperation = "lighter"; x.fillStyle = x.strokeStyle = ORB;
    x.lineWidth = Math.max(q * 0.5, R * 0.007);
    x.lineCap = "butt"; x.lineJoin = "miter";
    for (const mark of foreground) {
      x.globalAlpha = mark.alpha;
      if (mark.line) { x.beginPath(); x.moveTo(mark.ax, mark.ay); x.lineTo(mark.bx, mark.by); x.stroke(); }
      else x.fillRect(mark.ax, mark.ay, mark.bx, mark.by);
    }
  }
  x.globalCompositeOperation = "source-over"; x.globalAlpha = 1;
}

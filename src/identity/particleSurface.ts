import { identitySeed } from "./glyph";
import { particlePhysics, stepParticle, type ParticleGroup, type Point3 } from "@/shell/dock/orbModel";
import type { OrbCanvas } from "@/shell/dock/orbCanvas";
import type { SpatialKind } from "./spatialIdentity";

export type SurfaceKind = "membrane" | "ribbons" | "sculpted" | "vortex" | "silk";
export const SURFACE_LABELS: Record<SurfaceKind, string> = {
  membrane: "Iridescent membrane", ribbons: "Fraying ribbons", sculpted: "Sculpted dust", vortex: "Particle current", silk: "Rolling silver folds",
};
const KINDS: SurfaceKind[] = ["membrane", "ribbons", "sculpted", "vortex", "silk"];
const FORMS: Record<SpatialKind, SurfaceKind> = {
  atom: "membrane", quotation: "ribbons", crystal: "silk", prism: "sculpted", helix: "vortex", bloom: "membrane", knot: "ribbons", waveform: "vortex",
};
const WEIGHTS: Record<SurfaceKind, readonly [number, number, number]> = {
  silk: [.13, .085, .035], sculpted: [.17, .10, .045], vortex: [.065, .04, .015], membrane: [.14, .07, .025], ribbons: [.14, .07, .025],
};
const TAU = Math.PI * 2;
const LAYER_BUCKETS = 4 * 3 * 12;
const fract = (n: number) => n - Math.floor(n);
export const surfaceKind = (identity: string, form?: SpatialKind): SurfaceKind => form ? FORMS[form] : KINDS[identitySeed(identity) % KINDS.length]!;

export type ParticleSurface = {
  seed: number; kind: SurfaceKind; group: ParticleGroup;
  state: ReturnType<typeof particlePhysics>;
  // x, y, z, size, light, chromatic band, opacity; reused for both depth passes.
  frame: Float32Array; buckets: number[][]; palette?: { key: string; colors: string[] };
};

export function particleSurface(identity: string, cssSize: number, form?: SpatialKind): ParticleSurface {
  const seed = identitySeed(identity), count = cssSize >= 160 ? 14000 : cssSize >= 120 ? 9000 : cssSize >= 64 ? 3200 : 2200;
  let s = seed;
  const rand = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
  const pts: Point3[] = [], ph: number[] = [], fr: number[] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - 2 * (i + .5) / count, r = Math.sqrt(1 - y * y), a = i * 2.399963229728653 + (rand() - .5) * .035;
    pts.push([Math.cos(a) * r, y, Math.sin(a) * r]); ph.push(rand() * TAU); fr.push(.6 + rand() * .8);
  }
  const group: ParticleGroup = { pts, ph: Float32Array.from(ph), fr: Float32Array.from(fr), sens: Float32Array.from(ph, () => .34 + rand() * .6), k: Float32Array.from(ph, () => .035 + rand() * .025) };
  return { seed, kind: surfaceKind(identity, form), group, state: particlePhysics(group), frame: new Float32Array(count * 7), buckets: Array.from({ length: 2 * LAYER_BUCKETS }, () => []) };
}

/** Radial derivatives give the dust a lit, folded surface rather than a wire cage. */
export function surfaceSample(kind: SurfaceKind, p: Point3, t: number, phase: number) {
  const [x, y, z] = p;
  const flow = z * 3.3 + phase + t * .21, sf = Math.sin(flow), cf = Math.cos(flow);
  const a = x * 4.2 + y * 2.8 + sf * 1.8 + t * .31 + phase;
  const b = y * 7.4 - z * 4.6 + x * 2.1 - t * .26;
  const c = z * 12 + x * 8.2 + y * 3.8 + t * .43 + phase;
  const sa = Math.sin(a), sb = Math.sin(b), sc = Math.sin(c);
  const weights = WEIGHTS[kind];
  const r = .88 + weights[0]! * sa + weights[1]! * sb + weights[2]! * sc;
  const da = weights[0]! * Math.cos(a), db = weights[1]! * Math.cos(b), dc = weights[2]! * Math.cos(c);
  const gx = da * 4.2 + db * 2.1 + dc * 8.2, gy = da * 2.8 + db * 7.4 + dc * 3.8, gz = da * cf * 5.94 - db * 4.6 + dc * 12;
  const dot = x * gx + y * gy + z * gz;
  let nx = x - (gx - x * dot) / r, ny = y - (gy - y * dot) / r, nz = z - (gz - z * dot) / r;
  const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
  const ribbon = Math.sin(y * 8.8 + x * 2.8 + Math.sin(z * 4.8 + t * .24 + phase) * 1.5 - t * .18);
  const aperture = sa * .6 + sb * .4;
  const coverage = kind === "ribbons" ? Math.min(1, Math.max(0, (Math.abs(ribbon) - .28) * 4))
    : kind === "membrane" ? Math.min(1, Math.max(0, (aperture + .52) * 4))
    : kind === "vortex" ? .45 + .55 * Math.pow(Math.abs(ribbon), 3) : 1;
  const edge = kind === "ribbons" ? Math.exp(-Math.pow((Math.abs(ribbon) - .38) * 9, 2))
    : kind === "membrane" ? Math.exp(-Math.pow((aperture + .4) * 9, 2)) : Math.pow(Math.max(0, sc), 12) * .22;
  return { x: x * r, y: y * r, z: z * r, nx, ny, nz, coverage, edge, fold: sa };
}

function palette(surface: ParticleSurface, color: string, light: boolean) {
  const key = color + light;
  if (surface.palette?.key === key) return surface.palette.colors;
  const base = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)), colors: string[] = [];
  for (let band = 0; band < 3; band++) for (let level = 0; level < 12; level++) {
    const luminance = level / 11, white = Math.pow(luminance, 2) * (band === 1 ? .83 : .55);
    const shifted = band === 0 ? base : band === 1 ? [base[1]!, base[2]!, base[0]!] : [base[2]!, base[0]!, base[1]!];
    colors.push(`rgb(${base.map((v, i) => Math.round(Math.min(255, (v * .76 + shifted[i]! * .24) * (.16 + luminance * .88) + (255 - v * .65) * white) * (light ? .84 : 1))).join(",")})`);
  }
  surface.palette = { key, colors }; return colors;
}

export function prepareSurface(o: OrbCanvas, surface: ParticleSurface, time: number) {
  const phase = surface.seed % 6283 / 1000, yaw = time * .095 + phase, pitch = .28 + Math.sin(time * .13 + phase) * .17;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const { R, P, q } = o, mouse = o.m;
  const velocity = mouse && o.last ? { x: Math.max(-R * .15, Math.min(R * .15, mouse.x - o.last.x)), y: Math.max(-R * .15, Math.min(R * .15, mouse.y - o.last.y)) } : { x: 0, y: 0 };
  surface.buckets.forEach((b) => { b.length = 0; });
  for (let i = 0; i < surface.group.pts.length; i++) {
    const p = surfaceSample(surface.kind, surface.group.pts[i]!, time, phase), noise = surface.group.ph[i]!;
    const escaping = i % 29 === 0, age = fract(time * .075 + noise / TAU), drift = escaping ? age * age * .38 : 0;
    if (surface.kind === "vortex" && i % 8 === 0) {
      const a = i / surface.group.pts.length * TAU + time * .16, strand = i % 3, tilt = strand * .9 + phase;
      const radial = 1.04 + .09 * Math.sin(a * 3 + time * .2 + strand), spread = Math.sin(noise) * .025;
      const y = Math.sin(a) * radial, z = spread + Math.sin(a * 2 + strand) * .12;
      p.x = Math.cos(a) * radial + spread; p.y = y * Math.cos(tilt) - z * Math.sin(tilt); p.z = y * Math.sin(tilt) + z * Math.cos(tilt);
      p.coverage = Math.pow(.5 + .5 * Math.sin(a * 2 - time * .3 + strand), 2); p.edge = .8;
    }
    const r = 1 + drift, px = (p.x * cy + p.z * sy) * r, zy = (p.z * cy - p.x * sy) * r;
    const py = p.y * cp - zy * sp, pz = p.y * sp + zy * cp;
    const nxx = p.nx * cy + p.nz * sy, nz0 = p.nz * cy - p.nx * sy, ny = p.ny * cp - nz0 * sp, nz = p.ny * sp + nz0 * cp;
    const k = R / (1 - pz * .12), point = { x: P / 2 + px * k, y: P / 2 + py * k, z: pz };
    const near = stepParticle(surface.state, surface.group, i, point, mouse, velocity, R);
    const diffuse = Math.max(0, -nxx * .48 - ny * .57 + nz * .66), specular = Math.pow(Math.max(0, -nxx * .28 - ny * .35 + nz * .89), 24);
    const rim = Math.pow(1 - Math.abs(nz), 3);
    const light = .16 + diffuse * .8 + specular * .55 + rim * .3 + p.edge * .45 + near * .2;
    const screenRadius = Math.hypot(px, py);
    // The near skin opens around the spatial glyph, retaining the lit folds at its perimeter.
    const window = pz > 0 ? .22 + .78 * Math.min(1, Math.max(0, (screenRadius - .24) / .5)) : .42;
    const opacity = p.coverage * window * (escaping ? Math.sin(age * Math.PI) * .7 : 1);
    const j = i * 7;
    surface.frame[j] = point.x; surface.frame[j + 1] = point.y; surface.frame[j + 2] = pz;
    surface.frame[j + 3] = Math.max(q * .28, q * .64 + R * .004) * (escaping ? .6 : 1) * (1 + p.edge * .5);
    surface.frame[j + 4] = light; surface.frame[j + 5] = p.fold; surface.frame[j + 6] = opacity;
    if (opacity < .035) continue;
    const band = p.edge > .3 ? 1 : p.fold > .5 ? 2 : 0;
    const level = Math.min(11, Math.max(0, Math.round(light * 11))), alpha = Math.min(3, Math.floor(opacity * 4));
    surface.buckets[(pz > 0 ? LAYER_BUCKETS : 0) + alpha * 36 + band * 12 + level]!.push(i);
  }
}

export function drawSurfaceLayer(o: OrbCanvas, surface: ParticleSurface, front: boolean) {
  const { x, R, color } = o, ink = o.glyph?.ink ?? "#ffffff";
  const channels = /^#[0-9a-f]{6}$/i.test(ink) ? [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16)) : ink.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  const lightTheme = !!channels && channels.length === 3 && channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722 < 128;
  const colors = palette(surface, color, lightTheme), start = front ? LAYER_BUCKETS : 0, frame = surface.frame;
  x.globalCompositeOperation = "source-over";
  for (let b = 0; b < LAYER_BUCKETS; b++) {
    const bucket = surface.buckets[start + b]!;
    if (!bucket.length) continue;
    x.globalAlpha = (Math.floor(b / 36) + .5) / 4 * (front ? .95 : .55);
    x.fillStyle = colors[b % 36]!; x.beginPath();
    for (const i of bucket) { const j = i * 7, s = frame[j + 3]!; x.rect(frame[j]! - s / 2, frame[j + 1]! - s / 2, s, s); }
    x.fill();
  }
  x.globalCompositeOperation = "lighter";
  for (let i = 0; i < surface.group.pts.length; i += 19) {
    const j = i * 7;
    if ((frame[j + 2]! > 0) !== front || frame[j + 4]! < .72 || frame[j + 6]! < .2) continue;
    const px = frame[j]!, py = frame[j + 1]!, r = R * .028;
    x.globalAlpha = Math.min(.18, (frame[j + 4]! - .65) * .3);
    const glow = x.createRadialGradient(px, py, 0, px, py, r);
    glow.addColorStop(0, o.coreColor); glow.addColorStop(.25, color + "70"); glow.addColorStop(1, color + "00");
    x.fillStyle = glow; x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
}

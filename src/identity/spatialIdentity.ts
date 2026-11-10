import { identitySeed } from "./glyph";
import type { ParticleGroup, Point3 } from "@/shell/dock/orbModel";

export type SpatialKind = "atom" | "quotation" | "crystal" | "prism" | "helix" | "bloom" | "knot" | "waveform";
export type SpatialLine = { points: Point3[]; width: number; light: number };
export type SpatialIdentity = {
  seed: number; kind: SpatialKind;
  lines: SpatialLine[];
  spheres: { center: Point3; radius: number; light: number }[];
  faces: { vertices: Point3[]; normal: Point3; light: number }[];
  satellites: { line: number; phase: number; speed: number; radius: number }[];
  group: ParticleGroup;
};

export const SPATIAL_LABELS: Record<SpatialKind, string> = {
  atom: "Spatial atom", quotation: "Paired quotations", crystal: "Stellar crystal", prism: "Triangular prism",
  helix: "Double helix", bloom: "Sculpted bloom", knot: "Orbiting knot", waveform: "Spatial waveform",
};
const kinds: SpatialKind[] = ["atom", "quotation", "crystal", "prism", "helix", "bloom", "knot", "waveform"];
const hints: [RegExp, SpatialKind][] = [
  [/\b(web|research|search|browser)\b/, "atom"],
  [/\b(cite|sources|reference)\b/, "quotation"],
  [/\b(sound|audio|music|sonic)\b/, "waveform"],
  [/\b(code|reviewer|debug|terminal)\b/, "crystal"],
  [/\b(summarizer|summary|compress)\b/, "prism"],
  [/\b(data|analyst|metrics)\b/, "helix"],
  [/\b(note|notes|writing|journal)\b/, "bloom"],
  [/\b(motion|animate|animation|video)\b/, "knot"],
];

export function spatialIdentity(id: string): SpatialIdentity {
  const seed = identitySeed(id);
  let state = seed;
  const rnd = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
  const hint = hints.find(([pattern]) => pattern.test(id.toLowerCase()));
  const kind = hint?.[1] ?? kinds[seed % kinds.length]!;
  const result: SpatialIdentity = { seed, kind, lines: [], spheres: [], faces: [], satellites: [], group: { pts: [], ph: new Float32Array(), fr: new Float32Array(), sens: new Float32Array(), k: new Float32Array() } };
  const face = (vertices: Point3[], light = 1) => {
    const [a, b, c] = vertices as [Point3, Point3, Point3], u = b.map((v, i) => v - a[i]!), v = c.map((n, i) => n - a[i]!);
    const n: Point3 = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const length = Math.hypot(...n);
    if (length > 1e-8) result.faces.push({ vertices, normal: n.map((v) => v / length) as Point3, light });
  };
  const line = (points: Point3[], width = .025, light = 1) => { result.lines.push({ points, width, light }); return result.lines.length - 1; };
  const curve = (fn: (u: number) => Point3, count = 64) => Array.from({ length: count + 1 }, (_, i) => fn(i / count));
  const sphere = (center: Point3, radius: number, light = 1) => result.spheres.push({ center, radius, light });
  const size = .92 + rnd() * .12, twist = (rnd() - .5) * .35;
  if (kind === "atom") {
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI / 3 + twist, tilt = .8 + i * .24;
      const index = line(curve((u) => {
        const a = u * Math.PI * 2, x = Math.cos(a) * .65 * size, y = Math.sin(a) * .65;
        return [x * Math.cos(angle) - y * Math.cos(tilt) * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(tilt) * Math.cos(angle), y * Math.sin(tilt)];
      }), .023, .9);
      result.satellites.push({ line: index, phase: rnd(), speed: .12 + i * .025, radius: .052 });
    }
    sphere([0, 0, 0], .105);
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; sphere([Math.cos(a) * .085, Math.sin(a) * .075, i % 2 ? -.055 : .055], .075, i % 2 ? .65 : 1.15); }
  } else if (kind === "quotation") {
    const spacing = .22 + rnd() * .05, head = .145 + rnd() * .025, depth = .11 + rnd() * .07;
    for (const side of [-1, 1]) {
      const x = side * spacing, z = side * depth;
      sphere([x, -.16, z], head);
      line(curve((u) => [x + Math.sin(u * Math.PI) * .1 - u * .14, -.12 + u * .48, z + Math.sin(u * Math.PI) * .18], 24), head * .65, .8);
      sphere([x - .14, .36, z], .047, .6);
    }
  } else if (kind === "waveform") {
    const bars = 7 + (seed % 2) * 2;
    for (let i = 0; i < bars; i++) {
      const a = (i / (bars - 1) - .5) * 2, x = a * .53, z = Math.cos(a * Math.PI) * .22;
      const h = .13 + Math.pow(Math.cos(a * 2.3 + twist), 2) * .34;
      line([[x, -h, z], [x, h, z]], .07, .8 + i / bars * .3); sphere([x, -h, z], .035); sphere([x, h, z], .035);
    }
    line(curve((u) => { const a = u * Math.PI; return [Math.cos(a) * .64, Math.sin(a) * .12 + .45, Math.sin(a) * -.35]; }, 40), .012, .5);
  } else if (kind === "crystal") {
    const length = .62 * size, waist = .14 + rnd() * .025;
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const tip: Point3 = [0, 0, 0]; tip[axis] = sign * length;
      const ring: Point3[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
        const p: Point3 = [0, 0, 0]; p[axis] = sign * waist; p[(axis + 1) % 3] = a! * waist; p[(axis + 2) % 3] = b! * waist; return p;
      });
      for (let i = 0; i < 4; i++) {
        const vertices = [tip, ring[i]!, ring[(i + 1) % 4]!];
        if (sign < 0) vertices.reverse(); face(vertices, .9 + rnd() * .2);
      }
    }
  } else if (kind === "prism") {
    const ring = Array.from({ length: 3 }, (_, i): Point3 => { const a = i * Math.PI * 2 / 3 - Math.PI / 2 + twist; return [Math.cos(a) * .58, Math.sin(a) * .58, 0]; });
    const depth = .42 + rnd() * .15;
    const top: Point3 = [0, 0, depth], bottom: Point3 = [0, 0, -depth];
    for (let i = 0; i < 3; i++) { const a = ring[i]!, b = ring[(i + 1) % 3]!; face([top, a, b]); face([bottom, b, a], .65); line([a, top, b, bottom, a], .014, 1.1); }
  } else if (kind === "helix") {
    const turns = 1.15 + rnd() * .3;
    for (const offset of [0, Math.PI]) line(curve((u) => { const a = u * Math.PI * 2 * turns + offset; return [Math.cos(a) * .3, (u - .5) * 1.18, Math.sin(a) * .3]; }), .045);
    for (let i = 0; i < 9; i++) {
      const u = i / 8, a = u * Math.PI * 2 * turns;
      line([[Math.cos(a) * .3, (u - .5) * 1.18, Math.sin(a) * .3], [-Math.cos(a) * .3, (u - .5) * 1.18, -Math.sin(a) * .3]], .018, .55);
    }
  } else if (kind === "bloom") {
    const petals = 5 + seed % 2;
    for (let petal = 0; petal < petals; petal++) {
      const angle = petal * Math.PI * 2 / petals + twist;
      const point = (u: number, side: number): Point3 => {
        const radius = .1 + u * .55, width = Math.sin(u * Math.PI) * .18 * side;
        return [Math.cos(angle) * radius - Math.sin(angle) * width, Math.sin(angle) * radius + Math.cos(angle) * width, Math.sin(u * Math.PI) * .3 + side * side * -.09];
      };
      for (let i = 0; i < 8; i++) for (const side of [-1, 1]) {
        const a = point(i / 8, 0), b = point((i + 1) / 8, 0), c = point((i + 1) / 8, side), d = point(i / 8, side);
        face([a, b, c], .85 + petal / petals * .2); face([a, c, d], .85 + petal / petals * .2);
      }
      line(curve((u) => point(u, 0), 24), .012, 1.1);
    }
    sphere([0, 0, .1], .09);
  } else {
    const radius = .31 + rnd() * .06, tube = .05 + rnd() * .03;
    line(curve((u) => {
      const a = u * Math.PI * 2, r = radius + .14 * Math.cos(3 * a);
      return [r * Math.cos(2 * a), r * Math.sin(2 * a), Math.sin(3 * a) * .3];
    }, 128), tube);
  }
  const points: Point3[] = [];
  for (const l of result.lines) for (let i = 0; i < l.points.length; i += 3) points.push(l.points[i]!);
  for (const f of result.faces) { const p: Point3 = [0, 0, 0]; f.vertices.forEach((v) => v.forEach((n, i) => { p[i]! += n / f.vertices.length; })); points.push(p); }
  result.spheres.forEach((s) => points.push(s.center));
  result.group = { pts: points, ph: Float32Array.from(points, () => rnd() * Math.PI * 2), fr: Float32Array.from(points, () => .6 + rnd() * 1.6), sens: Float32Array.from(points, () => .3 + rnd() * 1.4), k: Float32Array.from(points, () => .025 + rnd() * .06) };
  return result;
}

export function spatialPose(model: SpatialIdentity, time: number) {
  const phase = model.seed % 100 / 100;
  const yaw = model.kind === "quotation" || model.kind === "waveform" ? .45 + Math.sin(time * .27 + phase) * .7 : time * .23 + phase * Math.PI * 2;
  const pitch = .3 + Math.sin(time * .19 + phase) * .28, roll = Math.sin(time * .17) * .12;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  return (p: Point3): Point3 => {
    const x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy, y = p[1] * cx - z * sx;
    return [x * cr - y * sr, x * sr + y * cr, p[1] * sx + z * cx];
  };
}

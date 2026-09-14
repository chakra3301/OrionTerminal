/**
 * Port of img2threejs `grimoire/build/geometry_patterns.md` — real
 * `THREE.BufferGeometry` builders per primitive/topology choice, plus the
 * hard-won patterns from upstream's own reconstruction post-mortems:
 * tube-network members over a single closed sweep for framed/tubular
 * subjects, real chamfer geometry (not normal-map tricks) for bevels, and
 * geometric ridge segments (not texture alone) for grip/knurl texture.
 */

import * as THREE from "three";
import type { EdgeTreatment, SculptComponent } from "./sculptSpec";

/** Chamfered box via `ExtrudeGeometry`'s native bevel — a real geometric
 * edge treatment, not a normal map (upstream: "light catches a real
 * chamfer"). Bevels the extrusion-direction (Z) edges; for a box that reads
 * as a full-perimeter rim bevel when depth is the shortest axis. */
export function buildBeveledBox(w: number, h: number, d: number, edge: EdgeTreatment): THREE.BufferGeometry {
  if (edge.type === "none" || edge.bevelRadius <= 0) return new THREE.BoxGeometry(w, h, d);
  const bevel = Math.min(edge.bevelRadius, Math.min(w, h) * 0.45);
  const shape = new THREE.Shape();
  const hw = w / 2, hh = h / 2;
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.lineTo(-hw, -hh);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, d - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: Math.max(1, edge.segments),
    curveSegments: 4,
  });
  geo.translate(0, 0, -(d - bevel * 2) / 2 - bevel);
  geo.computeVertexNormals();
  return geo;
}

/** Lathe-profile cylinder with an optional rim bevel at both caps —
 * `LatheGeometry` doesn't take a bevel param, so the profile itself carries
 * a short chamfer segment at each end. */
export function buildBeveledCylinder(
  radiusTop: number, radiusBottom: number, height: number, radialSegments: number, edge: EdgeTreatment,
): THREE.BufferGeometry {
  if (edge.type === "none" || edge.bevelRadius <= 0) {
    return new THREE.CylinderGeometry(radiusTop, radiusBottom, height, Math.max(6, radialSegments));
  }
  const bevel = Math.min(edge.bevelRadius, height * 0.3, Math.min(radiusTop, radiusBottom) * 0.6);
  const hh = height / 2;
  const points: THREE.Vector2[] = [
    new THREE.Vector2(Math.max(0.0001, radiusBottom - bevel), -hh),
    new THREE.Vector2(radiusBottom, -hh + bevel),
    new THREE.Vector2(radiusTop, hh - bevel),
    new THREE.Vector2(Math.max(0.0001, radiusTop - bevel), hh),
  ];
  const geo = new THREE.LatheGeometry(points, Math.max(6, radialSegments));
  geo.computeVertexNormals();
  return geo;
}

export function buildPrimitiveGeometry(c: SculptComponent): THREE.BufferGeometry {
  const { width, height, depth } = c.dimensions;
  const params = c.geometryDescriptor.params ?? {};
  const seg = (key: string, fallback: number) => (typeof params[key] === "number" ? (params[key] as number) : fallback);
  switch (c.primitive) {
    case "box":
      return buildBeveledBox(width, height, depth, c.geometryDescriptor.edgeTreatment);
    case "sphere":
      return new THREE.SphereGeometry(Math.max(width, height, depth) / 2, seg("widthSegments", 24), seg("heightSegments", 16));
    case "cylinder":
      return buildBeveledCylinder(width / 2, width / 2, height, seg("radialSegments", 16), c.geometryDescriptor.edgeTreatment);
    case "cone":
      return new THREE.ConeGeometry(width / 2, height, seg("radialSegments", 16));
    case "torus":
      return new THREE.TorusGeometry(width / 2, seg("tube", height / 4), seg("radialSegments", 12), seg("tubularSegments", 24));
    case "capsule":
      return new THREE.CapsuleGeometry(width / 2, Math.max(0.001, height - width), seg("capSegments", 6), seg("radialSegments", 12));
    case "lathe": {
      const pts = (params.profile as number[] | undefined) ?? [0, height / 2, width / 2, 0, 0, -height / 2];
      const points: THREE.Vector2[] = [];
      for (let i = 0; i + 1 < pts.length; i += 2) points.push(new THREE.Vector2(Math.max(0.0001, pts[i]!), pts[i + 1]!));
      return new THREE.LatheGeometry(points, seg("radialSegments", 24));
    }
    case "extrude": {
      const outline = (c.geometryDescriptor.params?.outline as unknown as number[][]) ?? [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
      const shape = new THREE.Shape();
      shape.moveTo(outline[0]![0]!, outline[0]![1]!);
      for (const p of outline.slice(1)) shape.lineTo(p[0]!, p[1]!);
      shape.closePath();
      return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
    }
    case "tube": {
      const pathPts = (c.geometryDescriptor.params?.path as unknown as number[][]) ?? [[0, -height / 2, 0], [0, height / 2, 0]];
      const curve = new THREE.CatmullRomCurve3(pathPts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
      return new THREE.TubeGeometry(curve, Math.max(8, pathPts.length * 6), width / 2, seg("radialSegments", 8), false);
    }
    case "plane":
      return new THREE.PlaneGeometry(width, height, 1, 1);
    case "group":
    default:
      return new THREE.BoxGeometry(0.001, 0.001, 0.001);
  }
}

/** Tube-network member: an oriented cylinder from `localStart` to
 * `localEnd` in the PARENT's local space, pivoted at `localStart`
 * (per `grimoire/readiness/joint_attachment.md`'s "Generator Rule" — do
 * not center the mesh at an arbitrary transform position). This is
 * upstream's hard-won fix for framed/tubular subjects: a network of
 * straight oriented members reads correctly where a single closed sweep
 * CatmullRom-smooths into a blob. */
export function buildAttachedMember(
  localStart: [number, number, number], localEnd: [number, number, number],
  baseRadius: number, endRadius: number, radialSegments = 10,
): { geometry: THREE.BufferGeometry; pivot: THREE.Vector3; quaternion: THREE.Quaternion; length: number } {
  const start = new THREE.Vector3(...localStart);
  const end = new THREE.Vector3(...localEnd);
  const dir = new THREE.Vector3().subVectors(end, start);
  const length = dir.length() || 0.001;
  dir.normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const geometry = new THREE.CylinderGeometry(endRadius, baseRadius, length, radialSegments);
  geometry.translate(0, length / 2, 0); // so the geometry's local origin IS localStart
  return { geometry, pivot: start, quaternion, length };
}

export type GrooveRidgeKind = "groove" | "ridge";

/** Recessed/raised linear feature along a path — shares mechanics between
 * engraved linework and construction seams per the detail taxonomy. Real
 * geometry (a thin tube inset/proud of the surface), not a decal, so it
 * catches light correctly. */
export function buildGrooveOrRidge(
  path: [number, number, number][], width: number, depth: number, kind: GrooveRidgeKind, radialSegments = 6,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)));
  const geo = new THREE.TubeGeometry(curve, Math.max(8, path.length * 8), width / 2, radialSegments, false);
  // Groove sits slightly inset (negative along its own normal-ish scale);
  // ridge sits slightly proud. We approximate "inset" by non-uniformly
  // scaling the tube's cross-section thinner (reads as a shallow channel)
  // and "proud" by leaving it full width with a small radial bump.
  const scale = kind === "groove" ? Math.max(0.15, 1 - depth) : 1 + depth * 0.4;
  geo.scale(scale, 1, scale);
  return geo;
}

export type RepetitionDistribution = "linear" | "radial" | "grid" | "scatter";

/** InstancedMesh repetition system — fasteners/rivets/scales/leaves. Always
 * instanced per upstream ("repeated small parts are always an instanced
 * system, never one-off meshes"). Seeded PRNG so results are reproducible. */
export function buildInstancedRepetition(
  baseGeometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
  distribution: RepetitionDistribution,
  bounds: { w: number; h: number; d: number },
  variance: { scale: number; rotation: number; positionJitter: number },
  seed = 1,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(baseGeometry, material, Math.max(1, count));
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const rot = new THREE.Euler();
  const scl = new THREE.Vector3();
  const rng = mulberry32(seed);
  const n = Math.max(1, count);

  for (let i = 0; i < n; i++) {
    if (distribution === "radial") {
      const ang = (i / n) * Math.PI * 2;
      const r = Math.min(bounds.w, bounds.d) / 2;
      pos.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    } else if (distribution === "grid") {
      const cols = Math.ceil(Math.sqrt(n));
      const row = Math.floor(i / cols), col = i % cols;
      pos.set((col / (cols - 1 || 1) - 0.5) * bounds.w, 0, (row / (cols - 1 || 1) - 0.5) * bounds.d);
    } else if (distribution === "scatter") {
      pos.set((rng() - 0.5) * bounds.w, (rng() - 0.5) * bounds.h, (rng() - 0.5) * bounds.d);
    } else {
      const t = n > 1 ? i / (n - 1) : 0.5;
      pos.set((t - 0.5) * bounds.w, 0, 0);
    }
    pos.x += (rng() - 0.5) * variance.positionJitter;
    pos.y += (rng() - 0.5) * variance.positionJitter;
    pos.z += (rng() - 0.5) * variance.positionJitter;
    rot.set(0, (rng() - 0.5) * variance.rotation, 0);
    const s = 1 + (rng() - 0.5) * variance.scale;
    scl.set(s, s, s);
    m.compose(pos, new THREE.Quaternion().setFromEuler(rot), scl);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

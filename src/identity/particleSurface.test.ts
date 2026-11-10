import { expect, it } from "vitest";
import { orbModel, particlePhysics } from "@/shell/dock/orbModel";
import type { OrbCanvas } from "@/shell/dock/orbCanvas";
import { particleSurface, prepareSurface, surfaceSample, type SurfaceKind } from "./particleSurface";

function fixture(id = "skill:web-research", size = 72) {
  const model = orbModel();
  const orb: OrbCanvas = { x: {} as CanvasRenderingContext2D, P: size * 2, R: size * .75, q: 2, model, color: "#00e0ff", coreColor: "#bfefff", m: null, last: null,
    st: { shell: particlePhysics(model.shell), nodes: particlePhysics(model.nodes), spikes: particlePhysics(model.spikes), core: particlePhysics(model.core) }, nodeXY: new Float32Array(0) };
  return { orb, surface: particleSurface(id, size) };
}

it("keeps seeded surfaces stable, independent of colour, and raises detail only for larger specimens", () => {
  const a = particleSurface("skill:café", 72), b = particleSurface("skill:cafe\u0301", 72);
  expect(a).toEqual(b);
  expect(particleSurface("skill:other", 72).group.ph).not.toEqual(a.group.ph);
  expect(particleSurface("skill:café", 176).group.pts.length).toBeGreaterThan(a.group.pts.length * 2);
});

it("gives every material finite unit normals, folds and animated silhouettes", () => {
  for (const kind of ["membrane", "ribbons", "sculpted", "vortex", "silk"] as SurfaceKind[]) {
    const { surface } = fixture();
    let changed = 0, minRadius = Infinity, maxRadius = 0;
    for (let i = 0; i < surface.group.pts.length; i += 17) {
      const p = surface.group.pts[i]!, a = surfaceSample(kind, p, 0, .7), b = surfaceSample(kind, p, 8, .7);
      expect(Object.values(a).every(Number.isFinite)).toBe(true);
      expect(Math.hypot(a.nx, a.ny, a.nz)).toBeCloseTo(1, 6);
      expect(a.coverage).toBeGreaterThanOrEqual(0); expect(a.coverage).toBeLessThanOrEqual(1);
      const r = Math.hypot(a.x, a.y, a.z); minRadius = Math.min(r, minRadius); maxRadius = Math.max(r, maxRadius);
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z) > .03) changed++;
    }
    expect(maxRadius - minRadius).toBeGreaterThan(.15);
    expect(changed).toBeGreaterThan(100);
  }
});

it("partitions the skin around the glyph and freezes its complete projection at a fixed time", () => {
  const { orb, surface } = fixture();
  prepareSurface(orb, surface, 0); const first = surface.frame.slice();
  const count = surface.buckets.reduce((n, b) => n + b.length, 0);
  expect(count).toBeGreaterThan(2000);
  surface.buckets.forEach((bucket, b) => bucket.forEach((i) => expect(surface.frame[i * 7 + 2]! > 0).toBe(b >= surface.buckets.length / 2)));
  prepareSurface(orb, surface, 0); expect(surface.frame).toEqual(first);
  prepareSurface(orb, surface, 10); expect(surface.frame).not.toEqual(first);
  expect(Array.from(surface.frame).every(Number.isFinite)).toBe(true);
});

it("pushes nearby grains independently and restores their springs after the pointer leaves", () => {
  const { orb, surface } = fixture();
  orb.m = { x: orb.P * .65, y: orb.P / 2 };
  for (let i = 0; i < 15; i++) prepareSurface(orb, surface, 0);
  const displaced = surface.state.ox.filter((v) => Math.abs(v) > .01).length;
  expect(displaced).toBeGreaterThan(100); expect(displaced).toBeLessThan(surface.group.pts.length);
  expect(new Set(surface.state.ox).size).toBeGreaterThan(100);
  orb.m = null;
  for (let i = 0; i < 200; i++) prepareSurface(orb, surface, 0);
  expect(Math.max(...surface.state.ox.map(Math.abs), ...surface.state.oy.map(Math.abs))).toBeLessThan(.01);
});

import { expect, it } from "vitest";
import { spatialIdentity, spatialPose } from "./spatialIdentity";
import { particlePhysics, stepParticle, type Point3 } from "@/shell/dock/orbModel";

it("builds atom orbitals on different planes with a nucleus and moving electrons", () => {
  const atom = spatialIdentity("skill:builtin:web-research");
  expect(atom.kind).toBe("atom");
  expect(atom.lines).toHaveLength(3); expect(atom.spheres.length).toBeGreaterThan(1); expect(atom.satellites).toHaveLength(3);
  const normals = atom.lines.map(({ points }) => {
    const a = points[0]!, b = points[16]!;
    const cross: Point3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], length = Math.hypot(...cross);
    return cross.map((v) => v / length);
  });
  for (let i = 0; i < normals.length; i++) for (let j = i + 1; j < normals.length; j++) {
    const dot = normals[i]!.reduce((sum, v, axis) => sum + v * normals[j]![axis]!, 0);
    expect(Math.abs(dot)).toBeLessThan(.85);
  }
  expect(Math.max(...atom.lines.flatMap((l) => l.points.map((p) => p[2]))) - Math.min(...atom.lines.flatMap((l) => l.points.map((p) => p[2])))).toBeGreaterThan(1);
});

it("gives Cite and Sound visibly different structures independent of colour", () => {
  const cite = spatialIdentity("skill:builtin:cite-sources"), sound = spatialIdentity("skill:imported:sound-design");
  expect(cite.kind).toBe("quotation"); expect(sound.kind).toBe("waveform");
  expect(cite.lines).toHaveLength(2); expect(sound.lines.length).toBeGreaterThan(7);
});

it("generates stable, finite spatial identities across every shape family", () => {
  const models = Array.from({ length: 128 }, (_, i) => spatialIdentity(`skill:fixture-${i}`));
  expect(new Set(models.map((m) => m.kind)).size).toBe(8);
  for (const model of models) {
    const points = [...model.lines.flatMap((l) => l.points), ...model.spheres.map((s) => s.center), ...model.faces.flatMap((f) => f.vertices)];
    expect(points.flat().every(Number.isFinite)).toBe(true);
    expect(Math.max(...points.map((p) => p[2])) - Math.min(...points.map((p) => p[2]))).toBeGreaterThan(.3);
    expect(spatialIdentity(`skill:fixture-${models.indexOf(model)}`)).toEqual(model);
  }
  expect(spatialIdentity("café")).toEqual(spatialIdentity("cafe\u0301"));
});

it("changes front/back depth ordering as the atom turns and keeps independent particle springs", () => {
  const atom = spatialIdentity("skill:builtin:web-research"), point = atom.lines[0]!.points[0]!;
  const a = spatialPose(atom, 0)(point), b = spatialPose(atom, Math.PI / .23)(point);
  expect(a[2] * b[2]).toBeLessThan(0);
  expect(Math.hypot(...a)).toBeCloseTo(Math.hypot(...point));
  const state = particlePhysics(atom.group), home = atom.group.pts.map(([x, y, z]) => ({ x: 50 + x * 24, y: 50 + y * 24, z }));
  for (let i = 0; i < home.length; i++) stepParticle(state, atom.group, i, { ...home[i]! }, { x: 50, y: 50 }, { x: 3, y: 1 }, 24);
  expect(new Set(state.ox).size).toBeGreaterThan(5);
  for (let frame = 0; frame < 400; frame++) for (let i = 0; i < home.length; i++) stepParticle(state, atom.group, i, { ...home[i]! }, null, { x: 0, y: 0 }, 24);
  expect(Math.max(...state.ox.map(Math.abs), ...state.oy.map(Math.abs))).toBeLessThan(.001);
});

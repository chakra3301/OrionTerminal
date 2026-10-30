import { expect, it } from "vitest";
import { orbModel, particlePhysics, stepParticle } from "./orbModel";

it("reproduces seed 47 with independent per-dot properties", () => {
  const a = orbModel(), b = orbModel();
  expect(a).toEqual(b);
  expect(a.shell.pts.length).toBeGreaterThan(100);
  expect(a.nodes.pts).toHaveLength(70);
  expect(a.spikes.pts).toHaveLength(46);
  expect(a.core.pts).toHaveLength(320);
  expect(new Set(a.shell.k).size).toBe(a.shell.pts.length);
  expect(Math.min(...a.shell.sens)).toBeGreaterThanOrEqual(0.3);
  expect(Math.max(...a.shell.sens)).toBeLessThan(1.7);
});

it("pushes only nearby dots, with individual sensitivity, then springs them home", () => {
  const group = { pts: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as [number, number, number][], ph: new Float32Array(3), fr: new Float32Array(3), sens: new Float32Array([0.3, 1.7, 1]), k: new Float32Array([0.025, 0.085, 0.05]) };
  const physics = particlePhysics(group);
  const mouse = { x: 0, y: 0 }, velocity = { x: 0, y: 0 };
  stepParticle(physics, group, 0, { x: 5, y: 0, z: 0 }, mouse, velocity, 25);
  stepParticle(physics, group, 1, { x: 5, y: 0, z: 0 }, mouse, velocity, 25);
  stepParticle(physics, group, 2, { x: 30, y: 0, z: 0 }, mouse, velocity, 25);
  expect(physics.ox[0]).toBeGreaterThan(0);
  expect(physics.ox[1]).toBeGreaterThan(physics.ox[0]!);
  expect(physics.ox[2]).toBe(0);
  for (let frame = 0; frame < 300; frame++) stepParticle(physics, group, 1, { x: 5, y: 0, z: 0 }, null, velocity, 25);
  expect(Math.abs(physics.ox[1]!)).toBeLessThan(0.00001);
});

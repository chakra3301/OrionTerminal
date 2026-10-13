// @vitest-environment node
import { expect, it } from "vitest";
import * as THREE from "three";
import { CompanionRagdoll } from "./companionRagdoll";

function fixture() {
  const body = new THREE.Group();
  const scene = new THREE.Group();
  body.add(scene);
  const hips = new THREE.Bone(); hips.name = "Hips"; hips.position.y = 1;
  const spine = new THREE.Bone(); spine.name = "Spine"; spine.position.y = 0.5;
  const head = new THREE.Bone(); head.name = "Head"; head.position.y = 0.5;
  const tip = new THREE.Bone(); tip.name = "HeadTop_End"; tip.position.y = 0.2;
  const arm = new THREE.Bone(); arm.name = "LeftArm"; arm.position.set(-0.3, 0.25, 0);
  const forearm = new THREE.Bone(); forearm.name = "LeftForeArm"; forearm.position.x = -0.4;
  const hand = new THREE.Bone(); hand.name = "LeftHand"; hand.position.x = -0.35;
  const thigh = new THREE.Bone(); thigh.name = "LeftUpLeg"; thigh.position.x = -0.2;
  const leg = new THREE.Bone(); leg.name = "LeftLeg"; leg.position.y = -0.5;
  const foot = new THREE.Bone(); foot.name = "LeftFoot"; foot.position.y = -0.5;
  const toe = new THREE.Bone(); toe.name = "LeftToeBase"; toe.position.z = 0.15;
  scene.add(hips); hips.add(spine, thigh); spine.add(head, arm); head.add(tip);
  arm.add(forearm); forearm.add(hand); thigh.add(leg); leg.add(foot); foot.add(toe);
  body.updateMatrixWorld(true);
  return { body, scene, hips, head, arm, hand, foot, ragdoll: new CompanionRagdoll(scene, body) };
}

function advance(r: CompanionRagdoll, frames: number, dragging: boolean, vx = 0) {
  for (let i = 0; i < frames; i++) {
    r.restorePose();
    r.capturePose();
    r.update(1 / 30, dragging, vx, 0);
  }
}

it("restores unkeyed bones so prolonged holding cannot accumulate head rotations", () => {
  const { head, hips, ragdoll } = fixture();
  ragdoll.setGrip(hips.getWorldPosition(new THREE.Vector3()));
  advance(ragdoll, 1800, true, 0.5);
  expect(head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThanOrEqual(0.451);
  expect(head.quaternion.length()).toBeCloseTo(1);
  advance(ragdoll, 120, false);
  expect(head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(0.001);
});

it.each(["head", "hand", "foot"] as const)("keeps a %s grab fixed while other joints hang and move", (part) => {
  const f = fixture();
  const point = f[part].getWorldPosition(new THREE.Vector3());
  f.ragdoll.setGrip(point);
  advance(f.ragdoll, 120, true, 0.2);
  expect(f[part].getWorldPosition(new THREE.Vector3()).distanceTo(point)).toBeLessThan(1e-6);
  expect(f.arm.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.1);
  expect(Math.abs(f.body.rotation.z)).toBeLessThan(Math.PI + 0.61);
  if (part === "foot") expect(Math.abs(f.body.rotation.z)).toBeGreaterThan(2);
  advance(f.ragdoll, 120, false);
  expect(f.body.position.length()).toBeLessThan(0.001);
  expect(Math.abs(f.body.rotation.z)).toBeLessThan(0.001);
});

it("uses skin weights to attach a surface grab to its body part rather than the nearest unrelated joint", () => {
  const { scene, body, head, foot, ragdoll } = fixture();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new THREE.SkinnedMesh(geometry);
  scene.add(mesh);
  mesh.bind(new THREE.Skeleton([head, foot]));
  const hit = head.getWorldPosition(new THREE.Vector3());
  const local = foot.worldToLocal(hit.clone());
  ragdoll.setGrip(hit, mesh, { a: 0, b: 1, c: 2, normal: new THREE.Vector3(), materialIndex: 0 });
  advance(ragdoll, 120, true);
  expect(foot.localToWorld(local).distanceTo(hit)).toBeLessThan(1e-6);
  expect(Math.abs(body.rotation.z)).toBeLessThan(0.5);
  geometry.dispose();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { bindTransforms, handFrame, handTransfer, solveTwoBoneArm } from "./companion-hand-retarget.mjs";

function rig(roll, full = true) {
  const root = new THREE.Group();
  for (const side of ["Left", "Right"]) {
    const wrist = new THREE.Bone(); wrist.name = `mixamorig${side}Hand`;
    wrist.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll); root.add(wrist);
    for (const [digit, depth] of [["Thumb", 0.5], ["Index", 0.3], ...full ? [["Middle", 0], ["Ring", -0.15], ["Pinky", -0.3]] : []]) {
      let parent = wrist;
      for (let segment = 1; segment <= 3; segment++) {
        const bone = new THREE.Bone(); bone.name = `mixamorig${side}Hand${digit}${segment}`;
        bone.position.set(0.5, 0, segment === 1 ? depth : 0); parent.add(bone); parent = bone;
      }
    }
  }
  root.updateMatrixWorld(true);
  return root;
}

test("reads the skin's bind transforms without posing bones or dropping non-bone parent transforms", () => {
  const root = new THREE.Group(); root.rotation.y = 0.7; root.scale.setScalar(0.5);
  const arm = new THREE.Object3D(); arm.rotation.z = 0.4; root.add(arm);
  const bone = new THREE.Bone(); bone.position.set(1, 2, 3); bone.rotation.x = 0.3; arm.add(bone);
  root.updateMatrixWorld(true);
  const expected = bone.matrixWorld.clone();
  const skeleton = new THREE.Skeleton([bone], [expected.clone().invert()]);
  const mesh = new THREE.SkinnedMesh(); root.add(mesh); mesh.bind(skeleton);
  bone.rotation.x = -0.8; root.updateMatrixWorld(true);
  const posed = bone.quaternion.clone();
  const rest = bindTransforms(root).get(bone);
  assert.ok(rest.matrix.elements.every((value, index) => Math.abs(value - expected.elements[index]) < 1e-10));
  assert.ok(bone.quaternion.angleTo(posed) < 1e-7);
  assert.ok(rest.local.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3)) < 1e-7);
});

test("transfers the source grip across a quarter-turn bind difference and keeps finger curls", () => {
  const source = rig(0), target = rig(Math.PI / 2);
  const transfer = handTransfer(target, source);
  const sourceFrames = ["l", "r"].map((side) => handFrame(bindTransforms(source), side));
  const targetFrames = ["l", "r"].map((side) => handFrame(bindTransforms(target), side));
  for (const frame of sourceFrames) {
    frame.wrist.rotation.z = 0.4;
    frame.fingers.get("index2").bone.rotation.z = 0.8;
  }
  transfer.apply();
  for (let side = 0; side < 2; side++) {
    const from = sourceFrames[side], to = targetFrames[side];
    const sourcePalm = from.wrist.getWorldQuaternion(new THREE.Quaternion()).multiply(from.local);
    const targetPalm = to.wrist.getWorldQuaternion(new THREE.Quaternion()).multiply(to.local);
    assert.ok(sourcePalm.angleTo(targetPalm) < 1e-7);
    assert.ok(to.fingers.get("index2").bone.quaternion.angleTo(from.fingers.get("index2").bone.quaternion) < 1e-7);
    assert.ok(to.fingers.get("index2").bone.quaternion.angleTo(new THREE.Quaternion()) > 0.7);
  }
});

test("supports the demon's partial hand rig without inventing missing finger chains", () => {
  const source = rig(0), target = rig(Math.PI / 2, false);
  const transfer = handTransfer(target, source); transfer.apply();
  assert.equal(transfer.bones.length, 14);
  assert.ok(transfer.bones.every((bone) => bone.quaternion.toArray().every(Number.isFinite)));
});

test("matches a reachable grip position by bending the elbow without stretching the arm", () => {
  const root = new THREE.Group();
  const upper = new THREE.Bone(), lower = new THREE.Bone(), wrist = new THREE.Bone();
  root.add(upper); upper.add(lower); lower.add(wrist);
  lower.position.set(1, 0, 0); wrist.position.set(0.8, 0, 0); lower.rotation.z = 0.6;
  root.updateMatrixWorld(true);
  const target = new THREE.Vector3(0.9, 0.6, 0.4);
  solveTwoBoneArm(wrist, target);
  const point = (bone) => bone.getWorldPosition(new THREE.Vector3());
  assert.ok(point(wrist).distanceTo(target) < 1e-7);
  assert.ok(Math.abs(point(upper).distanceTo(point(lower)) - 1) < 1e-7);
  assert.ok(Math.abs(point(lower).distanceTo(point(wrist)) - 0.8) < 1e-7);
  solveTwoBoneArm(wrist, new THREE.Vector3(10, 0, 0));
  assert.ok(point(wrist).length() <= 1.8);
  assert.ok(wrist.quaternion.toArray().every(Number.isFinite));
});

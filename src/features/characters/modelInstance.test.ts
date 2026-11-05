// @vitest-environment node
import { expect, it } from "vitest";
import * as THREE from "three";
import { AuthoredBonePose } from "./modelInstance";
import { versionedCharacterUrl } from "./catalog";

it("loads built-in models with a version key while leaving custom asset URLs intact", () => {
  expect(versionedCharacterUrl("/characters/rosie.glb")).toMatch(/^\/characters\/rosie\.glb\?v=[a-f0-9]{12}$/);
  const custom = "asset://localhost/my-character.glb";
  expect(versionedCharacterUrl(custom)).toBe(custom);
});

it("restores unkeyed head rotations before attention offsets so they cannot accumulate", () => {
  const scene = new THREE.Group();
  const head = new THREE.Bone(); head.name = "head"; scene.add(head);
  const authored = head.quaternion.clone();
  const pose = new AuthoredBonePose(scene);
  const look = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.25);
  for (let i = 0; i < 1800; i++) {
    pose.restore(); pose.capture(); head.quaternion.multiply(look);
    expect(head.quaternion.angleTo(authored)).toBeCloseTo(0.25);
  }
  pose.restore();
  expect(head.quaternion.angleTo(authored)).toBeCloseTo(0);
});

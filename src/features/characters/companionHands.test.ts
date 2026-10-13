// @vitest-environment node
import { expect, it } from "vitest";
import * as THREE from "three";
import { prepareCompanionAnimations } from "./companionHands";
import { AuthoredBonePose } from "./modelInstance";
import { versionedCharacterUrl } from "./catalog";

const track = (name: string, angle: number) => {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle).toArray();
  return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [0, 2], [...q, ...q]);
};

it("replaces extreme Texting curls with relaxed fingers and small thumb motion without modifying cached clips", () => {
  const fingers = ["index_02_l", "mixamorigRightHandMiddle2", "thumb_01_l"];
  const quiet = new THREE.AnimationClip("Sad Idle", 2, fingers.map((name) => track(name, 0.2)));
  const body = track("hand_l", 1.4);
  const texting = new THREE.AnimationClip("Texting While Standing", 2, [...fingers.map((name) => track(name, 1.8)), body]);
  const greeting = new THREE.AnimationClip("Standing Greeting", 2, [track("hand_l", 0.7)]);
  const original = texting.tracks.map((track) => Array.from(track.values));
  const clips = prepareCompanionAnimations([quiet, texting, greeting]);
  expect(clips.map((clip) => clip.name)).toEqual([quiet.name, texting.name, greeting.name]);
  expect(clips[0]).toBe(quiet);
  expect(clips[2]).toBe(greeting);
  expect(clips[1]!.duration).toBe(texting.duration);
  for (const index of [0, 1]) {
    expect(new THREE.Quaternion().fromArray(clips[1]!.tracks[index]!.values).angleTo(new THREE.Quaternion())).toBeCloseTo(0.2);
  }
  expect(new THREE.Quaternion().fromArray(clips[1]!.tracks[2]!.values).angleTo(new THREE.Quaternion())).toBeCloseTo(0.44);
  expect(Array.from(clips[1]!.tracks[3]!.values)).toEqual(Array.from(body.values));
  expect(texting.tracks.map((track) => Array.from(track.values))).toEqual(original);
});

it("leaves custom animation libraries alone when a relaxed reference is unavailable", () => {
  const clips = [new THREE.AnimationClip("Texting While Standing", 2, [track("index_02_l", 1)])];
  expect(prepareCompanionAnimations(clips)).toBe(clips);
});

it("loads built-in models with a version key while leaving custom asset URLs intact", () => {
  expect(versionedCharacterUrl("/characters/anthropomorphic-fox.glb")).toMatch(/^\/characters\/anthropomorphic-fox\.glb\?v=[a-f0-9]{12}$/);
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

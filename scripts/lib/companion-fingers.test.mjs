import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { fingerCorrections, fingerIdentity, remapFingerRotation, readGlb, repairFingerChannels } from "./companion-fingers.mjs";

function fixture(rotation = 0) {
  const root = new THREE.Group(); root.rotation.x = rotation;
  const wrist = new THREE.Bone(); wrist.name = "hand_l"; root.add(wrist);
  const bones = [wrist];
  for (const [digit, z] of [["index", 0.3], ["middle", 0], ["pinky", -0.3], ["thumb", 0.5]]) {
    let parent = wrist;
    for (let segment = 1; segment <= 3; segment++) {
      const bone = new THREE.Bone(); bone.name = `${digit}_0${segment}_l`;
      bone.position.set(1, 0, segment === 1 ? z : 0);
      parent.add(bone); parent = bone; bones.push(bone);
    }
  }
  root.updateMatrixWorld(true);
  return { root, bones };
}

test("moves a donor bend into a palm rolled 90 degrees instead of curling sideways", () => {
  const source = fixture(); const target = fixture(Math.PI / 2);
  const correction = fingerCorrections(target.bones, source.bones).get("index02l");
  const sideways = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.8);
  const correct = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.8);
  const result = remapFingerRotation(sideways, correction);
  assert.ok(result.angleTo(correct) < 1e-6);
  assert.ok(Math.abs(result.angleTo(new THREE.Quaternion()) - 0.8) < 1e-6);
});

test("keeps the original bind pose and preserves bend magnitude on a rolled finger", () => {
  const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, 0.3, -0.1));
  const alignment = new THREE.Quaternion().setFromEuler(new THREE.Euler(1, -0.5, 0.1));
  const correction = { rest, alignment };
  assert.ok(remapFingerRotation(rest, correction).angleTo(rest) < 1e-6);
  const pose = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7).multiply(rest);
  const result = remapFingerRotation(pose, correction);
  assert.ok(Math.abs(result.angleTo(rest) - pose.angleTo(rest)) < 1e-6);
});

test("recognizes both original and sanitized Mixamo finger names, and leaves incomplete palms alone", () => {
  assert.deepEqual(fingerIdentity("mixamorig:RightHandIndex2"), { side: "r", digit: "index", segment: 2 });
  assert.deepEqual(fingerIdentity("mixamorigRightHandIndex2"), { side: "r", digit: "index", segment: 2 });
  const source = fixture(); const target = fixture();
  assert.equal(fingerCorrections(target.bones.filter((bone) => !bone.name.startsWith("pinky")), source.bones).size, 0);
  const original = Buffer.from("no complete palm");
  assert.deepEqual(repairFingerChannels(original, new Map()).bytes, original);
});

test("splits shared samplers and quaternion accessors without changing a head track or other binary data", () => {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.8);
  const binary = Buffer.alloc(24); q.toArray().forEach((value, k) => binary.writeFloatLE(value, k * 4));
  binary.writeFloatLE(0, 16); binary.writeUInt32LE(0x12345678, 20);
  const doc = { asset: { version: "2.0" }, buffers: [{ byteLength: 24 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 16 }, { buffer: 0, byteOffset: 16, byteLength: 4 }],
    accessors: [{ bufferView: 0, count: 1, componentType: 5126, type: "VEC4" }, { bufferView: 1, count: 1, componentType: 5126, type: "SCALAR" }],
    nodes: [{ name: "mixamorig:LeftHandIndex2" }, { name: "index_02_r" }, { name: "head" }],
    animations: [{ samplers: [{ input: 1, output: 0, interpolation: "STEP" }], channels: [0, 1, 2].map((node) => ({ sampler: 0, target: { node, path: "rotation" } })) }],
  };
  const json = Buffer.from(JSON.stringify(doc));const padded = Buffer.concat([json, Buffer.alloc((-json.length) & 3, 32)]);
  const header = Buffer.alloc(20);header.writeUInt32LE(0x46546c67, 0);header.writeUInt32LE(2, 4);header.writeUInt32LE(28+padded.length+binary.length, 8);header.writeUInt32LE(padded.length, 12);header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);binHeader.writeUInt32LE(binary.length);binHeader.writeUInt32LE(0x004e4942, 4);
  const input = Buffer.concat([header, padded, binHeader, binary]);
  const correction = { rest: new THREE.Quaternion(), alignment: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2) };
  const result = repairFingerChannels(input, new Map([["mixamoriglefthandindex2", correction], ["index02r", correction]]));
  assert.equal(result.channels, 2);
  const parsed = readGlb(result.bytes);
  assert.deepEqual(parsed.binary.subarray(0, 24), binary);
  const animation = parsed.doc.animations[0];
  assert.equal(animation.channels[2].sampler, 0);
  assert.equal(animation.samplers[0].output, 0);
  assert.notEqual(animation.channels[0].sampler, animation.channels[1].sampler);
  for (const channel of animation.channels.slice(0, 2)) {
    const accessor = parsed.doc.accessors[animation.samplers[channel.sampler].output];
    const offset = parsed.doc.bufferViews[accessor.bufferView].byteOffset;
    const actual = new THREE.Quaternion(...Array.from({ length: 4 }, (_, i) => parsed.binary.readFloatLE(offset + i * 4)));
    assert.ok(actual.angleTo(remapFingerRotation(q, correction)) < 0.001);
  }
});

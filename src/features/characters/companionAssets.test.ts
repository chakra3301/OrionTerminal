// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import manifest from "../../../public/characters/manifest.json";
import { BUILTIN_CHARACTERS, DEFAULT_CHARACTER_ID, resolveClips } from "./catalog";
import { cloneCharacter, characterBones, HorizontalRootAnchor } from "./modelInstance";
import { CompanionAnimator } from "./companionAnimator";

// Palm normals sampled from the original Mixamo Texting donor, in the library's +Y-up coordinates.
const textingPalms = [
  { time: 3, palms: [[0.90936135, 0.00862899, 0.41591762], [0.85730765, 0.13924137, -0.49561622]], thumbs: [[-0.90943568, -0.01888459, -0.41541558], [-0.90108219, 0.0896185, 0.42428695]] },
  { time: 10, palms: [[0.90052769, -0.09244918, 0.42485647], [0.77756555, -0.01526478, -0.62861658]], thumbs: [[-0.90226518, 0.08246182, -0.42322288], [-0.81678481, 0.23351464, 0.5275732]] },
  { time: 20, palms: [[0.85308038, -0.16920221, 0.4935833], [0.79273858, -0.5796176, -0.18870342]], thumbs: [[-0.85656691, 0.16001659, -0.49059944], [-0.73898088, 0.67306552, -0.02983379]] },
];

const gesturePalms = [
  { name: "Clapping", palms: [[0.99875281, 0.03861966, -0.03164396], [0.96075064, -0.07237206, -0.26780681]], thumbs: [[-0.9981927, -0.04554493, 0.03920451], [-0.98220619, 0.18084497, 0.05065662]] },
  { name: "Standing Greeting", palms: [[0.9305322, 0.34931968, 0.10993442], [0.3303672, -0.04436489, 0.94280925]], thumbs: [[-0.92831458, -0.35203923, -0.11958434], [-0.12092896, -0.0708628, -0.9901286]] },
];

const acceptedTexting: Record<string, string> = {
  "anthropomorphic-fox": "ff4760e477a6e5e8d1f5386d9f2752604592da559d9c7138915a3deaf7311671",
  "horned-demon": "496d0527d8f382ec90597e6357dc5e32a1700c88c0d91781523f90ce951d035d",
  "mushroom-character": "ff3cca8206b306bce6c24207dceeb5da6747f7047d0f0fb09bd8eab43edf542f",
  "angelic-winged-figure": "d1e651ba3c2dc4d92977f87b1053f12120699fa6721f1158a3dec68f76b60616",
  "stylized-humanoid-robot": "5a47077fe0a8e00b4822bdec8e5cc84a4fad40f6ef972fe1b07cc0f5b40e2fe4",
  "pigtail-character": "cbaee919e02cf9c6694ffffcc340798cbfa75b50b03e8bd56cd609a6ec267218",
};

it("ships six independent skinned companions whose 120 clips bind and deform real geometry", async () => {
  expect(manifest.defaultCharacter).toBe(DEFAULT_CHARACTER_ID);
  expect(manifest.defaultAnimation).toBe("Texting While Standing");
  expect(BUILTIN_CHARACTERS.map((c) => c.id)).toEqual(manifest.characters.map((c) => c.id));
  const loader = new GLTFLoader();
  // Texture decoding requires a browser; these checks exercise the actual mesh, rig and motion data.
  loader.register(() => ({ name: "EXT_texture_webp", loadTexture: async () => new THREE.Texture() }));
  for (const character of manifest.characters) {
    const bytes = readFileSync(resolve("public", character.model.slice(1)));
    expect(bytes.byteLength).toBe(character.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(character.sha256);
    const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    expect(document.meshes).toHaveLength(1);
    expect(document.skins).toHaveLength(1);
    expect(document.nodes.some((node: { name?: string }) => /icosphere/i.test(node.name ?? ""))).toBe(false);
    const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
    expect(gltf.animations.map((clip) => clip.name)).toEqual(character.animations.map((clip) => clip.name));
    expect(gltf.animations).toHaveLength(20);
    const textingHash = createHash("sha256");
    for (const track of gltf.animations.find((clip) => clip.name === "Texting While Standing")!.tracks) {
      textingHash.update(track.name);
      for (const array of [track.times, track.values]) textingHash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    }
    expect(textingHash.digest("hex")).toBe(acceptedTexting[character.id]);
    expect(character.handRetarget.correctedClips).toBe(19);
    expect(character.handRetarget.acceptedTextingPreserved).toBe(true);
    expect(resolveClips(gltf.animations.map((clip) => clip.name))).toEqual({ idle: "Texting While Standing", select: "Standing Greeting" });
    const scene = cloneCharacter(gltf.scene);
    const hips = characterBones(scene).hips;
    expect(hips).toBeDefined();
    expect(hips).not.toBe(characterBones(gltf.scene).hips);
    const meshes: THREE.SkinnedMesh[] = [];
    scene.traverse((node) => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(node as THREE.SkinnedMesh); });
    expect(meshes[0]!.skeleton.bones).toContain(hips);
    expect(meshes[0]!.frustumCulled).toBe(false);
    meshes[0]!.skeleton.pose();
    scene.updateMatrixWorld(true);
    const fingerChecks: { bone: THREE.Bone; rest: THREE.Quaternion; parent: THREE.Quaternion; axis: THREE.Vector3 }[] = [];
    if (scene.getObjectByName("hand_l")) {
      for (const side of ["l", "r"]) {
        const joint = (name: string) => scene.getObjectByName(`${name}_${side}`) as THREE.Bone;
        const point = (bone: THREE.Bone) => bone.getWorldPosition(new THREE.Vector3());
        const wrist = point(joint("hand"));
        const normal = point(joint("index_01")).sub(wrist).normalize()
          .cross(point(joint("pinky_01")).sub(wrist).normalize()).normalize();
        for (const digit of ["index", "middle", "ring", "pinky"]) {
          const bone = joint(`${digit}_02`);
          const direction = point(joint(`${digit}_03`)).sub(point(bone)).normalize();
          fingerChecks.push({ bone, rest: bone.quaternion.clone(), parent: bone.parent!.getWorldQuaternion(new THREE.Quaternion()),
            axis: normal.clone().cross(direction).normalize() });
        }
      }
    }
    const animator = new CompanionAnimator(scene, gltf.animations);
    const anchor = new HorizontalRootAnchor(scene, hips);
    const poses = new Map<string, THREE.Vector3[]>();
    for (const clip of gltf.animations) {
      animator.update(clip.duration / 2, true, clip.name);
      anchor.update();
      scene.updateMatrixWorld(true);
      const mesh = meshes[0]!;
      mesh.skeleton.update();
      const points = Array.from({ length: 32 }, (_, i) => mesh.getVertexPosition(Math.floor(i * mesh.geometry.attributes.position!.count / 32), new THREE.Vector3()));
      expect(points.every((p) => [p.x, p.y, p.z].every(Number.isFinite))).toBe(true);
      poses.set(clip.name, points);
    }
    const idle = poses.get("Sad Idle")!;
    const jump = poses.get("Joyful Jump")!;
    const greeting = poses.get("Standing Greeting")!;
    expect(Math.max(...jump.map((point, i) => point.distanceTo(idle[i]!)))).toBeGreaterThan(0.05);
    expect(Math.max(...greeting.map((point, i) => point.distanceTo(idle[i]!)))).toBeGreaterThan(0.05);
    animator.update(0.5, true, "Texting While Standing");
    animator.mixer.setTime(3);
    for (const check of fingerChecks) {
      const delta = check.bone.quaternion.clone().multiply(check.rest.clone().invert());
      const axis = new THREE.Vector3(delta.x, delta.y, delta.z).normalize().applyQuaternion(check.parent);
      expect(delta.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.3);
      expect(Math.abs(axis.dot(check.axis))).toBeGreaterThan(0.95);
    }
    expect(character.textingRetarget.method).toBe("source-anatomical-hand-frame-v2");
    const partial = character.id === "horned-demon";
    expect(character.textingRetarget.fullFingerRig).toBe(!partial);
    const joint = (side: string, digit: string) => meshes[0]!.skeleton.bones.find((bone) =>
      bone.name === `${digit}_${side}` || bone.name === `mixamorig${side === "l" ? "Left" : "Right"}Hand${digit === "hand" ? "" : digit === "index_01" ? "Index1" : digit === "thumb_01" ? "Thumb1" : "Pinky1"}`)!;
    for (const sample of textingPalms) {
      animator.mixer.setTime(sample.time);
      scene.updateMatrixWorld(true);
      meshes[0]!.skeleton.update();
      for (const [index, side] of ["l", "r"].entries()) {
        const point = (bone: THREE.Bone) => bone.getWorldPosition(new THREE.Vector3());
        const wrist = point(joint(side, "hand"));
        const normal = point(joint(side, "index_01")).sub(wrist).cross(point(joint(side, partial ? "thumb_01" : "pinky_01")).sub(wrist)).normalize();
        expect(normal.dot(new THREE.Vector3().fromArray((partial ? sample.thumbs : sample.palms)[index]!))).toBeGreaterThan(0.999);
      }
      const points = Array.from({ length: 32 }, (_, i) => meshes[0]!.getVertexPosition(Math.floor(i * meshes[0]!.geometry.attributes.position!.count / 32), new THREE.Vector3()));
      expect(points.every((point) => [point.x, point.y, point.z].every(Number.isFinite))).toBe(true);
    }
    for (const sample of gesturePalms) {
      const clip = gltf.animations.find((clip) => clip.name === sample.name)!;
      animator.update(0, true, sample.name);
      animator.mixer.setTime(clip.duration / 2);
      scene.updateMatrixWorld(true);
      for (const [index, side] of ["l", "r"].entries()) {
        const point = (bone: THREE.Bone) => bone.getWorldPosition(new THREE.Vector3());
        const wrist = point(joint(side, "hand"));
        const normal = point(joint(side, "index_01")).sub(wrist).cross(point(joint(side, partial ? "thumb_01" : "pinky_01")).sub(wrist)).normalize();
        expect(normal.dot(new THREE.Vector3().fromArray((partial ? sample.thumbs : sample.palms)[index]!))).toBeGreaterThan(0.999);
      }
    }
    const clap = gltf.animations.find((clip) => clip.name === "Clapping")!;
    for (const track of clap.tracks.filter((track) => /(?:arm|hand)(?:_[lr])?\.quaternion$/i.test(track.name))) {
      for (let offset = 4; offset < track.values.length; offset += 4) {
        expect(new THREE.Quaternion().fromArray(track.values, offset - 4).angleTo(new THREE.Quaternion().fromArray(track.values, offset))).toBeLessThan(Math.PI / 4);
      }
    }
    animator.dispose();
  }
}, 20_000);

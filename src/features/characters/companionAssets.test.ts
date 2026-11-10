// @vitest-environment node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import manifest from "../../../public/characters/manifest.json";
import { BUILTIN_CHARACTERS, DEFAULT_CHARACTER_ID } from "./catalog";
import { MOTION_PROFILES, SWING_SPRINGS, type CompanionId } from "./companionProfiles";
import { GESTURES, GESTURE_ROLES, findBone } from "./sleeveGestures";
import { prepareCompanion } from "./companionRig";
import { CompanionAnimator } from "./companionAnimator";

const IDS: CompanionId[] = ["rosie", "mxshy", "ang3l", "suki"];
const gltfs = new Map<CompanionId, GLTF>();

async function load(id: CompanionId) {
  const bytes = readFileSync(resolve("public/characters", `${id}.glb`));
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  // Textures need a browser; the mesh, skin and animation are what these checks exercise.
  loader.register(() => ({ name: "EXT_texture_webp", loadTexture: async () => new THREE.Texture() }));
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

function skinned(scene: THREE.Object3D) {
  let mesh: THREE.SkinnedMesh | undefined;
  scene.traverse((node) => { if (!mesh && (node as THREE.SkinnedMesh).isSkinnedMesh) mesh = node as THREE.SkinnedMesh; });
  return mesh!;
}

function sample(mesh: THREE.SkinnedMesh, count = 256) {
  mesh.skeleton.update();
  const total = mesh.geometry.attributes.position!.count;
  return Array.from({ length: count }, (_, i) => mesh.getVertexPosition(Math.floor(i * total / count), new THREE.Vector3()));
}

beforeAll(async () => {
  for (const id of IDS) gltfs.set(id, await load(id));
}, 60_000);

describe("the four companions", () => {
  it("ships exactly R.O.S.I.E, M.X.S.H.Y, A.N.G.3.L and S.U.K.I with verified assets and card art", () => {
    expect(BUILTIN_CHARACTERS.map((c) => c.id)).toEqual(IDS);
    expect(BUILTIN_CHARACTERS.map((c) => c.name)).toEqual(["R.O.S.I.E", "M.X.S.H.Y", "A.N.G.3.L", "S.U.K.I"]);
    expect(DEFAULT_CHARACTER_ID).toBe("rosie");
    expect(manifest.defaultCharacter).toBe("rosie");
    expect(manifest.characters.map((c) => c.id)).toEqual(IDS);
    for (const entry of manifest.characters) {
      const bytes = readFileSync(resolve("public", entry.model.slice(1)));
      expect(bytes.byteLength).toBe(entry.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
      expect(bytes.byteLength).toBeLessThan(4_000_000);
    }
    for (const c of BUILTIN_CHARACTERS) {
      for (const file of [c.card.art, c.card.clean, c.card.spec]) expect(readFileSync(resolve("public", file.slice(1))).byteLength).toBeGreaterThan(1000);
      const spec = JSON.parse(readFileSync(resolve("public", c.card.spec.slice(1)), "utf8"));
      expect(spec.regions.length).toBeGreaterThan(5);
    }
  });

  it.each(IDS)("%s: one skinned Rigify body, sleeves over hand joints, every spring bone present", (id) => {
    const gltf = gltfs.get(id)!;
    const mesh = skinned(gltf.scene);
    expect(mesh.skeleton.bones.length).toBe({ rosie: 37, mxshy: 30, ang3l: 34, suki: 30 }[id]);
    for (const name of ["DEF-upper_arm.L", "DEF-forearm.R", "DEF-hand.L", "DEF-sleeve.fore.R", "DEF-spine.006"]) expect(findBone(gltf.scene, name)).toBeDefined();
    for (const spec of SWING_SPRINGS[id]) expect(findBone(gltf.scene, spec.bone), spec.bone).toBeDefined();
    // No finger joints exist: the companions are hand-less by design.
    expect(mesh.skeleton.bones.some((b) => /index|thumb|pinky|finger/i.test(b.name))).toBe(false);
  });

  it.each(IDS)("%s: every sleeve gesture bakes, deforms the real mesh and stays finite", (id) => {
    const prepared = prepareCompanion(gltfs.get(id)!, id);
    const mesh = skinned(prepared.scene);
    expect(prepared.clips.map((c) => c.name).sort()).toEqual(Object.keys(GESTURES).sort());
    // Gesture clips never key spring-driven bones.
    const springBones = new Set(SWING_SPRINGS[id].map((s) => THREE.PropertyBinding.sanitizeNodeName(s.bone)));
    for (const clip of prepared.clips) for (const track of clip.tracks) expect(springBones.has(track.name.split(".")[0]!)).toBe(false);

    const animator = new CompanionAnimator(prepared.scene, prepared.clips, () => 0, prepared.roles);
    expect(animator.idleName).toBe(GESTURE_ROLES.idle);
    animator.update(0.5, true, GESTURE_ROLES.idle);
    prepared.scene.updateMatrixWorld(true);
    const rest = sample(mesh);
    for (const clip of prepared.clips) {
      animator.update(0, true, clip.name);
      animator.mixer.setTime(clip.duration * 0.45);
      prepared.scene.updateMatrixWorld(true);
      const points = sample(mesh);
      expect(points.every((p) => [p.x, p.y, p.z].every(Number.isFinite)), clip.name).toBe(true);
      if (clip.name !== GESTURE_ROLES.idle && clip.name !== "Look Around") {
        expect(Math.max(...points.map((p, i) => p.distanceTo(rest[i]!))), clip.name).toBeGreaterThan(0.01);
      }
    }
    animator.dispose();
    prepared.dispose();
  }, 30_000);

  it.each(IDS)("%s: raised-arm gestures keep the sleeves attached to the shoulders", (id) => {
    const prepared = prepareCompanion(gltfs.get(id)!, id);
    const animator = new CompanionAnimator(prepared.scene, prepared.clips, () => 0, prepared.roles);
    const shoulder = findBone(prepared.scene, "DEF-upper_arm.R")!;
    const chest = findBone(prepared.scene, "DEF-spine.003")!;
    const spacing = () => shoulder.getWorldPosition(new THREE.Vector3()).distanceTo(chest.getWorldPosition(new THREE.Vector3()));
    animator.update(0.5, true, GESTURE_ROLES.idle);
    prepared.scene.updateMatrixWorld(true);
    const base = spacing();
    for (const name of ["Greeting", "Cheer", "Stretch", "Clap"]) {
      animator.update(0, true, name);
      animator.mixer.setTime(GESTURES[name]!.duration * 0.45);
      prepared.scene.updateMatrixWorld(true);
      expect(Math.abs(spacing() - base) / base, name).toBeLessThan(0.15);
    }
    animator.dispose();
    prepared.dispose();
  });

  it("maps request reactions onto sleeve gestures and plays them in turn", () => {
    const prepared = prepareCompanion(gltfs.get("mxshy")!, "mxshy");
    const animator = new CompanionAnimator(prepared.scene, prepared.clips, () => 0, prepared.roles);
    for (const reaction of ["Kneeling Pointing", "Clapping", "Angry", "Rejected", "Surprised"]) animator.queue(reaction);
    expect(() => { for (let t = 0; t < 20; t += 0.05) animator.update(0.05, false); }).not.toThrow();
    animator.dispose();
    prepared.dispose();
  });

  it("hair and sleeve springs respond to motion and settle within their limits", () => {
    for (const id of IDS) {
      const prepared = prepareCompanion(gltfs.get(id)!, id);
      const offset = new THREE.Vector3();
      for (let f = 0; f < 120; f++) {
        offset.x = f < 30 ? Math.sin(f / 30 * Math.PI) * 0.12 : 0;
        prepared.updateSprings(1 / 60, offset);
      }
      const spec = SWING_SPRINGS[id];
      const maxLimit = Math.max(...spec.map((s) => s.maxAngleDegrees));
      let maxAngle = 0;
      prepared.scene.traverse((node) => {
        const bone = node as THREE.Bone;
        if (!bone.isBone || !spec.some((s) => THREE.PropertyBinding.sanitizeNodeName(s.bone) === bone.name)) return;
        const rest = findBone(gltfs.get(id)!.scene, bone.userData.name ?? bone.name)!;
        maxAngle = Math.max(maxAngle, bone.quaternion.angleTo(rest.quaternion) * 180 / Math.PI);
      });
      expect(maxAngle, id).toBeLessThanOrEqual(maxLimit + 1e-6);
      prepared.dispose();
    }
  });

  it("gives each companion its own temperament", () => {
    expect(MOTION_PROFILES.mxshy.energy).toBeGreaterThan(MOTION_PROFILES.suki.energy);
    expect(MOTION_PROFILES.ang3l.fins).toBe(true);
    expect(MOTION_PROFILES.rosie.fins).toBe(false);
  });
});

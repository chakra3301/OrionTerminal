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
import { CompanionRagdoll } from "./companionRagdoll";

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
    expect(resolveClips(gltf.animations.map((clip) => clip.name))).toEqual({ idle: "Texting While Standing", select: "Standing Greeting" });
    const scene = cloneCharacter(gltf.scene);
    const hips = characterBones(scene).hips;
    expect(hips).toBeDefined();
    expect(hips).not.toBe(characterBones(gltf.scene).hips);
    const meshes: THREE.SkinnedMesh[] = [];
    scene.traverse((node) => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(node as THREE.SkinnedMesh); });
    expect(meshes[0]!.skeleton.bones).toContain(hips);
    expect(meshes[0]!.frustumCulled).toBe(false);
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
    const body = new THREE.Group();
    body.add(scene);
    body.updateMatrixWorld(true);
    const head = characterBones(scene).head!;
    const headPose = head.quaternion.clone();
    const grip = hips!.getWorldPosition(new THREE.Vector3());
    const ragdoll = new CompanionRagdoll(scene, body);
    ragdoll.setGrip(grip);
    for (let frame = 0; frame < 450; frame++) {
      ragdoll.restorePose();
      ragdoll.capturePose();
      ragdoll.update(1 / 30, true, 0.2, 0);
    }
    expect(hips!.getWorldPosition(new THREE.Vector3()).distanceTo(grip)).toBeLessThan(1e-6);
    expect(head.quaternion.angleTo(headPose)).toBeLessThanOrEqual(0.451);
    expect(head.quaternion.length()).toBeCloseTo(1);
    for (let frame = 0; frame < 120; frame++) {
      ragdoll.restorePose();
      ragdoll.capturePose();
      ragdoll.update(1 / 30, false, 0, 0);
    }
    expect(body.position.length()).toBeLessThan(0.001);
    expect(head.quaternion.angleTo(headPose)).toBeLessThan(0.001);
    animator.dispose();
  }
}, 20_000);

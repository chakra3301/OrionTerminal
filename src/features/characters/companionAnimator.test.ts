// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CompanionAnimator } from "./companionAnimator";
import { characterBones, HorizontalRootAnchor, fitCharacter } from "./modelInstance";
import { useCompanionDebug } from "@/features/rosie/avatar/companionDebugStore";

function fixture() {
  const scene = new THREE.Group();
  const bone = new THREE.Bone();
  bone.name = "Hips";
  scene.add(bone);
  const clips = ["Sad Idle", "Standing Greeting", "Angry", "Happy", "Talking"].map((name, i) =>
    new THREE.AnimationClip(name, 2, [new THREE.NumberKeyframeTrack("Hips.position[y]", [0, 2], [i + 1, i + 1])]),
  );
  return { bone, clips, animator: new CompanionAnimator(scene, clips, () => 0) };
}

function advance(animator: CompanionAnimator, seconds: number, idle = true, test: string | null = null) {
  for (let t = 0; t < seconds; t += 0.05) animator.update(0.05, idle, test);
}

describe("companion playback", () => {
  it("starts in Sad Idle, completes an error while working, then revives the cached idle action", () => {
    const { animator, bone, clips } = fixture();
    animator.update(0.1, true);
    expect(bone.position.y).toBeCloseTo(1);
    expect(animator.gesture).toBe("Talking");
    animator.queue(animator.error);
    advance(animator, 1, false);
    expect(bone.position.y).toBeCloseTo(3);
    advance(animator, 2, false);
    expect(bone.position.y).toBeCloseTo(1);
    const idle = animator.mixer.clipAction(clips[0]!);
    expect(idle.enabled).toBe(true);
    expect(idle.isRunning()).toBe(true);
    expect(idle.getEffectiveWeight()).toBeCloseTo(1);
    animator.dispose();
  });

  it("switches every test clip and exits testing back to idle without a stuck pose", () => {
    const { animator, bone, clips } = fixture();
    for (const [index, clip] of clips.entries()) {
      advance(animator, 0.5, true, clip.name);
      expect(bone.position.y).toBeCloseTo(index + 1);
    }
    advance(animator, 0.5);
    expect(bone.position.y).toBeCloseTo(1);
    animator.queue(animator.greeting);
    advance(animator, 0.5);
    expect(bone.position.y).toBeCloseTo(2);
    advance(animator, 3);
    expect(bone.position.y).toBeCloseTo(1);
    animator.dispose();
  });

  it("lets a priority reaction interrupt an idle fidget and tolerates static uploads", () => {
    const { animator, bone } = fixture();
    advance(animator, 75.5);
    expect(bone.position.y).toBeCloseTo(4);
    animator.queue(animator.error);
    advance(animator, 1);
    expect(bone.position.y).toBeCloseTo(3);
    animator.dispose();
    const staticModel = new CompanionAnimator(new THREE.Group(), []);
    expect(() => staticModel.update(1, true)).not.toThrow();
    staticModel.dispose();
  });
});

it("anchors horizontal motion in model space on rotated FBX rigs while preserving jump height", () => {
  const scene = new THREE.Group();
  const root = new THREE.Bone();
  root.name = "Root";
  root.rotation.x = -Math.PI / 2;
  const hips = new THREE.Bone();
  hips.name = "mixamorig:Hips";
  hips.position.z = 1;
  scene.add(root);
  root.add(hips);
  expect(characterBones(scene).hips).toBe(hips);
  const anchor = new HorizontalRootAnchor(scene, hips);
  hips.position.set(3, 4, 2);
  anchor.update();
  scene.updateMatrixWorld(true);
  const point = scene.worldToLocal(hips.getWorldPosition(new THREE.Vector3()));
  expect(point.x).toBeCloseTo(0);
  expect(point.z).toBeCloseTo(0);
  expect(point.y).toBeCloseTo(2);
});

it("fits wide wings and resets the tester when switching to a shorter clip list", () => {
  const scene = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1));
  const fit = fitCharacter(scene, 1.7);
  expect(fit.scale * 4).toBeCloseTo(1.7);
  useCompanionDebug.setState({ names: Array(20).fill("clip"), index: 19 });
  useCompanionDebug.getState().setNames(["Idle"]);
  expect(useCompanionDebug.getState().index).toBe(0);
  scene.geometry.dispose();
});

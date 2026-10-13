import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

export function fitCharacter(scene: THREE.Object3D, height: number, width = height) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = Math.min(height / (size.y || 1), width / (size.x || 1));
  return { scale, center };
}

export function cloneCharacter(source: THREE.Object3D) {
  const scene = cloneSkeleton(source);
  scene.traverse((object) => {
    if ((object as THREE.SkinnedMesh).isSkinnedMesh) object.frustumCulled = false;
  });
  return scene;
}

export function characterBones(scene: THREE.Object3D) {
  const bones: Record<string, THREE.Bone> = {};
  scene.traverse((object) => {
    const bone = object as THREE.Bone;
    if (bone.isBone) {
      const name = bone.name.toLowerCase().replace(/^mixamorig:?/, "").replace(/[^a-z0-9]/g, "");
      bones[name] = bone;
    }
  });
  return {
    hips: bones.hips ?? bones.pelvis ?? bones.root,
    head: bones.head,
    neck: bones.neck ?? bones.neck01,
    spine: bones.spine ?? bones.spine01,
  };
}

export class AuthoredBonePose {
  private poses: { bone: THREE.Bone; quaternion: THREE.Quaternion }[] = [];

  constructor(scene: THREE.Object3D) {
    scene.traverse((node) => {
      const bone = node as THREE.Bone;
      if (bone.isBone) this.poses.push({ bone, quaternion: bone.quaternion.clone() });
    });
  }

  restore() {
    for (const pose of this.poses) pose.bone.quaternion.copy(pose.quaternion);
  }

  capture() {
    for (const pose of this.poses) pose.quaternion.copy(pose.bone.quaternion);
  }
}

export class HorizontalRootAnchor {
  private rest = new THREE.Vector3();
  private point = new THREE.Vector3();

  constructor(private scene: THREE.Object3D, private hips?: THREE.Bone) {
    if (hips) scene.worldToLocal(hips.getWorldPosition(this.rest));
  }

  update() {
    if (!this.hips?.parent) return;
    // FBX-derived rigs rotate their local axes; anchor in model space so jumps keep their height.
    this.scene.worldToLocal(this.hips.getWorldPosition(this.point));
    this.point.x = this.rest.x;
    this.point.z = this.rest.z;
    this.scene.localToWorld(this.point);
    this.hips.position.copy(this.hips.parent.worldToLocal(this.point));
  }
}

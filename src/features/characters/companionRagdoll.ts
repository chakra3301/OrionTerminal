import * as THREE from "three";

const boneName = (bone: THREE.Bone) => bone.name.toLowerCase().replace(/^mixamorig:?/, "").replace(/[^a-z0-9]/g, "");
const isBodyJoint = (bone: THREE.Bone) => /^(pelvis|hips|spine\d*|neck\d*|head|clavicle[lr]|upperarm[lr]|lowerarm[lr]|hand[lr]|thigh[lr]|calf[lr]|foot[lr]|left(?:shoulder|arm|forearm|hand|upleg|leg|foot)|right(?:shoulder|arm|forearm|hand|upleg|leg|foot))$/.test(boneName(bone));

type Joint = {
  bone: THREE.Bone;
  quaternion: THREE.Quaternion;
  child: THREE.Bone | undefined;
  angle: THREE.Vector3;
  velocity: THREE.Vector3;
  limit: number;
};

function limitFor(bone: THREE.Bone) {
  const name = boneName(bone);
  if (/hips|pelvis/.test(name)) return 0;
  if (/head|neck/.test(name)) return 0.45;
  if (/spine/.test(name)) return 0.35;
  if (/clavicle|shoulder|hand|foot/.test(name)) return 0.7;
  if (/lowerarm|forearm|calf|(?:left|right)leg$/.test(name)) return 1.35;
  return 1.85;
}

export class CompanionRagdoll {
  private poses: { bone: THREE.Bone; position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];
  private joints: Joint[] = [];
  private gripBone: THREE.Bone | null = null;
  private gripLocal = new THREE.Vector3();
  private gripWorld = new THREE.Vector3();
  private holding = false;
  private prepared = false;
  private bodyAngle = new THREE.Vector3();
  private bodyVelocity = new THREE.Vector3();
  private positionVelocity = new THREE.Vector3();
  private gravityAngle = 0;
  private point = new THREE.Vector3();
  private center = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private gravity = new THREE.Vector3();
  private target = new THREE.Vector3();
  private quaternion = new THREE.Quaternion();
  private parentQuaternion = new THREE.Quaternion();

  constructor(private scene: THREE.Object3D, private body: THREE.Group) {
    scene.traverse((node) => {
      const bone = node as THREE.Bone;
      if (!bone.isBone) return;
      this.poses.push({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() });
      if (!isBodyJoint(bone)) return;
      const children = bone.children.filter((child): child is THREE.Bone => (child as THREE.Bone).isBone);
      const child = children.find((child) => /spine|neck|head/.test(boneName(child)))
        ?? children.find(isBodyJoint) ?? children.find((child) => !/twist/.test(boneName(child)));
      this.joints.push({ bone, quaternion: bone.quaternion.clone(), child,
        angle: new THREE.Vector3(), velocity: new THREE.Vector3(), limit: limitFor(bone) });
    });
  }

  restorePose() {
    // Sparse clips leave some joints unkeyed; restore the authored pose before applying another overlay.
    for (const pose of this.poses) {
      pose.bone.position.copy(pose.position);
      pose.bone.quaternion.copy(pose.quaternion);
    }
  }

  capturePose() {
    for (const pose of this.poses) {
      pose.position.copy(pose.bone.position);
      pose.quaternion.copy(pose.bone.quaternion);
    }
    for (const joint of this.joints) {
      joint.quaternion.copy(joint.bone.quaternion);
    }
  }

  setGrip(point: THREE.Vector3, mesh?: THREE.SkinnedMesh, face?: THREE.Face | null) {
    this.gripWorld.copy(point);
    let bone: THREE.Bone | undefined;
    if (mesh && face) {
      const weights = mesh.geometry.getAttribute("skinWeight");
      const indices = mesh.geometry.getAttribute("skinIndex");
      const scores = new Map<THREE.Bone, number>();
      if (weights && indices) {
        for (const vertex of [face.a, face.b, face.c]) {
          for (let i = 0; i < 4; i++) {
            let candidate = mesh.skeleton.bones[indices.getComponent(vertex, i)];
            while (candidate && !isBodyJoint(candidate)) {
              candidate = (candidate.parent as THREE.Bone)?.isBone ? candidate.parent as THREE.Bone : undefined;
            }
            if (candidate) scores.set(candidate, (scores.get(candidate) ?? 0) + weights.getComponent(vertex, i));
          }
        }
        bone = [...scores].sort((a, b) => b[1] - a[1])[0]?.[0];
      }
    }
    if (!bone) {
      let distance = Infinity;
      for (const joint of this.joints) {
        const d = joint.bone.getWorldPosition(this.point).distanceToSquared(this.gripWorld);
        if (d < distance) { distance = d; bone = joint.bone; }
      }
    }
    this.gripBone = bone ?? null;
    if (bone) this.gripLocal.copy(bone.worldToLocal(this.point.copy(this.gripWorld)));
    this.prepared = true;
  }

  get active() {
    return this.holding || this.bodyAngle.lengthSq() > 0.00001 || this.body.position.lengthSq() > 0.00001
      || this.joints.some((joint) => joint.angle.lengthSq() > 0.00001);
  }

  private startHolding() {
    this.body.updateWorldMatrix(true, true);
    if (!this.prepared) {
      const hips = this.joints.find((joint) => /hips|pelvis/.test(boneName(joint.bone)))?.bone;
      this.setGrip(hips ? hips.getWorldPosition(this.point) : this.scene.getWorldPosition(this.point));
    }
    this.center.set(0, 0, 0);
    let mass = 0;
    for (const joint of this.joints) {
      const name = boneName(joint.bone);
      const weight = /hips|pelvis|spine/.test(name) ? 3 : /head|thigh|upleg/.test(name) ? 1.5 : 0.5;
      this.center.addScaledVector(joint.bone.getWorldPosition(this.point), weight);
      mass += weight;
    }
    if (mass) this.center.divideScalar(mass);
    this.body.worldToLocal(this.center);
    this.body.worldToLocal(this.point.copy(this.gripWorld));
    this.direction.subVectors(this.center, this.point);
    const angle = -Math.PI / 2 - Math.atan2(this.direction.y, this.direction.x);
    this.gravityAngle = Math.atan2(Math.sin(angle), Math.cos(angle));
    this.prepared = false;
  }

  private spring(value: THREE.Vector3, velocity: THREE.Vector3, target: THREE.Vector3, dt: number, stiffness: number, damping: number) {
    const steps = Math.max(1, Math.ceil(dt * 120));
    const step = dt / steps;
    for (let i = 0; i < steps; i++) {
      velocity.x += ((target.x - value.x) * stiffness - velocity.x * damping) * step;
      velocity.y += ((target.y - value.y) * stiffness - velocity.y * damping) * step;
      velocity.z += ((target.z - value.z) * stiffness - velocity.z * damping) * step;
      value.addScaledVector(velocity, step);
    }
  }

  update(delta: number, dragging: boolean, vx: number, vy: number) {
    const dt = Math.min(delta, 0.05);
    if (dragging && !this.holding) this.startHolding();
    this.holding = dragging;
    this.target.set(dragging ? THREE.MathUtils.clamp(vy * 0.22, -0.5, 0.5) : 0, 0,
      dragging ? this.gravityAngle + THREE.MathUtils.clamp(-vx * 0.35, -0.6, 0.6) : 0);
    this.spring(this.bodyAngle, this.bodyVelocity, this.target, dt, dragging ? 28 : 65, dragging ? 9 : 15);
    this.bodyAngle.clampLength(0, Math.PI + 0.6);
    this.body.rotation.set(this.bodyAngle.x, 0, this.bodyAngle.z);
    this.body.updateWorldMatrix(true, true);

    for (const joint of this.joints) {
      this.target.set(0, 0, 0);
      if (dragging && joint.child && joint.limit && joint.bone !== this.gripBone) {
        joint.bone.parent!.getWorldQuaternion(this.parentQuaternion).invert();
        this.gravity.set(0, -1, 0).applyQuaternion(this.parentQuaternion);
        this.direction.copy(joint.child.position).applyQuaternion(joint.quaternion).normalize();
        if (this.direction.lengthSq()) {
          this.quaternion.setFromUnitVectors(this.direction, this.gravity);
          const angle = Math.min(joint.limit, 2 * Math.acos(THREE.MathUtils.clamp(this.quaternion.w, -1, 1)));
          this.target.set(this.quaternion.x, this.quaternion.y, this.quaternion.z).normalize().multiplyScalar(angle);
        }
      }
      this.spring(joint.angle, joint.velocity, this.target, dt, 38, 12);
      joint.angle.clampLength(0, joint.limit);
      const angle = joint.angle.length();
      if (angle > 0.00001) {
        this.direction.copy(joint.angle).divideScalar(angle);
        this.quaternion.setFromAxisAngle(this.direction, angle);
        joint.bone.quaternion.copy(joint.quaternion).premultiply(this.quaternion);
        joint.bone.updateWorldMatrix(false, true);
      }
    }

    if (dragging && this.gripBone) {
      this.gripBone.localToWorld(this.point.copy(this.gripLocal));
      if (this.body.parent) {
        this.body.parent.worldToLocal(this.center.copy(this.gripWorld));
        this.body.parent.worldToLocal(this.point);
        this.direction.subVectors(this.center, this.point);
      } else this.direction.subVectors(this.gripWorld, this.point);
      this.body.position.add(this.direction);
      this.positionVelocity.set(0, 0, 0);
    } else {
      this.target.set(0, 0, 0);
      this.spring(this.body.position, this.positionVelocity, this.target, dt, 65, 15);
    }
    this.body.updateWorldMatrix(true, true);
  }
}

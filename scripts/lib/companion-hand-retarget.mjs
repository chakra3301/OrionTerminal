import * as THREE from "three";
import { fingerIdentity } from "./companion-fingers.mjs";

const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const rotation = (matrix) => {
  const q = new THREE.Quaternion();
  matrix.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return q.normalize();
};

export function bindTransforms(root) {
  root.updateMatrixWorld(true);
  const rest = new Map();
  root.traverse((object) => {
    if (object.isBone) rest.set(object, { matrix: object.matrixWorld.clone() });
  });
  root.traverse((object) => {
    if (!object.isSkinnedMesh) return;
    object.skeleton.bones.forEach((bone, index) => {
      rest.get(bone).matrix = object.skeleton.boneInverses[index].clone().invert();
    });
  });
  for (const value of rest.values()) value.rotation = rotation(value.matrix);
  for (const [bone, value] of rest) {
    const parent = rest.get(bone.parent)?.rotation ?? rotation(bone.parent.matrixWorld);
    value.local = parent.clone().invert().multiply(value.rotation);
  }
  return rest;
}

export function handFrame(rest, side, secondDigit = "pinky") {
  const bones = [...rest.keys()];
  const wrist = bones.find((bone) => normalize(bone.name) === `mixamorig${side === "l" ? "left" : "right"}hand` || bone.name === `hand_${side}`);
  const finger = (digit, segment) => bones.find((bone) => {
    const identity = fingerIdentity(bone.name);
    return identity?.side === side && identity.digit === digit && identity.segment === segment;
  });
  const position = (bone) => new THREE.Vector3().setFromMatrixPosition(rest.get(bone).matrix);
  if (!wrist || !finger("index", 1) || !finger(secondDigit, 1)) throw new Error(`Missing ${side} hand landmarks`);
  const origin = position(wrist);
  const index = position(finger("index", 1)).sub(origin);
  const other = position(finger(secondDigit, 1)).sub(origin);
  const normal = index.clone().cross(other).normalize();
  if (normal.lengthSq() < 0.99) throw new Error(`Degenerate ${side} palm`);
  const frame = (direction) => {
    const x = direction.clone().normalize();
    const z = normal.clone().addScaledVector(x, -normal.dot(x)).normalize();
    const y = z.clone().cross(x).normalize();
    if (x.lengthSq() < 0.99 || z.lengthSq() < 0.99) throw new Error(`Degenerate ${side} finger`);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  };
  const axis = secondDigit === "pinky" ? index.clone().add(other) : index;
  const local = rest.get(wrist).rotation.clone().invert().multiply(frame(axis));
  const fingers = new Map();
  for (const bone of bones) {
    const identity = fingerIdentity(bone.name);
    if (identity?.side !== side) continue;
    const child = finger(identity.digit, identity.segment + 1);
    const direction = child ? position(child).sub(position(bone)) : position(bone).sub(position(bone.parent));
    fingers.set(`${identity.digit}${identity.segment}`, {
      bone, frame: rest.get(bone.parent).rotation.clone().invert().multiply(frame(direction)),
    });
  }
  const palmLength = position(finger("middle", 1) ?? finger("index", 1)).distanceTo(origin);
  return { wrist, local, fingers, palmLength };
}

export function solveTwoBoneArm(wrist, target) {
  const lower = wrist.parent, upper = lower?.parent;
  if (!lower?.isBone || !upper?.isBone) return;
  const position = (bone) => bone.getWorldPosition(new THREE.Vector3());
  const shoulder = position(upper), elbow = position(lower), hand = position(wrist);
  const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(hand);
  if (a < 1e-8 || b < 1e-8) throw new Error("Zero-length arm");
  const axis = target.clone().sub(shoulder);
  const distance = THREE.MathUtils.clamp(axis.length(), Math.abs(a - b) + 1e-7, a + b - 1e-7);
  axis.normalize();
  const pole = elbow.clone().sub(shoulder);
  pole.addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-12) {
    pole.set(0, 0, 1).applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()));
    pole.addScaledVector(axis, -pole.dot(axis));
  }
  if (pole.lengthSq() < 1e-12) pole.set(1, 0, 0).cross(axis);
  pole.normalize();
  const cosine = THREE.MathUtils.clamp((a * a + distance * distance - b * b) / (2 * a * distance), -1, 1);
  const desiredElbow = shoulder.clone().addScaledVector(axis, a * cosine).addScaledVector(pole, a * Math.sqrt(1 - cosine * cosine));
  const upperTurn = new THREE.Quaternion().setFromUnitVectors(elbow.clone().sub(shoulder).normalize(), desiredElbow.sub(shoulder).normalize());
  upper.quaternion.copy(upper.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(upperTurn).multiply(upper.getWorldQuaternion(new THREE.Quaternion())));
  upper.updateWorldMatrix(false, true);
  const movedElbow = position(lower);
  const lowerTurn = new THREE.Quaternion().setFromUnitVectors(position(wrist).sub(movedElbow).normalize(), target.clone().sub(movedElbow).normalize());
  lower.quaternion.copy(lower.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(lowerTurn).multiply(lower.getWorldQuaternion(new THREE.Quaternion())));
  lower.updateWorldMatrix(false, true);
}

export function handTransfer(target, source) {
  const targetRest = bindTransforms(target);
  const sourceRest = bindTransforms(source);
  const hands = [];
  for (const side of ["l", "r"]) {
    const hasPinky = [...targetRest.keys()].some((bone) => {
      const id = fingerIdentity(bone.name);
      return id?.side === side && id.digit === "pinky" && id.segment === 1;
    });
    const landmark = hasPinky ? "pinky" : "thumb";
    hands.push({ target: handFrame(targetRest, side, landmark), source: handFrame(sourceRest, side, landmark) });
  }
  const arms = hands.flatMap(({ target }) => target.wrist.parent?.isBone && target.wrist.parent.parent?.isBone
    ? [target.wrist.parent.parent, target.wrist.parent] : []);
  const bones = [...arms, ...hands.flatMap(({ target }) => [target.wrist, ...[...target.fingers.values()].map(({ bone }) => bone)])];
  return {
    bones, arms, fullFingerRig: hands.every(({ target }) => target.fingers.size >= 15),
    apply() {
      source.updateMatrixWorld(true);
      target.updateMatrixWorld(true);
      const position = (bone) => bone.getWorldPosition(new THREE.Vector3());
      const center = position(hands[0].target.wrist).add(position(hands[1].target.wrist)).multiplyScalar(0.5);
      const ratio = hands.reduce((sum, hand) => sum + hand.target.palmLength / hand.source.palmLength, 0) / 2;
      const halfGrip = position(hands[0].source.wrist).sub(position(hands[1].source.wrist)).multiplyScalar(ratio / 2);
      solveTwoBoneArm(hands[0].target.wrist, center.clone().add(halfGrip));
      solveTwoBoneArm(hands[1].target.wrist, center.clone().sub(halfGrip));
      target.updateMatrixWorld(true);
      for (const { target: to, source: from } of hands) {
        // Match the donor's anatomical palm, rather than its arbitrary bone roll or the camera direction.
        const world = from.wrist.getWorldQuaternion(new THREE.Quaternion()).multiply(from.local).multiply(to.local.clone().invert());
        to.wrist.quaternion.copy(to.wrist.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
        for (const [identity, joint] of to.fingers) {
          const donor = from.fingers.get(identity);
          if (!donor) continue;
          const alignment = joint.frame.clone().multiply(donor.frame.clone().invert());
          const delta = donor.bone.quaternion.clone().multiply(sourceRest.get(donor.bone).local.clone().invert());
          joint.bone.quaternion.copy(alignment.clone().multiply(delta).multiply(alignment.clone().invert()).multiply(targetRest.get(joint.bone).local)).normalize();
        }
      }
      target.updateMatrixWorld(true);
    },
  };
}

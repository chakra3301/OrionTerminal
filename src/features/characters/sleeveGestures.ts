import * as THREE from "three";
import type { MotionProfile } from "./companionProfiles";

// Gesture library for the hand-less companions. Their oversized sleeves cover
// DEF-hand, so nothing here poses hands or fingers: every move is an arm aim,
// an elbow fold, a shoulder lift, spine/head motion or whole-body motion.
// Arms, legs and shoulders hang off the rig root (not the spine), so the spine
// only ever bends a few degrees — larger bends would tear torso skin away
// from the arms.

export const GESTURE_FPS = 30;

/** Directions are in the character's frame: +Y up, +Z facing out, +X its left. */
type Arm = { elev: number; az: number; foreElev: number; foreAz: number };
type Pose = {
  L: Arm; R: Arm;
  shrugL: number; shrugR: number;
  chestPitch: number; chestRoll: number; chestYaw: number;
  headPitch: number; headYaw: number; headRoll: number;
  rootY: number; rootPitch: number; rootRoll: number; rootYaw: number;
  fins: number;
};

const TAU = Math.PI * 2;
const sin = Math.sin;
const smooth = (x: number) => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
/** 0 → 1 → 0 over a clip, easing in for `a` seconds and out for `b`. */
const env = (t: number, dur: number, a = 0.35, b = 0.45) => Math.min(smooth(t / a), smooth((dur - t) / b));
const lerp = (a: number, b: number, w: number) => a + (b - a) * w;

function mixArm(a: Arm, b: Partial<Arm>, w: number): Arm {
  return {
    elev: lerp(a.elev, b.elev ?? a.elev, w), az: lerp(a.az, b.az ?? a.az, w),
    foreElev: lerp(a.foreElev, b.foreElev ?? a.foreElev, w), foreAz: lerp(a.foreAz, b.foreAz ?? a.foreAz, w),
  };
}

type Target = Partial<Omit<Pose, "L" | "R">> & { L?: Partial<Arm>; R?: Partial<Arm> };
function mix(base: Pose, target: Target, w: number): Pose {
  const out = { ...base, L: mixArm(base.L, target.L ?? {}, w), R: mixArm(base.R, target.R ?? {}, w) };
  for (const key of Object.keys(target) as (keyof Target)[]) {
    if (key === "L" || key === "R") continue;
    const value = target[key];
    if (typeof value === "number") (out as Record<string, unknown>)[key] = lerp(base[key] as number, value, w);
  }
  return out;
}

function idle(t: number, p: MotionProfile): Pose {
  const breath = sin(TAU * t / 4);
  const drift = sin(TAU * t / 8);
  const arm = (phase: number): Arm => {
    const elev = -p.armDown + 0.03 * sin(TAU * t / 4 + phase);
    const az = p.armForward + 0.035 * sin(TAU * t / 8 + phase);
    return { elev, az, foreElev: elev + 0.2, foreAz: az + 0.5 };
  };
  return {
    L: arm(0), R: arm(1.3),
    shrugL: 0.02 * breath, shrugR: 0.02 * breath,
    chestPitch: 0.012 * breath, chestRoll: 0.008 * drift, chestYaw: 0,
    headPitch: p.headPitch + 0.03 * sin(TAU * t / 4 + 0.6), headYaw: 0.07 * sin(TAU * t / 8 + 1), headRoll: 0.03 * sin(TAU * t / 8 + 2),
    rootY: 0.0022 * (1 - Math.cos(TAU * t / 4)), rootPitch: 0, rootRoll: 0.01 * drift, rootYaw: 0.04 * sin(TAU * t / 8 + 0.4),
    fins: 0.02 * breath,
  };
}

type Gesture = { duration: number; loop?: boolean; pose: (t: number, p: MotionProfile, e: number) => Pose };

const hop = (t: number, start: number, length: number, height: number) => {
  const k = (t - start) / length;
  return k > 0 && k < 1 ? height * sin(Math.PI * k) : 0;
};

export const GESTURES: Record<string, Gesture> = {
  Idle: { duration: 8, loop: true, pose: (t, p) => idle(t, p) },

  // Sleeve wave: right arm up, forearm swings so the empty cuff flops.
  Greeting: {
    duration: 2.8,
    pose: (t, p, e) => {
      const w = env(t, 2.8, 0.4, 0.5);
      const wave = 0.38 * e * sin(TAU * 2.2 * Math.max(0, t - 0.35)) * smooth((t - 0.3) / 0.3);
      return mix(idle(t, p), {
        R: { elev: 0.62, az: 0.28, foreElev: 1.22, foreAz: 0.42 + wave },
        shrugR: 0.14, headRoll: -0.1, headYaw: -0.1, chestRoll: -0.02, rootRoll: -0.015, fins: 0.1,
      }, w);
    },
  },

  // Explaining: forearms lift forward in turn, small nods.
  Talking: {
    duration: 3.2,
    pose: (t, p, e) => {
      const w = env(t, 3.2);
      const a = smooth(0.5 + 0.5 * sin(TAU * 0.9 * t)), b = smooth(0.5 + 0.5 * sin(TAU * 0.9 * t + Math.PI));
      return mix(idle(t, p), {
        L: { elev: -0.95, az: 0.75, foreElev: -0.55 + 0.5 * e * a, foreAz: 1.45 },
        R: { elev: -0.95, az: 0.75, foreElev: -0.55 + 0.5 * e * b, foreAz: 1.45 },
        headPitch: p.headPitch + 0.06 * e * sin(TAU * 1.8 * t), headYaw: 0.08 * sin(TAU * 0.6 * t),
      }, w);
    },
  },

  // Request started: point the right cuff out at the screen, lean in.
  Point: {
    duration: 2.4,
    pose: (t, p) => {
      const w = env(t, 2.4, 0.3, 0.5);
      return mix(idle(t, p), {
        R: { elev: 0.05, az: 1.3, foreElev: 0.12, foreAz: 1.38 },
        shrugR: 0.08, rootPitch: 0.04, headPitch: p.headPitch + 0.08, headYaw: -0.12, chestYaw: -0.03,
      }, w);
    },
  },

  // Done: sleeve clap — arms forward, cuffs meet in front, small bounces.
  Clap: {
    duration: 2.5,
    pose: (t, p, e) => {
      const w = env(t, 2.5, 0.3, 0.45);
      const beat = 0.5 + 0.5 * Math.cos(TAU * 2.4 * Math.max(0, t - 0.3));
      const fore = 2.0 + 0.3 * beat;
      return mix(idle(t, p), {
        L: { elev: -0.3, az: 1.42, foreElev: -0.1, foreAz: fore },
        R: { elev: -0.3, az: 1.42, foreElev: -0.1, foreAz: fore },
        rootY: hop(t, 0.35, 0.45, p.hop * e) + hop(t, 1.0, 0.45, p.hop * 0.7 * e),
        headPitch: p.headPitch - 0.05, headRoll: 0.06 * sin(TAU * 1.2 * t),
      }, w);
    },
  },

  // Celebrate: arms up in a V, sleeves flapping, two hops.
  Cheer: {
    duration: 2.4,
    pose: (t, p, e) => {
      const w = env(t, 2.4, 0.3, 0.5);
      const flap = 0.22 * e * sin(TAU * 3 * t);
      return mix(idle(t, p), {
        L: { elev: 0.95, az: 0.2, foreElev: 1.2 + flap, foreAz: 0.3 },
        R: { elev: 0.95, az: 0.2, foreElev: 1.2 - flap, foreAz: 0.3 },
        shrugL: 0.16, shrugR: 0.16, headPitch: p.headPitch - 0.12,
        rootY: hop(t, 0.4, 0.5, p.hop * 1.4 * e) + hop(t, 1.05, 0.5, p.hop * 1.1 * e), fins: 0.3,
      }, w);
    },
  },

  // Error: shoulders up, stiff arms pressed down and back, head shakes.
  Huff: {
    duration: 2.3,
    pose: (t, p, e) => {
      const w = env(t, 2.3, 0.2, 0.5);
      return mix(idle(t, p), {
        L: { elev: -1.32, az: -0.12, foreElev: -1.28, foreAz: 0 },
        R: { elev: -1.32, az: -0.12, foreElev: -1.28, foreAz: 0 },
        shrugL: 0.2, shrugR: 0.2, rootPitch: 0.035, headPitch: p.headPitch + 0.1,
        headYaw: 0.16 * e * sin(TAU * 3.2 * t) * smooth((t - 0.3) / 0.2),
        rootY: -0.002,
      }, w);
    },
  },

  // Refusal: head shake, sleeves swept out low.
  "Shake No": {
    duration: 2.1,
    pose: (t, p, e) => {
      const w = env(t, 2.1, 0.3, 0.5);
      return mix(idle(t, p), {
        L: { elev: -0.78, az: 0.32, foreElev: -0.55, foreAz: 0.35 },
        R: { elev: -0.78, az: 0.32, foreElev: -0.55, foreAz: 0.35 },
        headYaw: 0.28 * e * sin(TAU * 1.6 * Math.max(0, t - 0.2)), headPitch: p.headPitch + 0.04, rootRoll: 0,
      }, w);
    },
  },

  // Asking for input: quick lean back, arms lift out, head tips up.
  Surprised: {
    duration: 2,
    pose: (t, p) => {
      const pop = Math.min(smooth(t / 0.18), smooth((2 - t) / 0.7));
      return mix(idle(t, p), {
        L: { elev: -0.18, az: 0.58, foreElev: 0.3, foreAz: 0.9 },
        R: { elev: -0.18, az: 0.58, foreElev: 0.3, foreAz: 0.9 },
        shrugL: 0.18, shrugR: 0.18, rootPitch: -0.05, headPitch: p.headPitch - 0.14, fins: 0.25,
      }, pop);
    },
  },

  // Fidgets.
  "Sleeve Flap": {
    duration: 2.2,
    pose: (t, p, e) => {
      const w = env(t, 2.2);
      const shake = 0.26 * e * sin(TAU * 3.4 * t);
      return mix(idle(t, p), {
        L: { elev: -0.42, az: 0.42, foreElev: -0.2, foreAz: 0.6 + shake },
        R: { elev: -0.42, az: 0.42, foreElev: -0.2, foreAz: 0.6 - shake },
        rootY: hop(t, 0.6, 0.35, p.hop * 0.5 * e), headRoll: 0.07 * sin(TAU * 1.7 * t),
      }, w);
    },
  },
  Stretch: {
    duration: 3.2,
    pose: (t, p) => {
      const w = env(t, 3.2, 0.8, 0.8);
      return mix(idle(t, p), {
        L: { elev: 1.3, az: 0.45, foreElev: 1.42, foreAz: 0.7 },
        R: { elev: 1.3, az: 0.45, foreElev: 1.42, foreAz: 0.7 },
        shrugL: 0.2, shrugR: 0.2, rootPitch: -0.03, chestPitch: -0.03, headPitch: p.headPitch - 0.16,
        rootY: p.hop * 0.4, fins: 0.2,
      }, w);
    },
  },
  "Look Around": {
    duration: 3.6,
    pose: (t, p) => {
      const w = env(t, 3.6, 0.6, 0.7);
      const look = sin(TAU * t / 3.6);
      return mix(idle(t, p), {
        headYaw: 0.42 * look, headPitch: p.headPitch - 0.04, chestYaw: 0.05 * look, rootYaw: 0.08 * look,
      }, w);
    },
  },
  Bashful: {
    duration: 3,
    pose: (t, p) => {
      const w = env(t, 3, 0.5, 0.7);
      return mix(idle(t, p), {
        L: { elev: -1.0, az: 1.05, foreElev: -0.62, foreAz: 1.85 },
        R: { elev: -1.0, az: 1.05, foreElev: -0.62, foreAz: 1.85 },
        headPitch: p.headPitch + 0.16, headRoll: 0.12, rootYaw: 0.14 * sin(TAU * 0.7 * t), shrugL: 0.08, shrugR: 0.08,
      }, w);
    },
  },
};

export const GESTURE_ROLES = {
  idle: "Idle",
  greeting: "Greeting",
  gesture: "Talking",
  start: "Point",
  done: "Clap",
  error: "Huff",
  refuse: "Shake No",
  question: "Surprised",
  fidgets: ["Sleeve Flap", "Stretch", "Look Around", "Bashful", "Cheer"],
} as const;

// ── Rig binding ─────────────────────────────────────────────────────────────

const Y = new THREE.Vector3(0, 1, 0);
const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

export function findBone(scene: THREE.Object3D, name: string): THREE.Bone | undefined {
  const clean = THREE.PropertyBinding.sanitizeNodeName(name);
  let found: THREE.Bone | undefined;
  scene.traverse((node) => {
    const bone = node as THREE.Bone;
    if (!found && bone.isBone && (bone.name === clean || bone.name === name || bone.userData?.name === name)) found = bone;
  });
  return found;
}

/** The Rigify deform root: the shared parent of DEF-spine and the limbs. */
export function rigRoot(scene: THREE.Object3D) {
  return findBone(scene, "DEF-spine")?.parent ?? undefined;
}

type Joint = { bone: THREE.Bone; rest: THREE.Quaternion };

/** Poses a cloned companion rig. Construct while the rig is still at its bind pose. */
export class SleeveRig {
  readonly root: THREE.Object3D;
  private readonly rootRest: { position: THREE.Vector3; quaternion: THREE.Quaternion };
  private readonly joints = new Map<string, Joint>();
  private readonly rootInv = new THREE.Quaternion();
  private readonly q = new THREE.Quaternion();
  private readonly r = new THREE.Quaternion();
  private readonly d = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly e = new THREE.Euler();

  constructor(readonly scene: THREE.Object3D, private readonly profile: MotionProfile) {
    const root = rigRoot(scene);
    if (!root) throw new Error("Companion rig: DEF-spine has no parent");
    this.root = root;
    this.rootRest = { position: root.position.clone(), quaternion: root.quaternion.clone() };
    const names = ["upper_arm", "forearm", "shoulder"].flatMap((n) => [`DEF-${n}.L`, `DEF-${n}.R`])
      .concat(["DEF-spine.001", "DEF-spine.002", "DEF-spine.003", "DEF-spine.004", "DEF-spine.005", "DEF-spine.006"])
      .concat(profile.fins ? ["DEF-fin.upper.L", "DEF-fin.lower.L", "DEF-fin.upper.R", "DEF-fin.lower.R"] : []);
    for (const name of names) {
      const bone = findBone(scene, name);
      if (bone) this.joints.set(name, { bone, rest: bone.quaternion.clone() });
    }
    for (const side of ["L", "R"]) {
      if (!this.joints.has(`DEF-upper_arm.${side}`) || !this.joints.has(`DEF-forearm.${side}`)) {
        throw new Error(`Companion rig: missing arm chain on side ${side}`);
      }
    }
  }

  /** Objects this rig keys (track targets). Spring-driven leaves are never keyed. */
  keyed(): THREE.Object3D[] {
    return [this.root, ...[...this.joints.values()].map((j) => j.bone)];
  }

  /** Parent orientation in the rig-root frame, read live (posing is offline, so cost is fine). */
  private parentInRoot(bone: THREE.Bone, out: THREE.Quaternion) {
    const parent = bone.parent;
    if (!parent || parent === this.root) return out.identity();
    parent.updateWorldMatrix(true, false);
    return parent.getWorldQuaternion(out).premultiply(this.rootInv);
  }

  /** Rotate a joint by `angle` about `axis` given in the rig-root frame. */
  private turn(name: string, axis: THREE.Vector3, angle: number) {
    const joint = this.joints.get(name);
    if (!joint || !angle) return;
    const parent = this.parentInRoot(joint.bone, this.q);
    this.r.setFromAxisAngle(axis, angle);
    this.d.copy(parent).invert().multiply(this.r).multiply(parent);
    joint.bone.quaternion.premultiply(this.d);
    joint.bone.updateMatrixWorld(true);
  }

  /** Point a joint's +Y along `dir` (rig-root frame) with the minimal rotation from where it points now. */
  private aim(name: string, dir: THREE.Vector3) {
    const joint = this.joints.get(name)!;
    const parent = this.parentInRoot(joint.bone, this.q);
    const now = this.d.copy(parent).multiply(joint.bone.quaternion);
    this.v.copy(Y).applyQuaternion(now);
    this.r.setFromUnitVectors(this.v, dir);
    now.premultiply(this.r);
    joint.bone.quaternion.copy(parent.invert().multiply(now));
    joint.bone.updateMatrixWorld(true);
  }

  private direction(side: 1 | -1, elev: number, az: number) {
    return new THREE.Vector3(side * Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az)).normalize();
  }

  apply(pose: Pose) {
    for (const joint of this.joints.values()) joint.bone.quaternion.copy(joint.rest);
    this.root.position.copy(this.rootRest.position).y += pose.rootY;
    this.e.set(pose.rootPitch, pose.rootYaw, pose.rootRoll, "YXZ");
    this.root.quaternion.copy(this.rootRest.quaternion).multiply(this.q.setFromEuler(this.e));
    this.root.updateWorldMatrix(true, true);
    this.root.getWorldQuaternion(this.rootInv).invert();

    const chest = [["DEF-spine.001", 0.25], ["DEF-spine.002", 0.35], ["DEF-spine.003", 0.4]] as const;
    const neck = [["DEF-spine.004", 0.25], ["DEF-spine.005", 0.3], ["DEF-spine.006", 0.45]] as const;
    for (const [name, share] of chest) {
      this.turn(name, AX.x, pose.chestPitch * share);
      this.turn(name, AX.z, pose.chestRoll * share);
      this.turn(name, AX.y, pose.chestYaw * share);
    }
    for (const [name, share] of neck) {
      this.turn(name, AX.y, pose.headYaw * share);
      this.turn(name, AX.x, pose.headPitch * share);
      this.turn(name, AX.z, pose.headRoll * share);
    }
    for (const [key, sign] of [["L", 1], ["R", -1]] as const) {
      const arm = pose[key];
      this.aim(`DEF-upper_arm.${key}`, this.direction(sign, arm.elev, arm.az));
      this.aim(`DEF-forearm.${key}`, this.direction(sign, arm.foreElev, arm.foreAz));
      // Shoulder skin follows a raised arm; the shoulder is a sibling, not a parent.
      const lift = (key === "L" ? pose.shrugL : pose.shrugR) + 0.22 * Math.max(0, arm.elev + this.profile.armDown);
      this.turn(`DEF-shoulder.${key}`, AX.z, sign * Math.min(0.35, lift));
      if (this.profile.fins) {
        this.turn(`DEF-fin.upper.${key}`, AX.z, -sign * pose.fins * 0.35);
        this.turn(`DEF-fin.lower.${key}`, AX.z, -sign * pose.fins * 0.25);
      }
    }
    this.scene.updateMatrixWorld(true);
  }

  /** Bake one gesture to a clip. */
  bake(name: string, gesture: Gesture): THREE.AnimationClip {
    const frames = Math.max(2, Math.round(gesture.duration * GESTURE_FPS) + 1);
    const targets = this.keyed();
    const times = new Float32Array(frames);
    const quats = targets.map(() => new Float32Array(frames * 4));
    const rootPos = new Float32Array(frames * 3);
    const energy = this.profile.energy;
    for (let f = 0; f < frames; f++) {
      const time = gesture.loop && f === frames - 1 ? 0 : (f / (frames - 1)) * gesture.duration;
      times[f] = (f / (frames - 1)) * gesture.duration;
      this.apply(gesture.pose(time, this.profile, energy));
      targets.forEach((target, i) => target.quaternion.toArray(quats[i]!, f * 4));
      this.root.position.toArray(rootPos, f * 3);
    }
    const tracks: THREE.KeyframeTrack[] = targets.map((target, i) =>
      new THREE.QuaternionKeyframeTrack(`${target.name}.quaternion`, times, quats[i]!));
    tracks.push(new THREE.VectorKeyframeTrack(`${this.root.name}.position`, times, rootPos));
    this.reset();
    return new THREE.AnimationClip(name, gesture.duration, tracks);
  }

  bakeAll(): THREE.AnimationClip[] {
    return Object.entries(GESTURES).map(([name, gesture]) => this.bake(name, gesture));
  }

  reset() {
    for (const joint of this.joints.values()) joint.bone.quaternion.copy(joint.rest);
    this.root.position.copy(this.rootRest.position);
    this.root.quaternion.copy(this.rootRest.quaternion);
    this.scene.updateMatrixWorld(true);
  }
}

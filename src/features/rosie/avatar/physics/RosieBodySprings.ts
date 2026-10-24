import {
  AnimationClip, Bone, Matrix4, Object3D, PropertyBinding, Quaternion, Vector3,
} from "three";
import { DEFAULT_ROSIE_SPRINGS, sanitizeRosieSprings, type RosieRegion, type RosieSpringSettings } from "./rosieSpringSettings";

// Translation-only deformation; glass, armor and seam weights remain untouched.
// Caps stay inside previously sampled bone travel; arbitrary-direction skin
// collision/fold acceptance still requires rendered QA on the target device.
export const ROSIE_BODY_SPECS = [
  { region: "chest", frequency: 3.1, damping: 0.32, maxOffset: 0.0065 },
  { region: "glute", frequency: 3.3, damping: 0.36, maxOffset: 0.0055 },
  { region: "thigh", frequency: 5.0, damping: 0.48, maxOffset: 0.0015 },
] as const;

export const ROSIE_BODY_NAMES = ROSIE_BODY_SPECS.flatMap(({ region }) =>
  ["L", "R"].map((side) => `DEF-soft.${region}.${side}`),
);
const aliases = new Set(ROSIE_BODY_NAMES.flatMap((name) => [name, PropertyBinding.sanitizeNodeName(name)]));

/** Drop only baked soft-body TRS. Never mutate useGLTF's cached source clips. */
export function withoutBakedRosieBody(clips: readonly AnimationClip[]): AnimationClip[] {
  return clips.map((clip) => {
    const filtered = clip.clone();
    filtered.tracks = filtered.tracks.filter((track) => {
      const binding = PropertyBinding.parseTrackName(track.name);
      const node = binding.objectName === "bones" ? binding.objectIndex : binding.nodeName;
      return !(aliases.has(node ?? "") && ["position", "quaternion", "scale"].includes(binding.propertyName));
    });
    return filtered;
  });
}

type Body = {
  bone: Bone; region: RosieRegion; frequency: number; damping: number; maxOffset: number;
  rest: Vector3; rotation: Quaternion; scale: Vector3;
  anchor: Vector3; previousAnchor: Vector3; anchorVelocity: Vector3;
  offset: Vector3; velocity: Vector3; acceleration: Vector3;
  parentScale: Vector3; inverseParent: Matrix4;
};

/**
 * One controller per cloned GLTF instance. Construct BEFORE playing animation.
 * Each frame: mixer.update -> root/swing transforms -> controller.update(rawDt).
 * Animation clips MUST be passed through withoutBakedRosieBody, even when off.
 * Input screenOffset is a world-space equivalent of DOM/canvas translation.
 */
export class RosieBodySprings {
  readonly bodies: Body[] = [];
  private initialized = false;
  private primed = false;
  private enabled = true;
  private readonly delta = new Vector3();
  private readonly speed = new Vector3();
  private readonly force = new Vector3();
  private readonly local = new Vector3();

  constructor(private readonly scene: Object3D) {
    for (const spec of ROSIE_BODY_SPECS) {
      for (const side of ["L", "R"]) {
        const name = `DEF-soft.${spec.region}.${side}`;
        const bone = scene.getObjectByName(PropertyBinding.sanitizeNodeName(name)) ?? scene.getObjectByName(name);
        if (!(bone as Bone | undefined)?.isBone || !bone?.parent) continue;
        this.bodies.push({
          ...spec, bone: bone as Bone,
          rest: bone.position.clone(), rotation: bone.quaternion.clone(), scale: bone.scale.clone(),
          anchor: new Vector3(), previousAnchor: new Vector3(), anchorVelocity: new Vector3(),
          offset: new Vector3(), velocity: new Vector3(), acceleration: new Vector3(),
          parentScale: new Vector3(), inverseParent: new Matrix4(),
        });
      }
    }
    // A partial/custom rig is not this asset contract. Leave it untouched.
    if (this.bodies.length !== ROSIE_BODY_NAMES.length) this.bodies.length = 0;
  }

  /** Also restores immutable local rest TRS, so resets cannot accumulate drift. */
  reset(): void {
    this.initialized = false;
    this.primed = false;
    for (const b of this.bodies) {
      b.offset.set(0, 0, 0); b.velocity.set(0, 0, 0);
      b.acceleration.set(0, 0, 0); b.anchorVelocity.set(0, 0, 0);
      b.bone.position.copy(b.rest); b.bone.quaternion.copy(b.rotation); b.bone.scale.copy(b.scale);
      b.bone.updateMatrix();
    }
  }

  update(rawDt: number, settings: RosieSpringSettings = { ...DEFAULT_ROSIE_SPRINGS }, screenOffset?: Vector3): void {
    if (!this.bodies.length) return;
    const config = sanitizeRosieSprings(settings);
    if (config.enabled !== this.enabled) { this.reset(); this.enabled = config.enabled; }
    if (!Number.isFinite(rawDt) || rawDt <= 0 || rawDt > 0.1) this.reset();
    // Restore every frame, including when off; the solver never uses its own
    // deformed pose as a new rest position. Main animation is already evaluated.
    for (const b of this.bodies) {
      b.bone.position.copy(b.rest); b.bone.quaternion.copy(b.rotation); b.bone.scale.copy(b.scale);
    }
    this.scene.updateWorldMatrix(true, true);
    let teleport = false;
    for (const b of this.bodies) {
      const parent = b.bone.parent!;
      b.anchor.copy(b.rest).applyMatrix4(parent.matrixWorld);
      if (screenOffset) b.anchor.add(screenOffset);
      parent.getWorldScale(b.parentScale);
      const scale = Math.max(0.0001, Math.abs(b.parentScale.x), Math.abs(b.parentScale.y), Math.abs(b.parentScale.z));
      if (!Number.isFinite(b.anchor.lengthSq())) {
        // Never prime the next frame from an invalid external movement sample.
        this.reset();
        this.scene.updateWorldMatrix(false, true);
        return;
      }
      if (this.initialized && b.anchor.distanceTo(b.previousAnchor) > scale * 0.3) teleport = true;
    }
    if (teleport) this.reset();
    if (!config.enabled || !this.initialized) {
      for (const b of this.bodies) b.previousAnchor.copy(b.anchor);
      this.initialized = true;
      return;
    }
    const dt = Math.min(rawDt, 0.1);
    const steps = Math.ceil(dt / (1 / 240));
    const h = dt / steps;
    for (const b of this.bodies) {
      const scale = Math.max(0.0001, Math.abs(b.parentScale.x), Math.abs(b.parentScale.y), Math.abs(b.parentScale.z));
      this.speed.copy(b.anchor).sub(b.previousAnchor).divideScalar(dt);
      this.force.copy(this.speed).sub(b.anchorVelocity).divideScalar(dt);
      // Suppress the startup velocity discontinuity, then smooth sampled input.
      if (!this.primed) this.force.set(0, 0, 0);
      b.acceleration.lerp(this.force, 1 - Math.exp(-dt / 0.025));
      // Clamp after filtering: clamping the raw finite difference discards
      // more keyframe impulse at high frame rates.
      b.acceleration.clampLength(0, 16 * scale);
      const gain = Math.min(1.8, config.strength * config[b.region]);
      const omega = 2 * Math.PI * b.frequency;
      const max = b.maxOffset * scale;
      for (let i = 0; i < steps; i++) {
        this.delta.copy(b.offset).multiplyScalar(-omega * omega)
          .addScaledVector(b.velocity, -2 * b.damping * omega)
          .addScaledVector(b.acceleration, -gain);
        b.velocity.addScaledVector(this.delta, h).clampLength(0, max * 30);
        b.offset.addScaledVector(b.velocity, h);
        if (b.offset.lengthSq() > max * max) {
          b.offset.setLength(max);
          // Kill outward velocity at the cap instead of storing hidden energy.
          const outward = b.velocity.dot(b.offset) / (max * max);
          if (outward > 0) b.velocity.addScaledVector(b.offset, -outward);
        }
      }
      if (gain === 0) { b.offset.set(0, 0, 0); b.velocity.set(0, 0, 0); }
      b.inverseParent.copy(b.bone.parent!.matrixWorld).invert();
      // A displacement is a vector, not a point. Difference of transformed
      // points accounts for rotated/scaled parents without rest-bone axes.
      this.local.copy(b.anchor);
      if (screenOffset) this.local.sub(screenOffset);
      this.local.add(b.offset).applyMatrix4(b.inverseParent);
      b.bone.position.copy(this.local);
      b.bone.updateMatrix();
      b.previousAnchor.copy(b.anchor); b.anchorVelocity.copy(this.speed);
    }
    this.primed = true;
    this.scene.updateWorldMatrix(false, true);
  }

  dispose(): void { this.reset(); }
}

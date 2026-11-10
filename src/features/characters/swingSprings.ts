import { AnimationClip, Matrix4, Object3D, PropertyBinding, Quaternion, Vector3, type Bone } from "three";
import type { SwingSpringSpec } from "./companionProfiles";

// Live hair/sleeve swing for the companions, ported from the CPU-tested
// Mushroom / Cream v2 / ANGEL v2 handoffs (identical solver, per-asset specs).
// Rotation-only on leaf bones: a virtual tip runs a bounded, 1/240 s
// sub-stepped oscillator and the bone swings toward it from its immutable rest.

const Y = new Vector3(0, 1, 0);
const IDENTITY = new Quaternion();
const LIMITS = { maxStep: 1 / 240, maxFrame: 0.1, acceleration: 16, velocityCap: 30, smoothing: 0.025, teleport: 0.3, parentTurn: Math.PI / 4 };

export type SwingSettings = { enabled: boolean; strength: number; hair: number; sleeves: number };
export const DEFAULT_SWING: Readonly<SwingSettings> = Object.freeze({ enabled: true, strength: 1, hair: 1, sleeves: 1 });

type State = {
  spec: SwingSpringSpec; bone: Bone;
  restPosition: Vector3; restQuaternion: Quaternion; restScale: Vector3;
  tip: Vector3; previousTip: Vector3; anchorVelocity: Vector3; acceleration: Vector3; offset: Vector3; velocity: Vector3;
  parentScale: Vector3; parentQuaternion: Quaternion; previousParentQuaternion: Quaternion;
  scale: number; previousScale: number; inverseRestWorld: Matrix4;
};

function trackNode(track: { name: string }) {
  const binding = PropertyBinding.parseTrackName(track.name);
  return { node: (binding.objectName === "bones" ? binding.objectIndex : binding.nodeName) ?? "", property: binding.propertyName };
}

/** Clone clips without the baked TRS of spring-driven bones. Never mutates the cached source. */
export function withoutBakedSwing(clips: readonly AnimationClip[], specs: readonly SwingSpringSpec[]): AnimationClip[] {
  const names = new Set(specs.flatMap((s) => [s.bone, PropertyBinding.sanitizeNodeName(s.bone)]));
  return clips.map((clip) => {
    const copy = clip.clone();
    copy.tracks = copy.tracks.filter((track) => {
      const { node, property } = trackNode(track);
      return !(names.has(node) && ["position", "quaternion", "scale"].includes(property));
    });
    return copy;
  });
}

export class SwingSprings {
  private readonly states: State[] = [];
  private readonly delta = new Vector3();
  private readonly speed = new Vector3();
  private readonly force = new Vector3();
  private readonly local = new Vector3();
  private readonly swing = new Quaternion();
  private initialized = false;
  private primed = false;
  private enabled = true;

  /** Construct on a fresh clone at bind pose. Missing bones are skipped (custom rigs). */
  constructor(private readonly scene: Object3D, specs: readonly SwingSpringSpec[]) {
    const clean = new Map(specs.map((s) => [PropertyBinding.sanitizeNodeName(s.bone), s]));
    scene.traverse((node) => {
      const bone = node as Bone;
      const spec = bone.isBone ? clean.get(bone.name) ?? clean.get(PropertyBinding.sanitizeNodeName(bone.userData?.name ?? "")) : undefined;
      if (!spec || !bone.parent || bone.children.some((c) => (c as Bone).isBone)) return;
      this.states.push({
        spec, bone,
        restPosition: bone.position.clone(), restQuaternion: bone.quaternion.clone(), restScale: bone.scale.clone(),
        tip: new Vector3(), previousTip: new Vector3(), anchorVelocity: new Vector3(), acceleration: new Vector3(),
        offset: new Vector3(), velocity: new Vector3(), parentScale: new Vector3(), parentQuaternion: new Quaternion(),
        previousParentQuaternion: new Quaternion(), scale: 1, previousScale: 1, inverseRestWorld: new Matrix4(),
      });
    });
  }

  get count() { return this.states.length; }

  private restoreRest() {
    for (const s of this.states) {
      s.bone.position.copy(s.restPosition); s.bone.quaternion.copy(s.restQuaternion); s.bone.scale.copy(s.restScale); s.bone.updateMatrix();
    }
  }

  /** Call on clip switch, hide/resume, summon, resize or drag cancel. */
  reset() {
    this.initialized = false; this.primed = false;
    for (const s of this.states) {
      s.offset.set(0, 0, 0); s.velocity.set(0, 0, 0); s.acceleration.set(0, 0, 0); s.anchorVelocity.set(0, 0, 0);
    }
    this.restoreRest();
    this.scene.updateWorldMatrix(true, true);
  }

  /** rawDt in real seconds. screenOffset: world-space equivalent of the DOM canvas translation. */
  update(rawDt: number, settings: SwingSettings = DEFAULT_SWING, screenOffset?: Vector3) {
    if (!this.states.length) return;
    if (settings.enabled !== this.enabled) { this.reset(); this.enabled = settings.enabled; }
    if (!Number.isFinite(rawDt) || rawDt <= 0 || rawDt > LIMITS.maxFrame || (screenOffset && !screenOffset.toArray().every(Number.isFinite))) {
      this.reset(); return;
    }
    this.restoreRest();
    this.scene.updateWorldMatrix(true, true);
    let discontinuity = false;
    for (const s of this.states) {
      const parent = s.bone.parent!;
      parent.getWorldScale(s.parentScale); parent.getWorldQuaternion(s.parentQuaternion);
      const axes = s.parentScale.toArray().map(Math.abs);
      s.scale = Math.max(...axes);
      const determinant = s.bone.matrixWorld.determinant();
      if (!s.bone.matrixWorld.elements.every(Number.isFinite) || determinant <= 0 || Math.min(...axes) < 1e-7 || s.scale / Math.min(...axes) > 10) {
        this.reset(); return;
      }
      s.inverseRestWorld.copy(s.bone.matrixWorld).invert();
      s.tip.set(0, s.spec.lengthMeters, 0).applyMatrix4(s.bone.matrixWorld);
      if (screenOffset) s.tip.add(screenOffset);
      if (this.initialized && (s.tip.distanceTo(s.previousTip) > LIMITS.teleport * s.scale
        || s.parentQuaternion.angleTo(s.previousParentQuaternion) > LIMITS.parentTurn
        || Math.abs(s.scale / s.previousScale - 1) > 0.05)) discontinuity = true;
    }
    if (discontinuity) this.reset();
    if (!settings.enabled || !this.initialized) {
      for (const s of this.states) { s.previousTip.copy(s.tip); s.previousParentQuaternion.copy(s.parentQuaternion); s.previousScale = s.scale; }
      this.initialized = true; return;
    }
    const steps = Math.ceil(rawDt / LIMITS.maxStep), h = rawDt / steps;
    for (const s of this.states) {
      this.speed.copy(s.tip).sub(s.previousTip).divideScalar(rawDt);
      this.force.copy(this.speed).sub(s.anchorVelocity).divideScalar(rawDt);
      if (!this.primed) this.force.set(0, 0, 0);
      s.acceleration.lerp(this.force, 1 - Math.exp(-rawDt / LIMITS.smoothing)).clampLength(0, LIMITS.acceleration * s.scale);
      const gain = Math.min(1.8, settings.strength * settings[s.spec.region]);
      const omega = 2 * Math.PI * s.spec.frequencyHz;
      const angleCap = s.spec.maxAngleDegrees * Math.PI / 180;
      const max = 2 * s.spec.lengthMeters * Math.sin(angleCap / 2) * s.scale;
      for (let i = 0; i < steps; i++) {
        this.delta.copy(s.offset).multiplyScalar(-omega * omega)
          .addScaledVector(s.velocity, -2 * s.spec.dampingRatio * omega).addScaledVector(s.acceleration, -gain);
        s.velocity.addScaledVector(this.delta, h).clampLength(0, max * LIMITS.velocityCap);
        s.offset.addScaledVector(s.velocity, h);
        if (s.offset.lengthSq() > max * max) {
          s.offset.setLength(max);
          const outward = s.velocity.dot(s.offset) / (max * max);
          if (outward > 0) s.velocity.addScaledVector(s.offset, -outward);
        }
      }
      if (gain === 0) { s.offset.set(0, 0, 0); s.velocity.set(0, 0, 0); }
      this.local.copy(s.tip).add(s.offset);
      if (screenOffset) this.local.sub(screenOffset);
      this.local.applyMatrix4(s.inverseRestWorld).normalize();
      this.swing.setFromUnitVectors(Y, this.local);
      if (IDENTITY.angleTo(this.swing) > angleCap) {
        this.local.set(this.swing.x, this.swing.y, this.swing.z).normalize();
        this.swing.setFromAxisAngle(this.local, angleCap);
      }
      if (gain > 0 && s.offset.lengthSq() > 1e-28) s.bone.quaternion.copy(s.restQuaternion).multiply(this.swing);
      s.bone.updateMatrix();
      s.previousTip.copy(s.tip); s.anchorVelocity.copy(this.speed);
      s.previousParentQuaternion.copy(s.parentQuaternion); s.previousScale = s.scale;
    }
    this.primed = true;
    this.scene.updateWorldMatrix(false, true);
  }

  /** Largest live swing, degrees (diagnostics/tests). */
  maxAngleDegrees() {
    return Math.max(0, ...this.states.map((s) => s.bone.quaternion.angleTo(s.restQuaternion) * 180 / Math.PI));
  }

  dispose() { this.reset(); }
}

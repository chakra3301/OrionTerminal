import * as THREE from "three";
import { resolveClips } from "./catalog";
import type { CompanionRoles } from "./companionRig";

const MIXAMO_FIDGETS = /^(sad idle|happy|bashful|thankful|cheering|silly dancing|joyful jump|female dynamic pose)$/i;

export class CompanionAnimator {
  readonly mixer: THREE.AnimationMixer;
  readonly names: string[];
  readonly idleName: string | null;
  readonly greeting: string | null;
  readonly error: string | null;
  readonly gesture: string | null;
  private clips: Map<string, THREE.AnimationClip>;
  private alias: Readonly<Record<string, string>>;
  private idle: THREE.AnimationAction | null;
  private active: THREE.AnimationAction | null = null;
  private pending: string[] = [];
  private time = 0;
  private endAt = 0;
  private fadeEnd = 0;
  private nextFidget = 75;
  private priority = false;
  private testName: string | null = null;
  private lastFidget = "";
  private fidgets: string[];
  /** Fires when a one-shot clip starts or ends (spring solvers reset on discontinuities). */
  onSwitch: (() => void) | null = null;

  constructor(scene: THREE.Object3D, animations: THREE.AnimationClip[], private random = Math.random, roles?: CompanionRoles) {
    this.mixer = new THREE.AnimationMixer(scene);
    this.clips = new Map(animations.map((clip) => [clip.name, clip]));
    this.names = animations.map((clip) => clip.name);
    this.alias = roles?.alias ?? {};
    if (roles) {
      this.idleName = this.clips.has(roles.idle) ? roles.idle : this.names[0] ?? null;
      this.greeting = this.clips.has(roles.greeting) ? roles.greeting : null;
      this.error = this.clips.has(roles.error) ? roles.error : null;
      this.gesture = this.clips.has(roles.gesture) ? roles.gesture : this.greeting;
      this.fidgets = roles.fidgets.filter((name) => this.clips.has(name));
    } else {
      const resolved = resolveClips(this.names);
      this.idleName = resolved.idle;
      this.greeting = resolved.select === resolved.idle ? null : resolved.select;
      this.error = this.names.find((name) => /angry|rejected|error/i.test(name)) ?? null;
      this.gesture = this.names.find((name) => /^talking$/i.test(name)) ?? this.greeting;
      this.fidgets = this.names.filter((name) => name !== this.idleName && MIXAMO_FIDGETS.test(name));
    }
    if (!this.fidgets.length && this.greeting) this.fidgets = [this.greeting];
    const idleClip = this.idleName ? this.clips.get(this.idleName) : undefined;
    this.idle = idleClip ? this.mixer.clipAction(idleClip) : null;
    this.restoreIdle(0);
  }

  /** Accepts this companion's own clip names or the shared reaction names. */
  queue(name: string | null) {
    const clip = name ? this.alias[name] ?? name : null;
    if (clip && clip !== this.idleName && this.clips.has(clip) && this.pending.length < 4 && this.pending.at(-1) !== clip) this.pending.push(clip);
  }

  private restoreIdle(fade: number) {
    this.idle?.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(fade).play();
  }

  private playOnce(name: string, priority: boolean) {
    const clip = this.clips.get(name);
    if (!clip) return;
    this.active = this.mixer.clipAction(clip);
    this.active.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(1).fadeIn(0.3).play();
    this.active.clampWhenFinished = true;
    this.idle?.fadeOut(0.3);
    this.endAt = this.time + clip.duration;
    this.fadeEnd = 0;
    this.priority = priority;
  }

  update(delta: number, idleMode: boolean, testClip: string | null = null) {
    this.time += delta;
    if (testClip && this.clips.has(testClip)) {
      if (testClip !== this.testName) {
        this.mixer.stopAllAction();
        this.active = null;
        this.fadeEnd = 0;
        const action = this.mixer.clipAction(this.clips.get(testClip)!);
        action.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
        action.clampWhenFinished = false;
        this.testName = testClip;
        this.onSwitch?.();
      }
    } else {
      if (this.testName) {
        this.mixer.stopAllAction();
        this.active = null;
        this.testName = null;
        this.pending = [];
        this.restoreIdle(0.3);
        this.nextFidget = this.time + 75;
        this.onSwitch?.();
      }
      if (this.active && !this.fadeEnd && (this.time >= this.endAt || (this.pending.length && !this.priority) || (!idleMode && !this.priority))) {
        this.active.fadeOut(0.4);
        this.restoreIdle(0.4);
        this.fadeEnd = this.time + 0.4;
      }
      if (this.active && this.fadeEnd && this.time >= this.fadeEnd) {
        this.active.stop();
        this.active = null;
        this.fadeEnd = 0;
        this.nextFidget = this.time + 120 + this.random() * 180;
      }
      if (!this.active && this.pending.length) {
        this.playOnce(this.pending.shift()!, true);
      } else if (!this.active && idleMode && this.time >= this.nextFidget && this.fidgets.length) {
        const pool = this.fidgets.filter((name) => name !== this.lastFidget);
        const choices = pool.length ? pool : this.fidgets;
        const name = choices[Math.floor(this.random() * choices.length)];
        if (name) {
          this.lastFidget = name;
          this.playOnce(name, false);
        }
      }
    }
    this.mixer.update(delta);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}

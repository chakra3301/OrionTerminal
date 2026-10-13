import * as THREE from "three";
import { resolveClips } from "./catalog";

export class CompanionAnimator {
  readonly mixer: THREE.AnimationMixer;
  readonly names: string[];
  readonly idleName: string | null;
  readonly greeting: string | null;
  readonly error: string | null;
  readonly gesture: string | null;
  private clips: Map<string, THREE.AnimationClip>;
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

  constructor(scene: THREE.Object3D, animations: THREE.AnimationClip[], private random = Math.random) {
    this.mixer = new THREE.AnimationMixer(scene);
    this.clips = new Map(animations.map((clip) => [clip.name, clip]));
    this.names = animations.map((clip) => clip.name);
    const resolved = resolveClips(this.names);
    this.idleName = resolved.idle;
    this.greeting = resolved.select === resolved.idle ? null : resolved.select;
    this.error = this.names.find((name) => /angry|rejected|error/i.test(name)) ?? null;
    this.gesture = this.names.find((name) => /^talking$/i.test(name)) ?? this.greeting;
    this.fidgets = this.names.filter((name) => name !== this.idleName && /^(sad idle|happy|bashful|thankful|cheering|silly dancing|joyful jump|female dynamic pose)$/i.test(name));
    if (!this.fidgets.length && this.greeting) this.fidgets = [this.greeting];
    const idleClip = this.idleName ? this.clips.get(this.idleName) : undefined;
    this.idle = idleClip ? this.mixer.clipAction(idleClip) : null;
    this.restoreIdle(0);
  }

  queue(name: string | null) {
    if (name && name !== this.idleName && this.clips.has(name) && this.pending.length < 4) this.pending.push(name);
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
      }
    } else {
      if (this.testName) {
        this.mixer.stopAllAction();
        this.active = null;
        this.testName = null;
        this.pending = [];
        this.restoreIdle(0.3);
        this.nextFidget = this.time + 75;
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

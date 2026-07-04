/**
 * Timeline evaluation — keyframed numeric params, resolved CPU-side into
 * the same override map bindings use. Keys live in normalized 0..1 time
 * across the scene's loop duration.
 */

import type { FxKeyframe, FxScene } from "./fxModel";
import type { FxOverrides } from "./fxBindings";
import { fxEffect } from "./fxRegistry";

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function ease(kind: FxKeyframe["ease"], t: number): number {
  if (kind === "hold") return 0;
  if (kind === "inOut") return t * t * (3 - 2 * t);
  return t;
}

/** Evaluate a sorted keyframe list at normalized time t01. Before the first
 * key → first value; after the last → last value (loop wrap is the scene
 * clock's job — put keys at 0 and 1 for seamless loops). */
export function evalKeyframes(kfs: FxKeyframe[], t01: number): number | undefined {
  if (kfs.length === 0) return undefined;
  const t = clamp01(t01);
  const first = kfs[0]!;
  if (t <= first.t) return first.v;
  const last = kfs[kfs.length - 1]!;
  if (t >= last.t) return last.v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!;
    const b = kfs[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const f = span > 0 ? ease(b.ease ?? "inOut", (t - a.t) / span) : 1;
      return a.v + (b.v - a.v) * f;
    }
  }
  return last.v;
}

/** All keyframed params of a scene at time `timeSec` (loops over duration). */
export function evalSceneKeyframes(scene: FxScene, timeSec: number): FxOverrides {
  const out: FxOverrides = new Map();
  const dur = Math.max(0.1, scene.duration);
  const t01 = ((timeSec % dur) + dur) % dur / dur;
  for (const layer of scene.layers) {
    if (!layer.keyframes || layer.hidden) continue;
    const spec = fxEffect(layer.effectId);
    if (!spec) continue;
    let rec: Record<string, number> | null = null;
    for (const [key, kfs] of Object.entries(layer.keyframes)) {
      const p = spec.params.find((q) => q.key === key);
      if (!p || p.type !== "number") continue;
      const v = evalKeyframes(kfs, t01);
      if (v === undefined) continue;
      (rec ??= {})[key] = Math.min(p.max, Math.max(p.min, v));
    }
    if (rec) out.set(layer.id, rec);
  }
  return out;
}

/** Insert-or-replace a key at t (replaces keys within ±1% of t), keeping
 * the list sorted. Pure — returns a new array. */
export function upsertKeyframe(
  kfs: FxKeyframe[] | undefined,
  key: FxKeyframe,
): FxKeyframe[] {
  const next = (kfs ?? []).filter((k) => Math.abs(k.t - key.t) > 0.01);
  next.push({ ...key, t: clamp01(key.t) });
  next.sort((a, b) => a.t - b.t);
  return next;
}

/**
 * Interactivity bindings — Unicorn's soul. Any numeric param of any layer
 * can respond to an input source; the bound offset is resolved CPU-side
 * each frame and passed to the compositor as per-layer uniform overrides,
 * so the stored base value never mutates.
 */

import type { FxBinding, FxScene } from "./fxModel";
import { fxEffect } from "./fxRegistry";

/** All input sources, normalized to 0..1. */
export type FxInputs = {
  mouseX: number;
  mouseY: number;
  /** Pointer speed, 0 = still, 1 = fast sweep. */
  mouseSpeed: number;
  /** 1 while the pointer is over the canvas. */
  hover: number;
  /** Eased 0→1 ramp after the scene (re)starts. */
  appear: number;
  /** Live microphone loudness 0..1 (0 when mic off). */
  audio: number;
};

export type FxOverrides = Map<string, Record<string, number>>;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Stateful per-binding smoothing + resolution. One instance per viewport;
 * `tick` returns only the params that are actually overridden. */
export class FxBindingRuntime {
  private smoothed = new Map<string, number>();

  reset(): void {
    this.smoothed.clear();
  }

  /** `base` (e.g. timeline output) is merged in: it seeds the returned map
   * and bound params offset from it instead of the stored value. */
  tick(
    scene: FxScene,
    inputs: FxInputs,
    dt: number,
    base?: FxOverrides,
  ): FxOverrides {
    const out: FxOverrides = new Map();
    if (base) {
      for (const [id, rec] of base) out.set(id, { ...rec });
    }
    for (const layer of scene.layers) {
      if (!layer.bindings || layer.hidden) continue;
      const spec = fxEffect(layer.effectId);
      if (!spec) continue;
      let rec = out.get(layer.id) ?? null;
      for (const [key, b] of Object.entries(layer.bindings)) {
        const p = spec.params.find((q) => q.key === key);
        if (!p || p.type !== "number") continue;
        const raw = inputs[b.source] ?? 0;
        const sid = `${layer.id}:${key}`;
        const prev = this.smoothed.get(sid) ?? raw;
        // smooth 0 → near-instant (k≈30/s), smooth 1 → lazy drift (k≈3/s).
        const k = 1 - Math.exp(-dt * (30 - clamp(b.smooth ?? 0.3, 0, 1) * 27));
        const s = prev + (raw - prev) * k;
        this.smoothed.set(sid, s);
        const stored = rec?.[key] ?? layer.params[key];
        const baseV = typeof stored === "number" ? stored : p.default;
        const v = clamp(baseV + b.amount * (p.max - p.min) * s, p.min, p.max);
        (rec ??= {})[key] = v;
      }
      if (rec) out.set(layer.id, rec);
    }
    return out;
  }
}

export function easeOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - Math.pow(1 - c, 3);
}

export const FX_BIND_LABELS: Record<FxBinding["source"], string> = {
  mouseX: "Mouse X",
  mouseY: "Mouse Y",
  mouseSpeed: "Mouse speed",
  hover: "Hover",
  appear: "Appear",
  audio: "Audio (mic)",
};

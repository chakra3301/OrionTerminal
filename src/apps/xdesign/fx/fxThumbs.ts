/**
 * Live-rendered effect thumbnails for the effect browser — every card shows
 * the actual shader, not a stock image. One shared offscreen compositor
 * renders a small demo scene per effect; results are cached as data URLs
 * for the session (the registry is static, so once is enough).
 */

import { emptyScene, defaultParams, type FxLayer, type FxScene, type FxEffectSpec } from "./fxModel";
import { FX_EFFECTS, fxEffect } from "./fxRegistry";
import { createCompositor } from "./compositor";
import { rasterizeSource } from "./fxRaster";

export const THUMB_W = 432; // 2x for retina cards
export const THUMB_H = 280;

function demoLayer(spec: FxEffectSpec, id: string): FxLayer {
  return {
    id,
    effectId: spec.id,
    name: spec.label,
    opacity: 1,
    params: defaultParams(spec),
  };
}

/** A tiny scene that shows the effect off well: generators render alone
 * over deep space; effects and sources sit on a demo gradient so there's
 * something to transform. Exported for tests. */
export function demoSceneFor(spec: FxEffectSpec): FxScene {
  const scene = emptyScene();
  scene.width = THUMB_W;
  scene.height = THUMB_H;
  scene.background = "#06070d";

  const needsBase = spec.category !== "generator";
  if (needsBase && spec.id !== "srcText") {
    const grad = fxEffect("gradient")!;
    const base = demoLayer(grad, "demo-base");
    base.params.colorA = "#131a3a";
    base.params.colorB = "#00b3cc";
    base.params.warp = 0.5;
    scene.layers.push(base);
  }
  const layer = demoLayer(spec, "demo-fx");
  // Per-effect demo tweaks so small cards read instantly.
  if (spec.id === "srcText") {
    layer.params.content = "Aa";
    layer.params.size = 0.42;
  }
  if (spec.id === "srcShape") layer.params.width = 0.34;
  if (spec.id === "ascii") layer.params.cells = 48;
  if (spec.id === "pixelate") layer.params.cells = 24;
  if (spec.id === "blur") layer.params.radius = 0.6;
  if (spec.id === "ripple") layer.params.amplitude = 0.8;
  scene.layers.push(layer);
  return scene;
}

/** Render arbitrary scenes to thumbnail data URLs on one shared GL context
 * (per-card canvases would exhaust WebGL contexts past ~16 cards). */
async function renderThumbs(
  entries: { id: string; scene: FxScene }[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const canvas = document.createElement("canvas");
  const comp = createCompositor(canvas, { preserveDrawingBuffer: true });
  if (!comp) return out;
  try {
    for (const { id, scene } of entries) {
      const srcIds: string[] = [];
      for (const l of scene.layers) {
        if (!fxEffect(l.effectId)?.source) continue;
        const cnv = await rasterizeSource(l, THUMB_W, THUMB_H);
        if (cnv) {
          comp.updateSource(l.id, cnv);
          srcIds.push(l.id);
        }
      }
      // A time with visible motion phase + a mouse offset so
      // mouse-reactive effects (metaballs, distortion) don't look dead.
      comp.render(scene, { time: 2.3, mouse: [0.62, 0.58] }, THUMB_W, THUMB_H);
      out[id] = canvas.toDataURL("image/png");
      for (const sid of srcIds) comp.dropSource(sid);
    }
  } finally {
    comp.dispose();
  }
  return out;
}

let cache: Record<string, string> | null = null;
let pending: Promise<Record<string, string>> | null = null;

/** Render (or return cached) thumbnails for every registry effect. */
export function getEffectThumbs(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = renderThumbs(
    FX_EFFECTS.map((spec) => ({ id: spec.id, scene: demoSceneFor(spec) })),
  ).then((out) => {
    cache = out;
    return out;
  });
  return pending;
}

let presetCache: Record<string, string> | null = null;
let presetPending: Promise<Record<string, string>> | null = null;

/** Render (or return cached) thumbnails for preset scenes. */
export function getPresetThumbs(
  presets: { id: string; scene: FxScene }[],
): Promise<Record<string, string>> {
  if (presetCache) return Promise.resolve(presetCache);
  if (presetPending) return presetPending;
  presetPending = renderThumbs(presets).then((out) => {
    presetCache = out;
    return out;
  });
  return presetPending;
}

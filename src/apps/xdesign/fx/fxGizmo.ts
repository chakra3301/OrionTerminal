/**
 * Pure geometry for the on-canvas transform gizmo — the selected source
 * layer's bounding box in unit space (0..1), matching exactly how fxRaster /
 * fxVideo place each source. Split out from the component so it's testable.
 */

import { getSourceAspect } from "./fxSourceInfo";
import type { FxLayer } from "./fxModel";

export type GizmoBox = { x: number; y: number; w: number; h: number; rot: number };

export const GIZMO_FONTS = ["Space Grotesk", "JetBrains Mono", "system-ui"] as const;

const measureCanvas =
  typeof document !== "undefined" ? document.createElement("canvas") : null;

function num(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

/** Contain-fit box half-extents for an image/video of aspect `a` in a scene
 * of aspect `sceneAspect`, at user `scale`. Mirrors the fit math in
 * fxRaster's image branch. Exported for tests. */
export function containBox(a: number, sceneAspect: number, scale: number): { w: number; h: number } {
  const R = a / sceneAspect;
  return { w: scale * Math.min(1, R), h: scale * Math.min(1, 1 / R) };
}

export function unitBox(layer: FxLayer, sceneW: number, sceneH: number): GizmoBox | null {
  const p = layer.params;
  const x = num(p.x, 0.5);
  const y = num(p.y, 0.5);
  const rot = num(p.rotation, 0);
  const sceneAspect = sceneW / sceneH;

  if (layer.effectId === "srcShape") {
    return { x, y, w: num(p.width, 0.4), h: num(p.height, 0.4), rot };
  }
  if (layer.effectId === "srcImage" || layer.effectId === "srcVideo") {
    const scale = num(p.scale, 1);
    const a = getSourceAspect(layer.id);
    if (!a) return { x, y, w: scale, h: scale, rot };
    const { w, h } = containBox(a, sceneAspect, scale);
    return { x, y, w, h, rot };
  }
  if (layer.effectId === "srcText") {
    const content = String(p.content ?? "");
    const size = num(p.size, 0.14);
    const weight = num(p.weight, 600);
    const font = GIZMO_FONTS[Math.round(num(p.font, 0))] ?? GIZMO_FONTS[0];
    const lines = content.split(/\n|\\n/);
    const px = size * sceneH;
    let maxW = px;
    const ctx = measureCanvas?.getContext("2d");
    if (ctx) {
      ctx.font = `${weight} ${px}px "${font}", sans-serif`;
      for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln || " ").width);
    }
    return {
      x,
      y,
      w: Math.max(maxW / sceneW, 0.02),
      h: Math.max((lines.length * px * 1.2) / sceneH, 0.02),
      rot,
    };
  }
  return null;
}

/**
 * Spec material → `THREE.MeshPhysicalMaterial`. Port of the material rules
 * in `grimoire/feedback/shading_realism.md` and
 * `grimoire/build/threejs_texture_reference.md`: independent PBR channels
 * (never bake albedo into roughness/normal/AO — separate CanvasTexture maps
 * per channel), real `MeshPhysicalMaterial` scalars (clearcoat/anisotropy/
 * transmission/ior), and `localOverrides` painted onto per-channel masks
 * instead of hand-authored texture files.
 */

import * as THREE from "three";
import type { SculptMaterial } from "./sculptSpec";

const MAP_SIZE = 512;

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

/** Paint `localOverrides` onto a scalar channel (roughness/emissive/etc)
 * canvas so each channel stays an independent texture — the anti-aliasing
 * rule upstream calls out repeatedly (never alias one channel's data into
 * another). Regions are normalized 0..1 rects. */
function buildScalarMap(
  base: number, overrides: Array<{ region: { x: number; y: number; w: number; h: number }; value: number }>,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_SIZE; canvas.height = MAP_SIZE;
  const ctx = canvas.getContext("2d")!;
  const g = Math.round(base * 255);
  ctx.fillStyle = `rgb(${g},${g},${g})`;
  ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  for (const o of overrides) {
    const gv = Math.round(Math.max(0, Math.min(1, o.value)) * 255);
    ctx.fillStyle = `rgba(${gv},${gv},${gv},0.9)`;
    const grad = ctx.createRadialGradient(
      (o.region.x + o.region.w / 2) * MAP_SIZE, (o.region.y + o.region.h / 2) * MAP_SIZE, 0,
      (o.region.x + o.region.w / 2) * MAP_SIZE, (o.region.y + o.region.h / 2) * MAP_SIZE, Math.max(o.region.w, o.region.h) * MAP_SIZE * 0.6,
    );
    grad.addColorStop(0, `rgba(${gv},${gv},${gv},0.95)`);
    grad.addColorStop(1, `rgba(${gv},${gv},${gv},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(o.region.x * MAP_SIZE, o.region.y * MAP_SIZE, o.region.w * MAP_SIZE, o.region.h * MAP_SIZE);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Dirt/stain/color-shift overrides painted directly onto the albedo map —
 * these ARE color changes, unlike roughness/emissive which stay scalar. */
function buildAlbedoMap(baseColor: string, overrides: SculptMaterial["localOverrides"]): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_SIZE; canvas.height = MAP_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  for (const o of overrides) {
    if (o.kind === "stain" && (o.dirtAmount || o.colorShift)) {
      const color = o.colorShift ?? "#3a3226";
      const alpha = Math.max(0, Math.min(1, o.dirtAmount ?? 0.4));
      paintRegion(ctx, o.region, color, alpha, o.cavityBias);
    } else if (o.kind === "scratch" || o.kind === "chip") {
      paintRegion(ctx, o.region, "#d8d8d8", 0.25, false);
    } else if (o.kind === "decal" && o.colorShift) {
      paintRegion(ctx, o.region, o.colorShift, 0.9, false);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintRegion(
  ctx: CanvasRenderingContext2D, region: { x: number; y: number; w: number; h: number },
  color: string, alpha: number, cavityBias?: boolean,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  if (cavityBias) {
    const grad = ctx.createRadialGradient(
      (region.x + region.w / 2) * MAP_SIZE, (region.y + region.h / 2) * MAP_SIZE, 0,
      (region.x + region.w / 2) * MAP_SIZE, (region.y + region.h / 2) * MAP_SIZE, Math.max(region.w, region.h) * MAP_SIZE * 0.7,
    );
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
  }
  ctx.fillRect(region.x * MAP_SIZE, region.y * MAP_SIZE, region.w * MAP_SIZE, region.h * MAP_SIZE);
  ctx.restore();
}

export function buildMaterial(spec: SculptMaterial): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: spec.projectedTexture ? "#ffffff" : spec.baseColor,
    roughness: spec.roughness.base,
    metalness: spec.metalness,
    opacity: spec.opacity.base,
    transparent: spec.opacity.base < 1,
    clearcoat: spec.clearcoat ?? 0,
    clearcoatRoughness: spec.clearcoatRoughness ?? 0,
    transmission: spec.transmission ?? 0,
    ior: spec.ior ?? 1.5,
    anisotropy: spec.anisotropy ?? 0,
    envMapIntensity: spec.envMapIntensity ?? 1,
  });
  if (spec.emissive) {
    mat.emissive = new THREE.Color(spec.emissive);
    mat.emissiveIntensity = spec.emissiveIntensity ?? 1;
  }

  if (spec.projectedTexture) {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(spec.projectedTexture.dataUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat.map = tex;
  } else if (spec.localOverrides.length > 0) {
    mat.map = buildAlbedoMap(spec.baseColor, spec.localOverrides);
  }

  const roughnessOverrides = spec.localOverrides
    .filter((o) => o.roughnessDelta !== undefined)
    .map((o) => ({ region: o.region, value: spec.roughness.base + (o.roughnessDelta ?? 0) }));
  if (roughnessOverrides.length > 0) {
    mat.roughnessMap = buildScalarMap(spec.roughness.base, roughnessOverrides);
  }

  const emissiveOverrides = spec.localOverrides.filter((o) => o.kind === "emissive" && o.emissive);
  if (emissiveOverrides.length > 0) {
    const canvas = document.createElement("canvas");
    canvas.width = MAP_SIZE; canvas.height = MAP_SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    for (const o of emissiveOverrides) paintRegion(ctx, o.region, o.emissive!, 1, false);
    const tex = new THREE.CanvasTexture(canvas);
    mat.emissiveMap = tex;
    mat.emissive = new THREE.Color("#ffffff");
    mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 1);
  }

  mat.userData.sculptMaterial = spec;
  mat.userData.proceduralMapsIndependent = true;
  mat.userData.pbrTextureSource = spec.referencePbr ? "reference-evidence" : spec.projectedTexture ? "reference-projection" : "flat-fallback";
  mat.userData.referencePbr = spec.referencePbr ?? null;
  return mat;
}

export { hexToRgb };

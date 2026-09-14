/**
 * Port of img2threejs `grimoire/intake/detail_inventory.md` +
 * `forge/stage1_intake/build_detail_inventory.py`. Zone-scan taxonomy for
 * identity-defining small details, and the `mapsTo` completeness gate: a
 * detail described only in prose never reaches the render, so every entry
 * must resolve to a real `component.localFeatures[]` or
 * `material.localOverrides[]` id.
 */

import type { ComplexityTier, DetailEntry, DetailKind, ObjectSculptSpec } from "./sculptSpec";
import { targetMinDetailsFor } from "./sculptSpec";

export const DETAIL_KINDS: DetailKind[] = [
  "gloss", "bevel", "fastener", "linework", "contour", "seam", "stitch",
  "stain", "scratch", "chip", "decal", "emissive", "hole", "groove", "ridge",
];

/** Short graphics-term recipe per kind, surfaced to the agent so it knows
 * which field to fill instead of writing prose. */
export const DETAIL_RECIPES: Record<DetailKind, string> = {
  gloss: "localized low-roughness zone or clearcoat hotspot — material.localOverrides",
  bevel: "real chamfer geometry, not a normal-map trick — component.geometryDescriptor.edgeTreatment",
  fastener: "repeated small parts as an InstancedMesh system — component.localFeatures.instancing",
  linework: "engraved groove (geometry) OR painted decal (material) OR AO panel-line (material) — pick the one the evidence supports",
  contour: "rim-light or inverted-hull outline pass — material.localOverrides",
  seam: "thin recessed groove or raised ridge + AO darkening in the crevice",
  stitch: "small repeated bumps or dashed groove along a curve, finer spacing than a fastener row",
  stain: "material.localOverrides region: dirtAmount, cavityBias, streak direction, patina color, faded mask",
  scratch: "thin localized roughness/normal perturbation with orientation",
  chip: "geometry notch if it changes silhouette, else a localOverride exposing an underlayer color",
  decal: "flat canvas-texture region; add a thin raised localFeature only if it has physical thickness",
  emissive: "material.localOverrides: emissive color + intensity, note if it should light nearby surfaces",
  hole: "real cut/socket geometry, not a dark texture patch — component.localFeatures geometryEffect: hole",
  groove: "negative relief along a path + AO darkening in the channel",
  ridge: "positive relief along a path, catches highlight along its crest",
};

export function scaffoldDetailInventory(
  tier: ComplexityTier,
  scanMethod: "component-zones" | "grid-3x3" | "grid-4x4" = "grid-3x3",
): { scanMethod: typeof scanMethod; targetMinDetails: number; details: DetailEntry[] } {
  return { scanMethod, targetMinDetails: targetMinDetailsFor(tier), details: [] };
}

/** 3x3 or 4x4 normalized zone rects to hand the agent one at a time so it
 * scans methodically instead of eyeballing the whole image once. */
export function scanZones(mode: "grid-3x3" | "grid-4x4"): Array<{ id: string; x: number; y: number; w: number; h: number }> {
  const n = mode === "grid-4x4" ? 4 : 3;
  const zones: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      zones.push({ id: `zone-${row}-${col}`, x: col / n, y: row / n, w: 1 / n, h: 1 / n });
    }
  }
  return zones;
}

export type DetailInventoryReport = {
  ok: boolean;
  count: number;
  targetMinDetails: number;
  unmapped: string[]; // detail ids with mapsTo === null or a dangling reference
  lowConfidence: string[]; // detail ids below 0.35 confidence, not counted toward the floor
};

/** Validate against the strict-quality gate rule: count only mapped,
 * non-trivially-confident details toward `targetMinDetails`, and flag every
 * entry whose `mapsTo` doesn't resolve to a real field. */
export function checkDetailInventory(spec: ObjectSculptSpec): DetailInventoryReport {
  const inv = spec.preSpecAssessment.detailInventory;
  const localFeatureIds = new Set(spec.components.flatMap((c) => c.localFeatures.map((f) => f.id)));
  const overrideIds = new Set(spec.materials.flatMap((m) => m.localOverrides.map((o) => o.id)));

  const unmapped: string[] = [];
  const lowConfidence: string[] = [];
  let validCount = 0;

  for (const d of inv.details) {
    const resolved = d.mapsTo !== null && (localFeatureIds.has(d.mapsTo) || overrideIds.has(d.mapsTo));
    if (!resolved) {
      unmapped.push(d.id);
      continue;
    }
    if (d.confidence < 0.35) {
      lowConfidence.push(d.id);
      continue;
    }
    validCount += 1;
  }

  return {
    ok: unmapped.length === 0 && validCount >= inv.targetMinDetails,
    count: validCount,
    targetMinDetails: inv.targetMinDetails,
    unmapped,
    lowConfidence,
  };
}

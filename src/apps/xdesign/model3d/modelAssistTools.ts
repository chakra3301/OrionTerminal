/**
 * Tool schema + executor for the img2model agent loop (`modelAssist.ts`) —
 * the "scripts enforce, model judges" boundary from img2threejs. Every tool
 * here either (a) authors/patches the `ObjectSculptSpec` — pure data, no
 * judgment — or (b) runs a deterministic gate/render and hands the result
 * back, including real pixels for the vision-judging tools. The model can
 * propose anything; `model_validate` / `model_request_render` /
 * `model_submit_review` are where the pure TS gates in this directory
 * actually decide what's allowed to proceed.
 */

import { ulid } from "ulid";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";
import type {
  Attachment, ComplexityTier, DetailEntry, ObjectSculptSpec, RepetitionSystem, SculptComponent, SculptMaterial,
} from "./sculptSpec";
import { minimumSpecDepthFor, makeQualityContract, targetMinDetailsFor } from "./sculptSpec";
import { useModelStore } from "./modelStore";
import { validateSculptSpec } from "./validateSculptSpec";
import { checkDetailInventory, scanZones } from "./detailInventory";
import { currentPass, checkPass, statusPayload } from "./passOrchestrator";
import { evaluateDivineEye } from "./divineEye";
import { fromImageData } from "./imageMetrics";
import { diagnoseMultiAngle } from "./multiAngle";
import { appendReview } from "./reviewHistory";
import { makeComparisonSheet } from "./comparisonSheet";
import { delightAlbedo } from "./delight";
import { extractPbrEvidence } from "./pbrEvidence";
import { bakeProjectedTexture } from "./projectionBake";
import { solveCameraPose } from "./cameraPose";
import { getModelRenderBridge } from "./modelRenderBridge";
import { useModelFeed } from "./modelTranscriptFeed";
import * as THREE from "three";

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });

/** Anthropic tool-use schema for reference/parity-checking only — the LIVE
 * schemas Claude actually sees are the `orion_model_*` MCP tool defs in
 * `src-tauri/src/mcp_server.rs::tool_definitions()` (subscription CLI path,
 * no API key). Keep these two in sync by hand when a tool's shape changes. */
export const MODEL_TOOLS = [
  {
    name: "model_get_spec",
    description: "Read the full current spec: pass status, object class, complexity, quality contract, components, materials, repetition systems, feature targets, and detail inventory completeness. Call this first each turn you don't already know the state.",
    input_schema: obj({}),
  },
  {
    name: "model_set_object_class",
    description: "Set preSpecAssessment.objectClass from direct visual inspection. primaryDomain MUST be object|character|hybrid.",
    input_schema: obj({
      primaryType: { type: "string" }, primaryDomain: { type: "string", enum: ["object", "character", "hybrid"] },
      formLanguage: { type: "array", items: { type: "string" } }, structureKind: { type: "array", items: { type: "string" } },
      motionPotential: { type: "array", items: { type: "string" } }, materialFamilies: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
    }, ["primaryType", "primaryDomain"]),
  },
  {
    name: "model_set_complexity",
    description: "Set the complexity assessment. tier drives targetMinDetails and minimumSpecDepth (simple/moderate/complex/ultra-complex). Score each axis 0-3.",
    input_schema: obj({
      tier: { type: "string", enum: ["simple", "moderate", "complex", "ultra-complex"] },
      silhouetteComplexity: { type: "number" }, componentCount: { type: "number" }, hierarchyDepth: { type: "number" },
      repetitionDensity: { type: "number" }, materialLayerCount: { type: "number" }, localDetailDensity: { type: "number" },
      occlusionRisk: { type: "number" }, actionReadinessNeed: { type: "number" },
      macroComponents: { type: "number" }, mesoComponents: { type: "number" }, microFeatureGroups: { type: "number" },
      materialLayers: { type: "number" }, repetitionSystems: { type: "number" },
      reasoning: { type: "array", items: { type: "string" } },
    }, ["tier"]),
  },
  {
    name: "model_set_quality_contract",
    description: "Define what 'good enough' means for THIS object — definitionOfDone + antiShallowSpecRules. Replace the generic starter contract with specifics (e.g. 'leaf clusters must form irregular overlapping canopy masses' not 'make leaves look good').",
    input_schema: obj({
      definitionOfDone: { type: "array", items: { type: "string" } },
      antiShallowSpecRules: { type: "array", items: { type: "string" } },
      visualDeltaChecks: { type: "array", items: { type: "string" } },
    }),
  },
  {
    name: "model_scan_zones",
    description: "Get the normalized zone rects (grid-3x3 or grid-4x4) to scan systematically for the detail inventory, instead of eyeballing the whole image once.",
    input_schema: obj({ mode: { type: "string", enum: ["grid-3x3", "grid-4x4"] } }, ["mode"]),
  },
  {
    name: "model_add_detail",
    description: "Record one identity-defining detail found while scanning a zone (gloss/bevel/fastener/linework/contour/seam/stitch/stain/scratch/chip/decal/emissive/hole/groove/ridge). It MUST set mapsTo to a real component.localFeatures id or material.localOverrides id you already created (or will create in the same turn) — a detail without mapsTo never reaches the render.",
    input_schema: obj({
      kind: { type: "string" }, region: obj({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, ["x", "y", "w", "h"]),
      affects: { type: "string", enum: ["geometry", "material"] }, scale: { type: "number" }, evidenceRef: { type: "string" },
      confidence: { type: "number" }, mapsTo: { type: ["string", "null"] }, notes: { type: "string" },
    }, ["kind", "region", "affects", "evidenceRef", "confidence"]),
  },
  {
    name: "model_add_material",
    description: "Add a SculptMaterial. Use MeshPhysicalMaterial scalars (roughness/metalness/clearcoat/transmission/ior/anisotropy). Returns the material id.",
    input_schema: obj({
      id: { type: "string" }, baseColor: { type: "string" }, roughnessBase: { type: "number" }, roughnessVariation: { type: "number" },
      metalness: { type: "number" }, opacity: { type: "number" }, clearcoat: { type: "number" }, clearcoatRoughness: { type: "number" },
      transmission: { type: "number" }, ior: { type: "number" }, anisotropy: { type: "number" }, emissive: { type: "string" }, emissiveIntensity: { type: "number" },
    }, ["id", "baseColor"]),
  },
  {
    name: "model_add_material_override",
    description: "Add a localOverride region to an existing material — stains/scratches/gloss/emissive/decals. Returns the override id (use it as a detail's mapsTo).",
    input_schema: obj({
      materialId: { type: "string" }, kind: { type: "string" },
      region: obj({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, ["x", "y", "w", "h"]),
      roughnessDelta: { type: "number" }, clearcoat: { type: "number" }, colorShift: { type: "string" },
      dirtAmount: { type: "number" }, cavityBias: { type: "boolean" }, emissive: { type: "string" }, emissiveIntensity: { type: "number" },
    }, ["materialId", "kind", "region"]),
  },
  {
    name: "model_add_component",
    description: "Add a SculptComponent to the tree. level=macro for overall masses, meso for sub-assemblies, micro for tiny/repeated detail groups. Classify topologyClass BEFORE picking primitive (surface_topology discipline — a continuous organic form must not be forced into a box). Returns the component id.",
    input_schema: obj({
      name: { type: "string" }, level: { type: "string", enum: ["macro", "meso", "micro"] }, role: { type: "string" },
      importance: { type: "string", enum: ["critical", "important", "minor"] }, confidence: { type: "number" },
      primitive: { type: "string", enum: ["box", "sphere", "cylinder", "cone", "torus", "capsule", "tube", "extrude", "lathe", "plane", "group"] },
      topologyClass: { type: "string" }, topologyRationale: { type: "string" },
      parent: { type: ["string", "null"] }, materialId: { type: "string" },
      position: { type: "array", items: { type: "number" } }, rotation: { type: "array", items: { type: "number" } }, scale: { type: "array", items: { type: "number" } },
      width: { type: "number" }, height: { type: "number" }, depth: { type: "number" },
      bevelType: { type: "string", enum: ["none", "chamfer", "fillet"] }, bevelRadius: { type: "number" }, bevelSegments: { type: "number" },
      geometryParams: { type: "object", description: "Extra numeric knobs the primitive builder reads: radialSegments, profile (lathe [r,y,...]), outline (extrude [[x,y],...]), path (tube [[x,y,z],...])" },
      attachment: obj({
        parentSocket: { type: "string" }, localStart: { type: "array", items: { type: "number" } }, localEnd: { type: "array", items: { type: "number" } },
        baseRadius: { type: "number" }, endRadius: { type: "number" }, contactType: { type: "string", enum: ["embedded", "socket", "overlap", "hinge", "surface-contact", "glued"] },
        gapTolerance: { type: "number" }, evidenceRefs: { type: "array", items: { type: "string" } },
      }),
      evidenceRefs: { type: "array", items: { type: "string" } },
    }, ["name", "level", "role", "primitive", "topologyClass", "topologyRationale", "materialId", "position", "width", "height", "depth"]),
  },
  {
    name: "model_add_local_feature",
    description: "Add a localFeature to an existing component (groove/ridge/hole/chamfer geometry effect, or an instanced repetition like fasteners). Returns the feature id.",
    input_schema: obj({
      componentId: { type: "string" }, kind: { type: "string" },
      region: obj({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, ["x", "y", "w", "h"]),
      geometryEffectType: { type: "string", enum: ["groove", "ridge", "hole", "chamfer"] },
      path: { type: "array", items: { type: "array", items: { type: "number" } } }, width: { type: "number" }, depth: { type: "number" },
      instanceCount: { type: "number" }, instanceDistribution: { type: "string", enum: ["linear", "radial", "grid"] },
      confidence: { type: "number" }, evidenceRef: { type: "string" },
    }, ["componentId", "kind", "region", "confidence", "evidenceRef"]),
  },
  {
    name: "model_add_repetition_system",
    description: "Register a repeated-parts system (rivets/leaves/scales/needles) so the strict-quality gate credits it. Distribution + instance variance.",
    input_schema: obj({
      componentRef: { type: "string" }, count: { type: "number" }, distribution: { type: "string", enum: ["linear", "radial", "grid", "scatter"] },
      scaleVariance: { type: "number" }, rotationVariance: { type: "number" }, positionJitter: { type: "number" },
    }, ["componentRef", "count", "distribution"]),
  },
  {
    name: "model_set_feature_targets",
    description: "REPLACE the featureReviewTargets with the object's real identity-defining systems (≤5 critical, ≤3 important per pass). Never leave the generic starter targets — the strict-quality gate rejects generic names.",
    input_schema: obj({
      targets: {
        type: "array",
        items: obj({
          id: { type: "string" }, name: { type: "string" }, tier: { type: "string", enum: ["critical", "important"] },
          passIds: { type: "array", items: { type: "string" } }, minimumScore: { type: "number" }, evidenceRefs: { type: "array", items: { type: "string" } },
        }, ["id", "name", "tier", "passIds"]),
      },
    }, ["targets"]),
  },
  {
    name: "model_set_anatomy",
    description: "Fill the character anatomy block (required when primaryDomain is character/hybrid). Measure in head-units from the actual image, don't assume realistic proportions.",
    input_schema: obj({
      styleHeads: { type: "number" }, headUnit: { type: "number" }, torso: { type: "number" }, legs: { type: "number" },
      shoulderWidth: { type: "number" }, hipWidth: { type: "number" }, poseType: { type: "string" },
      eyeLine: { type: "number" }, eyeSpacing: { type: "number" }, noseBase: { type: "number" }, mouthLine: { type: "number" }, hairline: { type: "number" },
      confidence: { type: "number" },
    }, ["styleHeads", "confidence"]),
  },
  {
    name: "model_validate",
    description: "Run structural + strict-quality validation NOW. Call before requesting a render — a shallow spec should be fixed here, not discovered after a failed review. Returns { ok, errors, warnings }.",
    input_schema: obj({ strict: { type: "boolean" } }),
  },
  {
    name: "model_solve_camera",
    description: "Get a heuristic reference-camera guess (FOV/distance/position) for the reference image — a starting point, not a measurement.",
    input_schema: obj({}),
  },
  {
    name: "model_extract_pbr",
    description: "Extract reference-derived material evidence (palette, de-lit albedo, roughness estimate, confidence) from a normalized crop region of the reference image, and attach it to a material's referencePbr. Confidence < 0.7 is a request-input signal.",
    input_schema: obj({
      materialId: { type: "string" },
      region: obj({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, ["x", "y", "w", "h"]),
    }, ["materialId", "region"]),
  },
  {
    name: "model_project_texture",
    description: "The single biggest fidelity lever for a reference-matched surface: de-light a reference crop and project it onto a component's mesh UVs via the solved camera, instead of a procedural material approximation. Returns projection coverage (low coverage = the mesh has geometry this one view can't see).",
    input_schema: obj({
      componentId: { type: "string" }, materialId: { type: "string" },
      region: obj({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, ["x", "y", "w", "h"]),
    }, ["componentId", "materialId", "region"]),
  },
  {
    name: "model_request_render",
    description: "Render the CURRENT unlocked pass, package a reference|render comparison sheet, and run the deterministic Divine Eye ensemble (silhouette IoU, scale, proportion, symmetry, pHash, SSIM, edges, objectness). Returns the comparison sheet AS AN IMAGE for you to inspect, plus the Divine Eye scores. This does not by itself accept or reject a pass — you still call model_submit_review with your own judgment.",
    input_schema: obj({ multiAngle: { type: "boolean", description: "Also capture 3 orbit angles and run the degenerate-view gate (recommended for non-planar forms during structural-pass/form-refinement)." } }),
  },
  {
    name: "model_submit_review",
    description: "Record your review decision for the current pass: continue | refine-spec | refine-code | request-input | stop. `continue` on a visual pass is HARD-BLOCKED if the last model_request_render's Divine Eye result had a hard-gate failure, or if any critical feature you score is below its threshold — the tool will downgrade the action and tell you why.",
    input_schema: obj({
      fidelity: { type: "number" }, action: { type: "string", enum: ["continue", "refine-spec", "refine-code", "request-input", "stop"] },
      summary: { type: "string" }, matched: { type: "array", items: { type: "string" } }, mismatches: { type: "array", items: { type: "string" } },
      specFixes: { type: "array", items: { type: "string" } }, codeFixes: { type: "array", items: { type: "string" } },
      featureScores: { type: "array", items: obj({ id: { type: "string" }, score: { type: "number" }, visible: { type: "boolean" } }, ["id", "score"]) },
      layerScores: obj({ silhouetteProportion: { type: "number" }, componentStructure: { type: "number" }, formDetail: { type: "number" }, materialSurface: { type: "number" }, lightingCamera: { type: "number" } }),
      aiVisionScore: { type: "number" }, aiVisionNotes: { type: "string" }, cameraView: { type: "string" },
    }, ["fidelity", "action", "summary", "aiVisionScore"]),
  },
] as const;

// ── executor ─────────────────────────────────────────────────────────────

type ToolResult = { text: string; images?: string[] };
const ok = (extra: Record<string, unknown> = {}): ToolResult => ({ text: JSON.stringify({ ok: true, ...extra }) });
const fail = (error: string): ToolResult => ({ text: JSON.stringify({ ok: false, error }) });

let lastDivineEye: ReturnType<typeof evaluateDivineEye> | null = null;

function s(): ObjectSculptSpec {
  return useModelStore.getState().spec;
}
function setSpec(next: ObjectSculptSpec): void {
  useModelStore.getState().setSpec(next);
}

/** Every pixel-analysis function in this module downsamples further anyway
 * (masks to ~96px, luma grids to ~48px, phash to 32px) — decoding a full
 * multi-megapixel photo before that downsampling is pure waste, and doing
 * it FRESH on every single tool call (a pipeline pass can trigger a dozen+
 * detail/material/render calls) is what made the pipeline feel slow. Cap
 * the working copy to this on decode, once, and cache the result. */
const ANALYSIS_MAX_DIM = 1024;

const referenceImageCache = new Map<string, ImageData>();

function decodeAndCap(url: string, maxDim: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** Cached, resolution-capped decode of the reference image — the one used
 * by every pixel-analysis tool (Divine Eye, PBR evidence, projection). Not
 * used for the human-visible comparison-sheet panel image, which still
 * wants the full-res source for `makeComparisonSheet`'s own `<img>` draw. */
async function referenceImageDataCapped(url: string): Promise<ImageData> {
  const cached = referenceImageCache.get(url);
  if (cached) return cached;
  referenceImageCache.clear(); // one reference active at a time — never let this grow unbounded
  const data = await decodeAndCap(url, ANALYSIS_MAX_DIM);
  referenceImageCache.set(url, data);
  return data;
}

function drawImageDataFromUrl(url: string): Promise<ImageData> {
  return referenceImageDataCapped(url);
}
function cropImageData(full: ImageData, region: { x: number; y: number; w: number; h: number }): { imageData: ImageData; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(region.w * full.width));
  canvas.height = Math.max(1, Math.round(region.h * full.height));
  const ctx = canvas.getContext("2d")!;
  const src = document.createElement("canvas");
  src.width = full.width; src.height = full.height;
  src.getContext("2d")!.putImageData(full, 0, 0);
  ctx.drawImage(src, region.x * full.width, region.y * full.height, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  return { imageData: ctx.getImageData(0, 0, canvas.width, canvas.height), canvas };
}

/** Runs a tool and records it into the shared transcript feed (tool chip,
 * plus a render thumbnail for `model_request_render`) — regardless of
 * caller. The CLI-driven path (EventBridge → here) has no other visibility
 * into individual tool calls, so this is the single place that records them. */
export async function executeModelTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const result = await executeModelToolInner(name, input);
  let okFlag = true;
  try { okFlag = (JSON.parse(result.text) as { ok?: boolean }).ok !== false; } catch { /* non-JSON text — treat as ok */ }
  useModelFeed.getState().push({ kind: "tool", label: toolLabel(name, input), ok: okFlag });
  if (name === "model_request_render" && result.images?.[0]) {
    useModelFeed.getState().push({ kind: "render", dataUrl: result.images[0] });
  }
  return result;
}

async function executeModelToolInner(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "model_get_spec": {
        const spec = s();
        const detail = checkDetailInventory(spec);
        return ok({
          name: spec.name, sourceImageSet: !!spec.sourceImage,
          objectClass: spec.preSpecAssessment.objectClass, complexity: spec.preSpecAssessment.complexity,
          qualityContract: { definitionOfDone: spec.qualityContract.definitionOfDone, minimumSpecDepth: spec.qualityContract.minimumSpecDepth },
          componentCount: spec.components.length,
          components: spec.components.map((c) => ({ id: c.id, name: c.name, level: c.level, parent: c.parent, primitive: c.primitive, material: c.material })),
          materials: spec.materials.map((m) => ({ id: m.id, baseColor: m.baseColor, hasOverrides: m.localOverrides.length > 0, hasReferencePbr: !!m.referencePbr, hasProjection: !!m.projectedTexture })),
          repetitionSystems: spec.repetitionSystems.length,
          detailInventory: { ...detail, count: detail.count, target: detail.targetMinDetails },
          featureReviewTargets: spec.featureReviewTargets,
          pipeline: statusPayload(spec),
          anatomy: spec.preSpecAssessment.anatomy,
        });
      }

      case "model_set_object_class": {
        const spec = s();
        spec.preSpecAssessment.objectClass = {
          primaryType: String(input.primaryType ?? ""), primaryDomain: input.primaryDomain as never,
          formLanguage: (input.formLanguage as string[]) ?? [], structureKind: (input.structureKind as string[]) ?? [],
          motionPotential: (input.motionPotential as string[]) ?? [], materialFamilies: (input.materialFamilies as string[]) ?? [],
          notes: String(input.notes ?? ""),
        };
        setSpec({ ...spec });
        return ok();
      }

      case "model_set_complexity": {
        const spec = s();
        const tier = input.tier as ComplexityTier;
        spec.preSpecAssessment.complexity = {
          tier,
          scores: {
            silhouetteComplexity: num(input.silhouetteComplexity), componentCount: num(input.componentCount), hierarchyDepth: num(input.hierarchyDepth),
            repetitionDensity: num(input.repetitionDensity), materialLayerCount: num(input.materialLayerCount), localDetailDensity: num(input.localDetailDensity),
            occlusionRisk: num(input.occlusionRisk), actionReadinessNeed: num(input.actionReadinessNeed),
          },
          estimatedCounts: {
            macroComponents: num(input.macroComponents, 1), mesoComponents: num(input.mesoComponents), microFeatureGroups: num(input.microFeatureGroups),
            materialLayers: num(input.materialLayers, 1), repetitionSystems: num(input.repetitionSystems),
          },
          reasoning: (input.reasoning as string[]) ?? [],
        };
        spec.preSpecAssessment.detailInventory.targetMinDetails = targetMinDetailsFor(tier);
        spec.qualityContract = { ...spec.qualityContract, qualityBar: tier, minimumSpecDepth: minimumSpecDepthFor(tier) };
        setSpec({ ...spec });
        return ok({ targetMinDetails: targetMinDetailsFor(tier), minimumSpecDepth: minimumSpecDepthFor(tier) });
      }

      case "model_set_quality_contract": {
        const spec = s();
        const base = spec.qualityContract.featureGroups.length ? spec.qualityContract : makeQualityContract(spec.preSpecAssessment.complexity.tier);
        spec.qualityContract = {
          ...base,
          definitionOfDone: (input.definitionOfDone as string[]) ?? base.definitionOfDone,
          antiShallowSpecRules: (input.antiShallowSpecRules as string[]) ?? base.antiShallowSpecRules,
          visualDeltaChecks: (input.visualDeltaChecks as string[]) ?? base.visualDeltaChecks,
        };
        setSpec({ ...spec });
        return ok();
      }

      case "model_scan_zones":
        return ok({ zones: scanZones((input.mode as "grid-3x3" | "grid-4x4") ?? "grid-3x3") });

      case "model_add_detail": {
        const spec = s();
        const id = `detail-${ulid()}`;
        const entry: DetailEntry = {
          id, kind: input.kind as never, region: input.region as never, affects: input.affects as never,
          scale: num(input.scale, 0.5), evidenceRef: String(input.evidenceRef ?? ""), confidence: num(input.confidence),
          mapsTo: (input.mapsTo as string | null) ?? null, notes: input.notes ? String(input.notes) : undefined,
        };
        spec.preSpecAssessment.detailInventory.details.push(entry);
        setSpec({ ...spec });
        return ok({ detailId: id });
      }

      case "model_add_material": {
        const spec = s();
        const id = String(input.id ?? `mat-${ulid()}`);
        const mat: SculptMaterial = {
          id, baseColor: String(input.baseColor ?? "#888888"),
          roughness: { base: num(input.roughnessBase, 0.6), variation: num(input.roughnessVariation, 0.1) },
          metalness: num(input.metalness), opacity: { base: num(input.opacity, 1) },
          clearcoat: input.clearcoat as number | undefined, clearcoatRoughness: input.clearcoatRoughness as number | undefined,
          transmission: input.transmission as number | undefined, ior: input.ior as number | undefined, anisotropy: input.anisotropy as number | undefined,
          emissive: input.emissive as string | undefined, emissiveIntensity: input.emissiveIntensity as number | undefined,
          localOverrides: [], referencePbr: null, projectedTexture: null,
        };
        spec.materials = [...spec.materials.filter((m) => m.id !== id), mat];
        setSpec({ ...spec });
        return ok({ materialId: id });
      }

      case "model_add_material_override": {
        const spec = s();
        const mat = spec.materials.find((m) => m.id === input.materialId);
        if (!mat) return fail(`unknown materialId "${input.materialId}"`);
        const id = `override-${ulid()}`;
        mat.localOverrides = [...mat.localOverrides, {
          id, kind: input.kind as never, region: input.region as never, roughnessDelta: input.roughnessDelta as number | undefined,
          clearcoat: input.clearcoat as number | undefined, colorShift: input.colorShift as string | undefined,
          dirtAmount: input.dirtAmount as number | undefined, cavityBias: input.cavityBias as boolean | undefined,
          emissive: input.emissive as string | undefined, emissiveIntensity: input.emissiveIntensity as number | undefined,
        }];
        setSpec({ ...spec });
        return ok({ overrideId: id });
      }

      case "model_add_component": {
        const spec = s();
        if (!spec.materials.some((m) => m.id === input.materialId)) return fail(`unknown materialId "${input.materialId}" — call model_add_material first`);
        const id = `c-${ulid()}`;
        const attachmentInput = input.attachment as Record<string, unknown> | undefined;
        const attachment: Attachment | null = attachmentInput
          ? {
              parentId: String(input.parent ?? ""), parentSocket: String(attachmentInput.parentSocket ?? "surface"),
              localStart: attachmentInput.localStart as never, localEnd: attachmentInput.localEnd as never,
              baseRadius: attachmentInput.baseRadius as number | undefined, endRadius: attachmentInput.endRadius as number | undefined,
              contactType: (attachmentInput.contactType as never) ?? "embedded", gapTolerance: num(attachmentInput.gapTolerance, 0.02),
              evidenceRefs: (attachmentInput.evidenceRefs as string[]) ?? [],
            }
          : null;
        const component: SculptComponent = {
          id, name: String(input.name ?? id), level: input.level as never, role: String(input.role ?? "part"),
          importance: (input.importance as never) ?? "important", confidence: num(input.confidence, 0.7),
          primitive: input.primitive as never, topologyClass: input.topologyClass as never, topologyRationale: String(input.topologyRationale ?? ""),
          geometryDescriptor: {
            topologyIntent: String(input.topologyRationale ?? ""),
            edgeTreatment: { type: (input.bevelType as never) ?? "none", bevelRadius: num(input.bevelRadius), segments: num(input.bevelSegments, 1) },
            deformationStack: [], uvStrategy: "generated procedural coordinates", normalStrategy: "smooth vertex normals",
            params: (input.geometryParams as never) ?? undefined,
          },
          parent: (input.parent as string | null) ?? null, attachment,
          dimensions: { width: num(input.width, 0.1), height: num(input.height, 0.1), depth: num(input.depth, 0.1), units: "relative", confidence: num(input.confidence, 0.7) },
          transform: {
            position: (input.position as never) ?? [0, 0, 0], rotation: (input.rotation as never) ?? [0, 0, 0], scale: (input.scale as never) ?? [1, 1, 1],
          },
          actionProfile: {
            animationRole: "static", pivot: { mode: "center", localPosition: [0, 0, 0], axis: [0, 1, 0], confidence: 0.6 },
            transformChannels: { translate: true, rotate: true, scale: true, bend: false, twist: false, detach: false, visibility: true, materialState: false },
            sockets: [], collider: { type: "box", offset: [0, 0, 0], scale: [1, 1, 1], isTrigger: false, notes: "box proxy" },
            constraints: [], destruction: { breakable: false, fractureGroup: id, seamRefs: [], detachableFragments: [], breakImpulse: 0, debrisMaterial: String(input.materialId) },
          },
          material: String(input.materialId), localFeatures: [],
          surfaceDetail: { macroRoughness: 0, microRoughness: 0, bumpAmplitude: 0, normalPattern: "", displacementPattern: "", occlusionPattern: "", edgeWearPattern: "" },
          evidenceRefs: (input.evidenceRefs as string[]) ?? ["full-object"], fidelityTier: "blockout",
        };
        spec.components = [...spec.components, component];
        setSpec({ ...spec });
        return ok({ componentId: id });
      }

      case "model_add_local_feature": {
        const spec = s();
        const c = spec.components.find((c) => c.id === input.componentId);
        if (!c) return fail(`unknown componentId "${input.componentId}"`);
        const id = `feat-${ulid()}`;
        c.localFeatures = [...c.localFeatures, {
          id, kind: input.kind as never, region: input.region as never,
          geometryEffect: input.geometryEffectType ? { type: input.geometryEffectType as never, path: input.path as never, width: input.width as number | undefined, depth: input.depth as number | undefined } : undefined,
          instancing: input.instanceCount ? { count: num(input.instanceCount), distribution: (input.instanceDistribution as never) ?? "linear" } : undefined,
          confidence: num(input.confidence, 0.6), evidenceRef: String(input.evidenceRef ?? ""),
        }];
        setSpec({ ...spec });
        return ok({ featureId: id });
      }

      case "model_add_repetition_system": {
        const spec = s();
        if (!spec.components.some((c) => c.id === input.componentRef)) return fail(`unknown componentRef "${input.componentRef}"`);
        const id = `rep-${ulid()}`;
        const sys: RepetitionSystem = {
          id, componentRef: String(input.componentRef), count: num(input.count, 4), distribution: input.distribution as never,
          instanceVariance: { scale: num(input.scaleVariance, 0.1), rotation: num(input.rotationVariance, 0.2), positionJitter: num(input.positionJitter, 0.01) },
        };
        spec.repetitionSystems = [...spec.repetitionSystems, sys];
        setSpec({ ...spec });
        return ok({ repetitionId: id });
      }

      case "model_set_feature_targets": {
        const spec = s();
        spec.featureReviewTargets = (input.targets as never[]).map((t: Record<string, unknown>) => ({
          id: String(t.id), name: String(t.name), tier: t.tier as never, passIds: (t.passIds as never[]) ?? [],
          minimumScore: num(t.minimumScore, 0.75), evidenceRefs: (t.evidenceRefs as string[]) ?? ["full-object"],
        }));
        setSpec({ ...spec });
        return ok();
      }

      case "model_set_anatomy": {
        const spec = s();
        spec.preSpecAssessment.anatomy = {
          applies: true, styleHeads: num(input.styleHeads, 5.5),
          proportions: { headUnit: num(input.headUnit), torso: num(input.torso), legs: num(input.legs), shoulderWidth: num(input.shoulderWidth), hipWidth: num(input.hipWidth) },
          pose: { type: String(input.poseType ?? "standing"), jointAngles: {} },
          faceLandmarks: { eyeLine: num(input.eyeLine, 0.5), eyeSpacing: num(input.eyeSpacing, 0.25), noseBase: num(input.noseBase, 0.65), mouthLine: num(input.mouthLine, 0.8), hairline: num(input.hairline, 0.1) },
          features: [], confidence: num(input.confidence, 0.6),
        };
        setSpec({ ...spec });
        return ok();
      }

      case "model_validate": {
        const result = validateSculptSpec(s(), input.strict !== false);
        return ok(result);
      }

      case "model_solve_camera": {
        const ref = useModelStore.getState().reference;
        if (!ref) return fail("no reference image set");
        return ok({ referenceCamera: solveCameraPose(ref.w, ref.h) });
      }

      case "model_extract_pbr": {
        const spec = s();
        const mat = spec.materials.find((m) => m.id === input.materialId);
        if (!mat) return fail(`unknown materialId "${input.materialId}"`);
        const ref = useModelStore.getState().reference;
        if (!ref) return fail("no reference image set");
        const full = await drawImageDataFromUrl(ref.dataUrl);
        const { imageData } = cropImageData(full, input.region as never);
        const evidence = extractPbrEvidence(imageData, input.region as never);
        mat.referencePbr = { palette: evidence.palette, deLitAlbedo: evidence.deLitAlbedo, roughnessEstimate: evidence.roughnessEstimate, confidence: evidence.confidence, cropRegion: evidence.cropRegion };
        if (evidence.confidence >= 0.7 - 1e-9) mat.roughness = { base: evidence.roughnessEstimate, variation: mat.roughness.variation };
        setSpec({ ...spec });
        return ok({ ...evidence, requestInput: evidence.confidence < 0.7 });
      }

      case "model_project_texture": {
        const spec = s();
        const mat = spec.materials.find((m) => m.id === input.materialId);
        const comp = spec.components.find((c) => c.id === input.componentId);
        if (!mat || !comp) return fail("unknown componentId or materialId");
        const ref = useModelStore.getState().reference;
        if (!ref) return fail("no reference image set");
        const full = await drawImageDataFromUrl(ref.dataUrl);
        const { imageData, canvas } = cropImageData(full, input.region as never);
        const delit = delightAlbedo(imageData, 0.6);
        const delitCanvas = document.createElement("canvas");
        delitCanvas.width = canvas.width; delitCanvas.height = canvas.height;
        delitCanvas.getContext("2d")!.putImageData(delit, 0, 0);

        const camera = solveCameraPose(ref.w, ref.h);
        const { root } = useModelStore.getState();
        const node = root?.userData.sculptRuntime?.meshes?.[comp.id] as THREE.Mesh | undefined;
        if (!node) return fail("component has no live mesh yet — call model_request_render once first so the current pass builds it");
        node.updateWorldMatrix(true, false);
        const result = bakeProjectedTexture(node.geometry, node.matrixWorld.clone(), camera, delitCanvas);
        mat.projectedTexture = result;
        setSpec({ ...spec });
        return ok(result);
      }

      case "model_request_render": {
        const bridge = getModelRenderBridge();
        if (!bridge) return fail("viewport is not mounted yet");
        const spec = s();
        const reviewCanvas = await bridge.captureReviewShot();
        if (!reviewCanvas) return fail("render capture failed");

        // Decode the reference ONCE (cached + resolution-capped) and reuse
        // it for both the comparison sheet and Divine Eye — a second full
        // decode here was pure redundant latency on a large source photo.
        const refImageData = await drawImageDataFromUrl(spec.sourceImage);
        const refCanvas = document.createElement("canvas");
        refCanvas.width = refImageData.width; refCanvas.height = refImageData.height;
        refCanvas.getContext("2d")!.putImageData(refImageData, 0, 0);
        const sheet = await makeComparisonSheet(refCanvas, reviewCanvas, { label: `render · ${currentPass(spec)}` });
        const refPx = fromImageData(refImageData);
        const renderCtx = reviewCanvas.getContext("2d") ?? reviewCanvas.getContext("webgl2");
        const renderImageData = reviewCanvas.getContext("2d")
          ? (reviewCanvas.getContext("2d") as CanvasRenderingContext2D).getImageData(0, 0, reviewCanvas.width, reviewCanvas.height)
          : await canvasToImageData(reviewCanvas);
        void renderCtx;
        const de = evaluateDivineEye(refPx, fromImageData(renderImageData));
        lastDivineEye = de;

        let multiAngle: ReturnType<typeof diagnoseMultiAngle> | null = null;
        if (input.multiAngle) {
          const shots = await bridge.captureOrbit([-35, 0, 35]);
          const pxShots = await Promise.all(shots.map(async (sh) => ({ angleDeg: sh.angleDeg, px: fromImageData(sh.canvas.getContext("2d") ? sh.canvas.getContext("2d")!.getImageData(0, 0, sh.canvas.width, sh.canvas.height) : await canvasToImageData(sh.canvas)) })));
          multiAngle = diagnoseMultiAngle(pxShots);
        }

        // Persist the sheet to a real file so the CLI-driven agent (no inline
        // vision content blocks over MCP) can view it with its own built-in
        // Read tool — the same mechanism XDesignClaudeRail relies on for the
        // canvas snapshot, just via a returned path instead of `imagePath`.
        let comparisonSheetPath: string | null = null;
        try {
          const bytes = await canvasToPngBytes(sheet.canvas);
          comparisonSheetPath = await ipc.xdesignSnapshotWrite(Array.from(bytes));
        } catch (e) {
          log.warn("img2model: failed to persist comparison sheet", e);
        }

        return {
          text: JSON.stringify({
            ok: true,
            pass: currentPass(spec),
            divineEye: de,
            multiAngle,
            comparisonSheetPath,
            instruction: comparisonSheetPath
              ? "Use your Read tool on comparisonSheetPath to SEE the reference|render comparison before deciding your review."
              : "Comparison sheet could not be saved to disk — judge from the Divine Eye scores alone and note the limitation in your review.",
          }),
          images: [sheet.dataUrl],
        };
      }

      case "model_submit_review": {
        const spec = s();
        const pass = currentPass(spec);
        if (pass === "complete") return fail("all build passes are already complete");
        const gate = checkPass(spec, pass as never);
        if (!gate.ok) return fail(gate.reason);

        const featureReviews = ((input.featureScores as never[]) ?? []).map((f: Record<string, unknown>) => ({
          id: String(f.id), score: num(f.score), visible: f.visible !== false, notes: f.notes ? String(f.notes) : undefined,
        }));
        const { spec: nextSpec, entry, blocked } = appendReview(spec, {
          passId: pass as never, estimatedFidelity: num(input.fidelity), aiVisionScore: num(input.aiVisionScore),
          layerScores: (input.layerScores as never) ?? {}, featureReviews, action: input.action as never,
          summary: String(input.summary ?? ""), matched: (input.matched as string[]) ?? [], mismatches: (input.mismatches as string[]) ?? [],
          specFixes: (input.specFixes as string[]) ?? [], codeFixes: (input.codeFixes as string[]) ?? [], evidence: [],
          referenceScreenshot: spec.sourceImage, renderScreenshot: "review-canvas", comparisonImage: "comparison-sheet",
          cameraView: String(input.cameraView ?? "review"), notes: "", aiVisionNotes: String(input.aiVisionNotes ?? ""),
          divineEye: lastDivineEye ?? undefined,
        } as never);
        setSpec(nextSpec);
        lastDivineEye = null;
        return ok({ recordedAction: entry.action, blocked, pipeline: statusPayload(nextSpec) });
      }

      default:
        return fail(`unknown tool ${name}`);
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function canvasToImageData(canvas: HTMLCanvasElement): Promise<ImageData> {
  return new Promise((resolve) => {
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width; tmp.height = canvas.height;
    const ctx = tmp.getContext("2d")!;
    ctx.drawImage(canvas, 0, 0);
    resolve(ctx.getImageData(0, 0, tmp.width, tmp.height));
  });
}
function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("canvas.toBlob returned null")); return; }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
    }, "image/png");
  });
}

export function toolLabel(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "model_get_spec": return "Read spec";
    case "model_set_object_class": return `Classify — ${String(input.primaryType ?? "")}`;
    case "model_set_complexity": return `Complexity — ${String(input.tier ?? "")}`;
    case "model_set_quality_contract": return "Quality contract";
    case "model_scan_zones": return "Scan zones";
    case "model_add_detail": return `Detail — ${String(input.kind ?? "")}`;
    case "model_add_material": return `Material — ${String(input.id ?? "")}`;
    case "model_add_material_override": return `Material override — ${String(input.kind ?? "")}`;
    case "model_add_component": return `Component — ${String(input.name ?? "")}`;
    case "model_add_local_feature": return `Local feature — ${String(input.kind ?? "")}`;
    case "model_add_repetition_system": return "Repetition system";
    case "model_set_feature_targets": return "Feature targets";
    case "model_set_anatomy": return "Anatomy";
    case "model_validate": return "Validate spec";
    case "model_solve_camera": return "Solve camera";
    case "model_extract_pbr": return "Extract PBR evidence";
    case "model_project_texture": return "Project reference texture";
    case "model_request_render": return "Render + compare";
    case "model_submit_review": return `Review — ${String(input.action ?? "")}`;
    default: return name;
  }
}

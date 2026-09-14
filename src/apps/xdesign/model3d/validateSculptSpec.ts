/**
 * Port of img2threejs `forge/stage2_spec/validate_sculpt_spec.py`.
 * Normal validation checks structural integrity (required fields, score
 * ranges, material refs, component parent links, transform shapes,
 * primitive names). `--strict-quality` promotes depth/quality warnings to
 * hard errors — this is the gate that blocks code generation for a spec
 * that is technically valid JSON but too shallow to actually recreate the
 * reference (single-root spec for a compound object, no repetition
 * systems, no local overrides).
 */

import type { ObjectSculptSpec, SculptComponent } from "./sculptSpec";
import { minimumSpecDepthFor } from "./sculptSpec";
import { checkDetailInventory } from "./detailInventory";

export type ValidationIssue = { level: "error" | "warning"; message: string };
export type ValidationResult = { ok: boolean; errors: string[]; warnings: string[] };

const PRIMITIVES = new Set([
  "box", "sphere", "cylinder", "cone", "torus", "capsule", "tube", "extrude", "lathe", "plane", "group",
]);

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

/** Structural validation — always run, always blocking regardless of
 * `--strict-quality`. Mirrors upstream's non-strict pass. */
export function validateStructure(spec: ObjectSculptSpec): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!spec.name.trim()) out.push({ level: "error", message: "spec.name is required" });
  if (!spec.sourceImage.trim()) out.push({ level: "error", message: "spec.sourceImage is required" });
  if (spec.components.length === 0) out.push({ level: "error", message: "spec has no components" });

  const ids = new Set<string>();
  const materialIds = new Set(spec.materials.map((m) => m.id));

  for (const c of spec.components) {
    if (ids.has(c.id)) out.push({ level: "error", message: `duplicate component id "${c.id}"` });
    ids.add(c.id);
    if (!PRIMITIVES.has(c.primitive)) {
      out.push({ level: "error", message: `component "${c.id}" has unknown primitive "${c.primitive}"` });
    }
    if (!isVec3(c.transform.position) || !isVec3(c.transform.rotation) || !isVec3(c.transform.scale)) {
      out.push({ level: "error", message: `component "${c.id}" has a malformed transform` });
    }
    if (c.confidence < 0 || c.confidence > 1) {
      out.push({ level: "error", message: `component "${c.id}" confidence ${c.confidence} out of range 0..1` });
    }
    if (c.material && !materialIds.has(c.material)) {
      out.push({ level: "error", message: `component "${c.id}" references unknown material "${c.material}"` });
    }
  }
  for (const c of spec.components) {
    if (c.parent !== null && !ids.has(c.parent)) {
      out.push({ level: "error", message: `component "${c.id}" has dangling parent "${c.parent}"` });
    }
    if (c.attachment) {
      if (!ids.has(c.attachment.parentId)) {
        out.push({ level: "error", message: `component "${c.id}" attachment.parentId "${c.attachment.parentId}" does not resolve` });
      }
      if (!isVec3(c.attachment.localStart) || !isVec3(c.attachment.localEnd)) {
        out.push({ level: "error", message: `component "${c.id}" attachment has malformed localStart/localEnd` });
      }
    }
  }
  for (const m of spec.materials) {
    if (m.roughness.base < 0 || m.roughness.base > 1) {
      out.push({ level: "warning", message: `material "${m.id}" roughness.base ${m.roughness.base} outside 0..1` });
    }
  }
  for (const r of spec.repetitionSystems) {
    if (!ids.has(r.componentRef)) {
      out.push({ level: "error", message: `repetitionSystem "${r.id}" references unknown component "${r.componentRef}"` });
    }
  }
  return out;
}

const ATTACHMENT_ROLES = new Set(["appendage", "limb", "branch", "handle", "leg", "horn", "wing", "cable", "tube", "connector", "hinge"]);

function componentRequiresAttachment(c: SculptComponent): boolean {
  return c.parent !== null && (ATTACHMENT_ROLES.has(c.role) || ["tube", "extrude", "lathe"].includes(c.primitive));
}

/** Strict-quality checks: min macro/meso/micro counts by complexity tier,
 * material layer/repetition/review-viewpoint depth, non-generic feature
 * targets, detail-inventory completeness, attachment correctness, and (for
 * character/hybrid domains) a filled anatomy block. */
export function validateStrictQuality(spec: ObjectSculptSpec): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const tier = spec.preSpecAssessment.complexity.tier;
  const min = spec.qualityContract.minimumSpecDepth ?? minimumSpecDepthFor(tier);

  const macro = spec.components.filter((c) => c.level === "macro").length;
  const meso = spec.components.filter((c) => c.level === "meso").length;
  const micro = spec.components.filter((c) => c.level === "micro").length;
  if (macro < min.macroComponents) out.push({ level: "error", message: `only ${macro} macro components, need ${min.macroComponents} for tier "${tier}"` });
  if (meso < min.mesoComponents) out.push({ level: "error", message: `only ${meso} meso components, need ${min.mesoComponents} for tier "${tier}"` });
  if (micro < min.microFeatureGroups) out.push({ level: "error", message: `only ${micro} micro feature groups, need ${min.microFeatureGroups} for tier "${tier}"` });
  if (spec.materials.length < min.materialLayers) out.push({ level: "error", message: `only ${spec.materials.length} materials, need ${min.materialLayers} for tier "${tier}"` });
  if (spec.repetitionSystems.length < min.repetitionSystems) out.push({ level: "error", message: `only ${spec.repetitionSystems.length} repetition systems, need ${min.repetitionSystems} for tier "${tier}"` });

  // Anti-shallow-spec rule: a complex+ object needs more than a single root.
  if ((tier === "complex" || tier === "ultra-complex") && spec.components.length <= 1) {
    out.push({ level: "error", message: `tier "${tier}" cannot be represented by a single root component` });
  }

  // Non-generic feature review targets — reject placeholder-y names.
  const generic = /^(good|nice|smooth|shiny|looks right|correct)$/i;
  for (const t of spec.featureReviewTargets) {
    if (generic.test(t.name.trim())) {
      out.push({ level: "error", message: `featureReviewTarget "${t.id}" name "${t.name}" is too generic — name the identity-defining system` });
    }
  }
  if (spec.featureReviewTargets.length === 0) {
    out.push({ level: "error", message: "no featureReviewTargets — replace the starter targets with the object's real identity-defining systems" });
  }

  // Material-pass locality: moderate+ needs local overrides somewhere.
  if (tier !== "simple" && spec.preSpecAssessment.specDepthDecision.needsMaterialLocalOverrides) {
    const hasOverrides = spec.materials.some((m) => m.localOverrides.length > 0);
    if (!hasOverrides) out.push({ level: "error", message: "spec needs material local overrides but none are present" });
  }

  // Detail inventory completeness (moderate+ subjects).
  if (tier !== "simple" && tier !== "unassessed") {
    const report = checkDetailInventory(spec);
    if (!report.ok) {
      if (report.count < report.targetMinDetails) {
        out.push({ level: "error", message: `detail inventory has ${report.count}/${report.targetMinDetails} mapped details` });
      }
      for (const id of report.unmapped) {
        out.push({ level: "error", message: `detail "${id}" does not map to a real component.localFeatures or material.localOverrides entry` });
      }
    }
  }

  // Attachment correctness for appendage-like children.
  for (const c of spec.components) {
    if (componentRequiresAttachment(c) && !c.attachment) {
      out.push({ level: "error", message: `component "${c.id}" (role "${c.role}") is parented but has no attachment contract — it will float` });
    }
  }

  // Character/hybrid domain needs a filled anatomy block.
  const domain = spec.preSpecAssessment.objectClass.primaryDomain;
  if (domain === "character" || domain === "hybrid") {
    const a = spec.preSpecAssessment.anatomy;
    if (!a.applies || a.styleHeads <= 0 || a.confidence <= 0) {
      out.push({ level: "error", message: "character/hybrid domain requires a filled anatomy block (styleHeads, proportions, confidence)" });
    }
    const hasCharacterTargets = spec.featureReviewTargets.some((t) =>
      ["anatomy-proportion", "face-landmark-placement", "pose-silhouette", "outfit-and-palette"].includes(t.id),
    );
    if (!hasCharacterTargets) {
      out.push({ level: "error", message: "character/hybrid domain requires anatomy-proportion/face-landmark-placement/pose-silhouette/outfit-and-palette feature targets" });
    }
  }

  return out;
}

export function validateSculptSpec(spec: ObjectSculptSpec, strictQuality = false): ValidationResult {
  const issues = [...validateStructure(spec), ...(strictQuality ? validateStrictQuality(spec) : [])];
  const errors = issues.filter((i) => i.level === "error").map((i) => i.message);
  const warnings = issues.filter((i) => i.level === "warning").map((i) => i.message);
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Port of img2threejs `forge/stage2_spec/new_sculpt_spec.py`'s
 * `make_character_component_tree` / `CHARACTER_MATERIALS` /
 * `make_character_build_passes` / `make_character_feature_targets`. A
 * stylized humanoid bust template, head-unit (HU) driven, generalized from
 * upstream's fixed demo character into parametrized accessories (hair,
 * glasses, headphones — include only what `anatomy.features` names).
 *
 * All visible parts are authored with a logical parent + local offset, then
 * FLATTENED to world space and parented to a single hidden, unit-scaled
 * root (upstream's own fix for the "non-uniform parent scale distorts
 * descendants" trap).
 */

import type { PassId, SculptComponent, SculptMaterial } from "./sculptSpec";
import { newSculptSpec } from "./sculptSpec";

export const CHARACTER_MATERIALS: Omit<SculptMaterial, "localOverrides">[] = [
  { id: "hidden", baseColor: "#000000", roughness: { base: 1, variation: 0 }, metalness: 0, opacity: { base: 0 } },
  { id: "skin", baseColor: "#e8b98f", roughness: { base: 0.55, variation: 0.08 }, metalness: 0, opacity: { base: 1 } },
  { id: "hair", baseColor: "#171310", roughness: { base: 0.42, variation: 0.1 }, metalness: 0, opacity: { base: 1 } },
  { id: "shirt", baseColor: "#20202a", roughness: { base: 0.85, variation: 0.12 }, metalness: 0, opacity: { base: 1 } },
  { id: "glasses-frame", baseColor: "#111114", roughness: { base: 0.35, variation: 0.05 }, metalness: 0.3, opacity: { base: 1 } },
  { id: "glasses-lens", baseColor: "#a9c6d8", roughness: { base: 0.08, variation: 0.02 }, metalness: 0, opacity: { base: 0.5 }, transmission: 0.6, ior: 1.5 },
  { id: "headphone", baseColor: "#0e0e10", roughness: { base: 0.5, variation: 0.08 }, metalness: 0.1, opacity: { base: 1 } },
  { id: "lips", baseColor: "#c98070", roughness: { base: 0.5, variation: 0.05 }, metalness: 0, opacity: { base: 1 } },
];

type PartDef = {
  id: string; name: string; primitive: SculptComponent["primitive"]; parent: string;
  offset: [number, number, number]; scale: [number, number, number]; material: string;
  role: string; level: SculptComponent["level"]; rotation: [number, number, number]; importance: number;
};

function coreParts(hu: number): PartDef[] {
  return [
    { id: "torso", name: "Torso", primitive: "capsule", parent: "root", offset: [0, 0.55 * hu, 0], scale: [2.4 * hu, 2.2 * hu, 1.5 * hu], material: "shirt", role: "shell", level: "macro", rotation: [0, 0, 0], importance: 1 },
    { id: "neck", name: "Neck", primitive: "cylinder", parent: "root", offset: [0, 1.65 * hu, 0], scale: [0.55 * hu, 0.7 * hu, 0.55 * hu], material: "skin", role: "support", level: "meso", rotation: [0, 0, 0], importance: 0.6 },
    { id: "head", name: "Head", primitive: "sphere", parent: "root", offset: [0, 2.5 * hu, 0.02 * hu], scale: [0.92 * hu, 1.12 * hu, 0.98 * hu], material: "skin", role: "body", level: "macro", rotation: [0, 0, 0], importance: 1 },
    { id: "brow-l", name: "Eyebrow L", primitive: "box", parent: "head", offset: [0.2 * hu, 0.12 * hu, 0.46 * hu], scale: [0.22 * hu, 0.04 * hu, 0.06 * hu], material: "hair", role: "detail", level: "micro", rotation: [0, 0, 0], importance: 0.4 },
    { id: "brow-r", name: "Eyebrow R", primitive: "box", parent: "head", offset: [-0.2 * hu, 0.12 * hu, 0.46 * hu], scale: [0.22 * hu, 0.04 * hu, 0.06 * hu], material: "hair", role: "detail", level: "micro", rotation: [0, 0, 0], importance: 0.4 },
    { id: "nose", name: "Nose", primitive: "cone", parent: "head", offset: [0, -0.04 * hu, 0.5 * hu], scale: [0.14 * hu, 0.28 * hu, 0.18 * hu], material: "skin", role: "detail", level: "micro", rotation: [1.4, 0, 0], importance: 0.4 },
    { id: "mouth", name: "Mouth", primitive: "box", parent: "head", offset: [0, -0.34 * hu, 0.46 * hu], scale: [0.24 * hu, 0.04 * hu, 0.05 * hu], material: "lips", role: "detail", level: "micro", rotation: [0, 0, 0], importance: 0.4 },
    { id: "arm-l", name: "Upper arm L", primitive: "capsule", parent: "torso", offset: [1.15 * hu, -0.35 * hu, 0.1 * hu], scale: [0.55 * hu, 1.5 * hu, 0.55 * hu], material: "shirt", role: "arm", level: "meso", rotation: [0, 0, 0.25], importance: 0.7 },
    { id: "arm-r", name: "Upper arm R", primitive: "capsule", parent: "torso", offset: [-1.15 * hu, -0.35 * hu, 0.1 * hu], scale: [0.55 * hu, 1.5 * hu, 0.55 * hu], material: "shirt", role: "arm", level: "meso", rotation: [0, 0, -0.25], importance: 0.7 },
  ];
}
function hairParts(hu: number): PartDef[] {
  return [
    { id: "hair", name: "Hair", primitive: "sphere", parent: "head", offset: [0, 0.28 * hu, -0.04 * hu], scale: [1.06 * hu, 0.82 * hu, 1.08 * hu], material: "hair", role: "hair", level: "meso", rotation: [0, 0, 0], importance: 0.9 },
  ];
}
function glassesParts(hu: number): PartDef[] {
  return [
    { id: "glasses-frame-l", name: "Glasses frame L", primitive: "torus", parent: "head", offset: [0.21 * hu, 0.02 * hu, 0.48 * hu], scale: [0.26 * hu, 0.22 * hu, 0.08 * hu], material: "glasses-frame", role: "connector", level: "meso", rotation: [0, 0, 0], importance: 0.85 },
    { id: "glasses-frame-r", name: "Glasses frame R", primitive: "torus", parent: "head", offset: [-0.21 * hu, 0.02 * hu, 0.48 * hu], scale: [0.26 * hu, 0.22 * hu, 0.08 * hu], material: "glasses-frame", role: "connector", level: "meso", rotation: [0, 0, 0], importance: 0.85 },
    { id: "glasses-bridge", name: "Glasses bridge", primitive: "box", parent: "head", offset: [0, 0.04 * hu, 0.5 * hu], scale: [0.12 * hu, 0.04 * hu, 0.04 * hu], material: "glasses-frame", role: "connector", level: "micro", rotation: [0, 0, 0], importance: 0.5 },
  ];
}
function headphoneParts(hu: number): PartDef[] {
  return [
    { id: "hp-band", name: "Headphone band", primitive: "torus", parent: "root", offset: [0, 1.78 * hu, 0.05 * hu], scale: [0.95 * hu, 0.62 * hu, 0.7 * hu], material: "headphone", role: "ring", level: "meso", rotation: [1.2, 0, 0], importance: 0.85 },
    { id: "hp-cup-l", name: "Ear cup L", primitive: "cylinder", parent: "root", offset: [0.5 * hu, 1.52 * hu, 0.35 * hu], scale: [0.42 * hu, 0.28 * hu, 0.42 * hu], material: "headphone", role: "detail", level: "meso", rotation: [0, 0, 1.57], importance: 0.7 },
    { id: "hp-cup-r", name: "Ear cup R", primitive: "cylinder", parent: "root", offset: [-0.5 * hu, 1.52 * hu, 0.35 * hu], scale: [0.42 * hu, 0.28 * hu, 0.42 * hu], material: "headphone", role: "detail", level: "meso", rotation: [0, 0, -1.57], importance: 0.7 },
  ];
}

function worldPos(parts: PartDef[], id: string): [number, number, number] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  let x = 0, y = 0, z = 0, cur: string | undefined = id;
  while (cur && cur !== "root") {
    const p = byId.get(cur);
    if (!p) break;
    x += p.offset[0]; y += p.offset[1]; z += p.offset[2];
    cur = p.parent;
  }
  return [x, y, z];
}

function toComponent(p: PartDef, worldPosition: [number, number, number]): SculptComponent {
  return {
    id: p.id, name: p.name, level: p.level, role: p.role, importance: p.importance >= 0.8 ? "critical" : p.importance >= 0.5 ? "important" : "minor",
    confidence: 0.8, primitive: p.primitive, topologyClass: "unassessed", topologyRationale: "character-template part",
    geometryDescriptor: { topologyIntent: "stylized character part", edgeTreatment: { type: "none", bevelRadius: 0, segments: 1 }, deformationStack: [], uvStrategy: "generated procedural coordinates", normalStrategy: "smooth vertex normals" },
    parent: "root", attachment: null,
    dimensions: { width: p.scale[0], height: p.scale[1], depth: p.scale[2], units: "relative", confidence: 0.8 },
    transform: { position: worldPosition, rotation: p.rotation, scale: [1, 1, 1] },
    actionProfile: {
      animationRole: "static", pivot: { mode: "center", localPosition: [0, 0, 0], axis: [0, 1, 0], confidence: 0.7 },
      transformChannels: { translate: true, rotate: true, scale: true, bend: false, twist: false, detach: false, visibility: true, materialState: false },
      sockets: [], collider: { type: "box", offset: [0, 0, 0], scale: [1, 1, 1], isTrigger: false, notes: "box proxy" },
      constraints: [], destruction: { breakable: false, fractureGroup: p.id, seamRefs: [], detachableFragments: [], breakImpulse: 0, debrisMaterial: p.material },
    },
    material: p.material, localFeatures: [],
    surfaceDetail: { macroRoughness: 0, microRoughness: 0, bumpAmplitude: 0, normalPattern: "", displacementPattern: "", occlusionPattern: "", edgeWearPattern: "" },
    evidenceRefs: ["full-object"], fidelityTier: "blockout",
  };
}

export type CharacterOptions = { headUnit?: number; hasHair?: boolean; hasGlasses?: boolean; hasHeadphones?: boolean };

export function makeCharacterComponentTree(opts: CharacterOptions = {}): SculptComponent[] {
  const hu = opts.headUnit ?? 0.28;
  let parts = coreParts(hu);
  if (opts.hasHair !== false) parts = [...parts, ...hairParts(hu)];
  if (opts.hasGlasses) parts = [...parts, ...glassesParts(hu)];
  if (opts.hasHeadphones) parts = [...parts, ...headphoneParts(hu)];

  const root: SculptComponent = toComponent(
    { id: "root", name: "Character (root)", primitive: "box", parent: "", offset: [0, 0, 0], scale: [1, 1, 1], material: "hidden", role: "body", level: "macro", rotation: [0, 0, 0], importance: 1 },
    [0, 0, 0],
  );
  root.parent = null;
  root.actionProfile.animationRole = "static";
  return [root, ...parts.map((p) => toComponent(p, worldPos(parts, p.id)))];
}

export const CHARACTER_PASS_ORDER: PassId[] = ["blockout", "proportion-lock", "feature-placement", "material-pass", "surface-pass", "lighting-pass", "interaction-pass", "optimization-pass"];

export function makeCharacterFeatureTargets() {
  return [
    { id: "anatomy-proportion", name: "Head-unit proportions and pose", tier: "critical" as const, passIds: ["blockout", "proportion-lock"] as PassId[], minimumScore: 0.78, evidenceRefs: ["full-object"] },
    { id: "face-landmark-placement", name: "Face landmarks placement", tier: "critical" as const, passIds: ["feature-placement"] as PassId[], minimumScore: 0.75, evidenceRefs: ["full-object"] },
    { id: "pose-silhouette", name: "Pose and bust silhouette", tier: "critical" as const, passIds: ["blockout", "proportion-lock"] as PassId[], minimumScore: 0.75, evidenceRefs: ["full-object"] },
    { id: "outfit-and-palette", name: "Outfit + accessories + palette", tier: "important" as const, passIds: ["material-pass"] as PassId[], minimumScore: 0.7, evidenceRefs: ["full-object"] },
  ];
}

/** Scaffold a full character spec: template geometry + materials + feature
 * targets pre-filled (still needs `preSpecAssessment.anatomy` filled from
 * measured landmarks — see `landmarks.ts` — before it can pass strict
 * validation). */
export function scaffoldCharacterSpec(name: string, sourceImage: string, opts: CharacterOptions = {}) {
  const spec = newSculptSpec(name, sourceImage);
  spec.preSpecAssessment.objectClass.primaryDomain = "character";
  spec.components = makeCharacterComponentTree(opts);
  spec.materials = CHARACTER_MATERIALS.map((m) => ({ ...m, localOverrides: [] }));
  spec.featureReviewTargets = makeCharacterFeatureTargets();
  return spec;
}

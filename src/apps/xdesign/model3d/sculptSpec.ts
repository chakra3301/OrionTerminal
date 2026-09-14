/**
 * ObjectSculptSpec — a faithful TS port of img2threejs's spec schema
 * (github.com/hoainho/img2threejs, `forge/stage2_spec/new_sculpt_spec.py`).
 * The upstream skill is a file-based Python/CLI pipeline for a coding agent;
 * this is the same schema and gate philosophy adapted to a live in-app
 * runtime (spec lives in a Zustand store, not on disk, and passes are built
 * as real THREE.Object3D graphs, not generated-then-reread TS files).
 *
 * Scope cuts from upstream (documented, not accidental):
 *  - The CS2/Counter-Strike vertical (VPK texture ripping, paint-index
 *    metadata, family/subtype knife adapters) is out — game-asset specific,
 *    not applicable to a general design tool.
 *  - "Maximum likeness" template-fit face projection for a *specific real
 *    person* is upstream's own v1.3 "Planned" (not shipped) milestone — we
 *    ship stylized character reconstruction (v1.2) and generic
 *    reference-projection texturing (the same projection mechanics, applied
 *    to any surface) but not identity-grade face copying.
 */

export type Vec3 = [number, number, number];

export type PrimaryDomain = "object" | "character" | "hybrid" | "unassessed";
export type ComplexityTier = "simple" | "moderate" | "complex" | "ultra-complex" | "unassessed";
export type ComponentLevel = "macro" | "meso" | "micro";
export type TopologyClass =
  | "box-like"
  | "cylindrical"
  | "spherical"
  | "conical"
  | "toroidal"
  | "continuous-organic"
  | "extruded-profile"
  | "lathe-revolved"
  | "curve-swept"
  | "compound-shell"
  | "unassessed";
export type ContactType = "embedded" | "socket" | "overlap" | "hinge" | "surface-contact" | "glued";
export type ObjectPassId =
  | "blockout"
  | "structural-pass"
  | "form-refinement"
  | "material-pass"
  | "surface-pass"
  | "lighting-pass"
  | "interaction-pass"
  | "optimization-pass";
/** Character-domain specs splice these two in right after blockout — see
 * `passOrchestrator.ts::passOrderFor`. Unioned into `PassId` so review
 * entries/spec fields don't need a second parallel type. */
export type CharacterPassId = "proportion-lock" | "feature-placement";
export type PassId = ObjectPassId | CharacterPassId;

export const DEFAULT_PASS_ORDER: ObjectPassId[] = [
  "blockout",
  "structural-pass",
  "form-refinement",
  "material-pass",
  "surface-pass",
  "lighting-pass",
  "interaction-pass",
  "optimization-pass",
];
/** Every pass except optimization needs a rendered+reviewed comparison. */
export const VISUAL_PASS_IDS = new Set<string>(
  DEFAULT_PASS_ORDER.filter((p) => p !== "optimization-pass"),
);

export type DetailKind =
  | "gloss" | "bevel" | "fastener" | "linework" | "contour" | "seam" | "stitch"
  | "stain" | "scratch" | "chip" | "decal" | "emissive" | "hole" | "groove" | "ridge";

export type DetailEntry = {
  id: string;
  kind: DetailKind;
  region: { x: number; y: number; w: number; h: number }; // normalized 0..1
  affects: "geometry" | "material";
  scale: number; // 0..1 intensity
  evidenceRef: string;
  confidence: number; // 0..1
  mapsTo: string | null; // a component.localFeatures[].id or material.localOverrides[].id
  notes?: string;
};

export type PreSpecAssessment = {
  objectClass: {
    primaryType: string;
    primaryDomain: PrimaryDomain;
    formLanguage: string[];
    structureKind: string[];
    motionPotential: string[];
    materialFamilies: string[];
    notes: string;
  };
  complexity: {
    tier: ComplexityTier;
    scores: {
      silhouetteComplexity: number; componentCount: number; hierarchyDepth: number;
      repetitionDensity: number; materialLayerCount: number; localDetailDensity: number;
      occlusionRisk: number; actionReadinessNeed: number; // each 0..3
    };
    estimatedCounts: {
      macroComponents: number; mesoComponents: number; microFeatureGroups: number;
      materialLayers: number; repetitionSystems: number;
    };
    reasoning: string[];
  };
  specDepthDecision: {
    requiredDepth: ComplexityTier;
    minimumComponentLevels: ComponentLevel[];
    needsRepetitionSystems: boolean;
    needsMaterialLocalOverrides: boolean;
    needsMultipleReviewViews: boolean;
    needsActionReadyHierarchy: boolean;
    rationale: string;
  };
  unknownsToResolveBeforeImplementation: string[];
  detailInventory: {
    scanMethod: "component-zones" | "grid-3x3" | "grid-4x4";
    targetMinDetails: number;
    details: DetailEntry[];
  };
  anatomy: {
    applies: boolean;
    styleHeads: number; // 7.5 realistic / 5-6 stylized / 2-3 chibi
    proportions: { headUnit: number; torso: number; legs: number; shoulderWidth: number; hipWidth: number };
    pose: { type: string; jointAngles: Record<string, number> };
    faceLandmarks: { eyeLine: number; eyeSpacing: number; noseBase: number; mouthLine: number; hairline: number };
    features: string[];
    confidence: number;
  };
};

export type FeatureGroup = {
  id: string;
  name: string;
  required: boolean;
  qualityCriteria: string[];
  evidenceRefs: string[];
  failureModes: string[];
};

export type QualityContract = {
  qualityBar: ComplexityTier;
  definitionOfDone: string[];
  minimumSpecDepth: {
    macroComponents: number; mesoComponents: number; microFeatureGroups: number;
    materialLayers: number; repetitionSystems: number; reviewViewpoints: number;
  };
  featureGroups: FeatureGroup[];
  visualDeltaChecks: string[];
  antiShallowSpecRules: string[];
};

export type EdgeTreatment = { type: "none" | "chamfer" | "fillet"; bevelRadius: number; segments: number };

export type Attachment = {
  parentId: string;
  parentSocket: string;
  localStart: Vec3;
  localEnd: Vec3;
  baseRadius?: number;
  endRadius?: number;
  embedDepth?: number;
  overlap?: number;
  contactType: ContactType;
  gapTolerance: number;
  evidenceRefs: string[];
};

export type Socket = { id: string; localPosition: Vec3; localRotation: Vec3; kind: string };

export type ActionProfile = {
  animationRole: "static" | "rotate" | "translate" | "articulated" | "detachable" | "effect-emitter";
  pivot: { mode: "center" | "base" | "hinge" | "branch" | "custom"; localPosition: Vec3; axis: Vec3; confidence: number };
  transformChannels: {
    translate: boolean; rotate: boolean; scale: boolean; bend: boolean; twist: boolean;
    detach: boolean; visibility: boolean; materialState: boolean;
  };
  sockets: Socket[];
  collider: { type: "box" | "sphere" | "capsule" | "cylinder" | "compound"; offset: Vec3; scale: Vec3; isTrigger: boolean; notes: string };
  constraints: string[];
  destruction: {
    breakable: boolean; fractureGroup: string; seamRefs: string[];
    detachableFragments: string[]; breakImpulse: number; debrisMaterial: string;
  };
};

export type LocalFeature = {
  id: string;
  kind: DetailKind;
  region: { x: number; y: number; w: number; h: number };
  geometryEffect?: { type: "groove" | "ridge" | "hole" | "chamfer"; path?: Vec3[]; width?: number; depth?: number };
  instancing?: { count: number; distribution: "linear" | "radial" | "grid"; headShape?: string; recess?: string };
  confidence: number;
  evidenceRef: string;
};

export type SculptComponent = {
  id: string;
  name: string;
  level: ComponentLevel;
  role: string;
  importance: "critical" | "important" | "minor";
  confidence: number;
  primitive: "box" | "sphere" | "cylinder" | "cone" | "torus" | "capsule" | "tube" | "extrude" | "lathe" | "plane" | "group";
  topologyClass: TopologyClass;
  topologyRationale: string;
  geometryDescriptor: {
    topologyIntent: string;
    edgeTreatment: EdgeTreatment;
    deformationStack: string[];
    uvStrategy: string;
    normalStrategy: string;
    /** Extra numeric knobs a builder reads: radialSegments, curve points (for
     * tube/lathe/extrude), torus tube ratio, etc. Free-form by design — the
     * spec author (Claude) fills what the primitive needs. */
    params?: Record<string, number | number[] | Vec3[]>;
  };
  parent: string | null;
  attachment: Attachment | null;
  dimensions: { width: number; height: number; depth: number; units: "relative"; confidence: number };
  transform: { position: Vec3; rotation: Vec3; scale: Vec3 };
  actionProfile: ActionProfile;
  material: string; // material id ref
  localFeatures: LocalFeature[];
  surfaceDetail: {
    macroRoughness: number; microRoughness: number; bumpAmplitude: number;
    normalPattern: string; displacementPattern: string; occlusionPattern: string; edgeWearPattern: string;
  };
  evidenceRefs: string[];
  fidelityTier: PassId;
};

export type MaterialLocalOverride = {
  id: string;
  kind: DetailKind;
  region: { x: number; y: number; w: number; h: number };
  roughnessDelta?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  anisotropy?: number;
  colorShift?: string;
  dirtAmount?: number;
  cavityBias?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
};

export type SculptMaterial = {
  id: string;
  baseColor: string;
  roughness: { base: number; variation: number };
  metalness: number;
  opacity: { base: number };
  clearcoat?: number;
  clearcoatRoughness?: number;
  transmission?: number;
  ior?: number;
  anisotropy?: number;
  envMapIntensity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  localOverrides: MaterialLocalOverride[];
  /** Filled by pbrEvidence.ts from a cropped reference region. */
  referencePbr?: {
    palette: string[];
    deLitAlbedo: string;
    roughnessEstimate: number;
    confidence: number;
    cropRegion: { x: number; y: number; w: number; h: number };
  } | null;
  /** Filled by projectionBake.ts when this material's finish should be the
   * reference's own de-lit pixels projected onto UVs, not a procedural
   * approximation (upstream's single biggest fidelity lever). */
  projectedTexture?: { dataUrl: string; cameraId: string; coverage: number } | null;
};

export type RepetitionSystem = {
  id: string;
  componentRef: string;
  count: number;
  distribution: "linear" | "radial" | "grid" | "scatter";
  instanceVariance: { scale: number; rotation: number; positionJitter: number };
};

export type FeatureReviewTarget = {
  id: string;
  name: string;
  tier: "critical" | "important";
  passIds: PassId[];
  minimumScore: number;
  evidenceRefs: string[];
};

export type ReviewFeatureScore = { id: string; score: number; visible: boolean; notes?: string };

export type ReviewEntry = {
  timestamp: string;
  passId: PassId;
  estimatedFidelity: number;
  aiVisionScore: number | null;
  visualAcceptanceThreshold: number;
  layerScores: {
    silhouetteProportion?: number; componentStructure?: number; formDetail?: number;
    materialSurface?: number; lightingCamera?: number;
  };
  featureReviews: ReviewFeatureScore[];
  action: "continue" | "refine-spec" | "refine-code" | "request-input" | "stop";
  summary: string;
  matched: string[];
  mismatches: string[];
  specFixes: string[];
  codeFixes: string[];
  evidence: string[];
  referenceScreenshot: string;
  renderScreenshot: string;
  comparisonImage: string;
  cameraView: string;
  notes: string;
  aiVisionNotes: string;
  /** Divine Eye's deterministic pre-score, attached for transparency (never
   * the sole acceptance authority — see divineEye.ts). */
  divineEye?: {
    verdict: "pass" | "low-confidence" | "reject";
    action: "continue" | "refine-code" | "probe";
    fidelity: number;
    hardFailures: string[];
    reconstructionModeSuspected: boolean;
  };
};

export type SculptPipelineState = {
  passGateMode: "locked-sequential";
  passOrder: PassId[];
  currentPass: PassId | "complete";
  completedPasses: PassId[];
  lastCompletedPass: PassId | "";
  blockedReason: string;
  nextRequiredEvidence: string[];
};

export type ObjectSculptSpec = {
  schemaVersion: "2.0";
  name: string;
  sourceImage: string; // asset path or data URL
  preSpecAssessment: PreSpecAssessment;
  qualityContract: QualityContract;
  components: SculptComponent[];
  materials: SculptMaterial[];
  repetitionSystems: RepetitionSystem[];
  featureReviewTargets: FeatureReviewTarget[];
  sculptPipeline: SculptPipelineState;
  reviewHistory: ReviewEntry[];
  selfCorrectLoop: {
    visualAcceptance: {
      threshold: number;
      featureReviewPolicy: {
        enabled: boolean;
        maxCriticalFeaturesPerPass: number;
        maxImportantFeaturesPerPass: number;
        criticalDefaultThreshold: number;
        importantAverageThreshold: number;
      };
    };
  };
};

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function makePreSpecAssessment(): PreSpecAssessment {
  return {
    objectClass: {
      primaryType: "unassessed", primaryDomain: "unassessed", formLanguage: [],
      structureKind: [], motionPotential: [], materialFamilies: [],
      notes: "Fill from direct visual inspection before writing the final spec.",
    },
    complexity: {
      tier: "unassessed",
      scores: {
        silhouetteComplexity: 0, componentCount: 0, hierarchyDepth: 0, repetitionDensity: 0,
        materialLayerCount: 0, localDetailDensity: 0, occlusionRisk: 0, actionReadinessNeed: 0,
      },
      estimatedCounts: { macroComponents: 1, mesoComponents: 0, microFeatureGroups: 0, materialLayers: 1, repetitionSystems: 0 },
      reasoning: [],
    },
    specDepthDecision: {
      requiredDepth: "unassessed", minimumComponentLevels: ["macro"], needsRepetitionSystems: false,
      needsMaterialLocalOverrides: false, needsMultipleReviewViews: true, needsActionReadyHierarchy: true,
      rationale: "Choose simple/moderate/complex/ultra-complex from observed structure.",
    },
    unknownsToResolveBeforeImplementation: [],
    detailInventory: { scanMethod: "component-zones", targetMinDetails: 0, details: [] },
    anatomy: {
      applies: false, styleHeads: 0,
      proportions: { headUnit: 0, torso: 0, legs: 0, shoulderWidth: 0, hipWidth: 0 },
      pose: { type: "unassessed", jointAngles: {} },
      faceLandmarks: { eyeLine: 0, eyeSpacing: 0, noseBase: 0, mouthLine: 0, hairline: 0 },
      features: [], confidence: 0,
    },
  };
}

/** targetMinDetails floor by complexity tier — upstream: simple 3, moderate
 * 6, complex 10, ultra-complex 16. */
export function targetMinDetailsFor(tier: ComplexityTier): number {
  switch (tier) {
    case "simple": return 3;
    case "moderate": return 6;
    case "complex": return 10;
    case "ultra-complex": return 16;
    default: return 3;
  }
}

/** Minimum spec-depth counts by tier — used by both the assessment skeleton
 * and the strict-quality gate. */
export function minimumSpecDepthFor(tier: ComplexityTier): QualityContract["minimumSpecDepth"] {
  switch (tier) {
    case "simple":
      return { macroComponents: 1, mesoComponents: 0, microFeatureGroups: 0, materialLayers: 1, repetitionSystems: 0, reviewViewpoints: 2 };
    case "moderate":
      return { macroComponents: 2, mesoComponents: 2, microFeatureGroups: 1, materialLayers: 2, repetitionSystems: 0, reviewViewpoints: 3 };
    case "complex":
      return { macroComponents: 3, mesoComponents: 4, microFeatureGroups: 3, materialLayers: 3, repetitionSystems: 1, reviewViewpoints: 3 };
    case "ultra-complex":
      return { macroComponents: 4, mesoComponents: 6, microFeatureGroups: 5, materialLayers: 4, repetitionSystems: 2, reviewViewpoints: 4 };
    default:
      return { macroComponents: 1, mesoComponents: 0, microFeatureGroups: 0, materialLayers: 1, repetitionSystems: 0, reviewViewpoints: 2 };
  }
}

export function makeQualityContract(tier: ComplexityTier = "unassessed"): QualityContract {
  return {
    qualityBar: tier,
    definitionOfDone: [],
    minimumSpecDepth: minimumSpecDepthFor(tier),
    featureGroups: [
      { id: "overall-silhouette", name: "Overall silhouette and proportions", required: true,
        qualityCriteria: ["silhouette outline matches reference within reasonable tolerance", "proportions/aspect ratio match"],
        evidenceRefs: ["full-object"], failureModes: ["wrong aspect ratio", "missing major silhouette feature"] },
      { id: "primary-structure", name: "Primary structure and hierarchy", required: true,
        qualityCriteria: ["every macro component present", "parent/child relationships correct"],
        evidenceRefs: ["full-object"], failureModes: ["missing component", "wrong hierarchy depth"] },
      { id: "attachment-joint-correctness", name: "Attachment and joint correctness", required: true,
        qualityCriteria: ["no floating parts", "child roots touch/embed at the correct parent socket"],
        evidenceRefs: ["full-object"], failureModes: ["mid-air appendage", "wrong pivot location"] },
      { id: "surface-material-response", name: "Surface material response", required: true,
        qualityCriteria: ["gloss/roughness reads correctly under light", "independent PBR channels, no aliasing"],
        evidenceRefs: ["full-object"], failureModes: ["albedo baked into roughness", "flat unlit look"] },
      { id: "reference-lookdev", name: "Reference color, material, and lighting response", required: true,
        qualityCriteria: ["palette matches reference", "key light direction plausible"],
        evidenceRefs: ["full-object"], failureModes: ["wrong hue family", "no shading gradient"] },
    ],
    visualDeltaChecks: ["silhouette IoU", "palette delta", "part presence"],
    antiShallowSpecRules: [
      "a complex object with a single root component and no repetition systems is not implementation-ready",
      "every detail inventory entry must map to a real component.localFeatures or material.localOverrides entry",
    ],
  };
}

export function newSculptSpec(name: string, sourceImage: string): ObjectSculptSpec {
  return {
    schemaVersion: "2.0",
    name,
    sourceImage,
    preSpecAssessment: makePreSpecAssessment(),
    qualityContract: makeQualityContract(),
    components: [],
    materials: [],
    repetitionSystems: [],
    featureReviewTargets: [],
    sculptPipeline: {
      passGateMode: "locked-sequential",
      passOrder: DEFAULT_PASS_ORDER,
      currentPass: "blockout",
      completedPasses: [],
      lastCompletedPass: "",
      blockedReason: "",
      nextRequiredEvidence: ["blockout render + comparison sheet"],
    },
    reviewHistory: [],
    selfCorrectLoop: {
      visualAcceptance: {
        threshold: 0.7,
        featureReviewPolicy: {
          enabled: true,
          maxCriticalFeaturesPerPass: 5,
          maxImportantFeaturesPerPass: 3,
          criticalDefaultThreshold: 0.8,
          importantAverageThreshold: 0.65,
        },
      },
    },
  };
}

export function componentById(spec: ObjectSculptSpec, id: string): SculptComponent | undefined {
  return spec.components.find((c) => c.id === id);
}
export function materialById(spec: ObjectSculptSpec, id: string): SculptMaterial | undefined {
  return spec.materials.find((m) => m.id === id);
}
export function childrenOf(spec: ObjectSculptSpec, parentId: string | null): SculptComponent[] {
  return spec.components.filter((c) => c.parent === parentId);
}

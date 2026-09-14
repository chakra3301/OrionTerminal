import { describe, expect, it } from "vitest";
import { newSculptSpec, type SculptComponent, type SculptMaterial } from "./sculptSpec";
import { validateSculptSpec } from "./validateSculptSpec";

function material(id: string): SculptMaterial {
  return { id, baseColor: "#888888", roughness: { base: 0.5, variation: 0.1 }, metalness: 0, opacity: { base: 1 }, localOverrides: [] };
}

function component(overrides: Partial<SculptComponent> = {}): SculptComponent {
  return {
    id: "c1", name: "Body", level: "macro", role: "shell", importance: "critical", confidence: 0.8,
    primitive: "box", topologyClass: "box-like", topologyRationale: "flat panel", parent: null, attachment: null,
    geometryDescriptor: { topologyIntent: "", edgeTreatment: { type: "none", bevelRadius: 0, segments: 1 }, deformationStack: [], uvStrategy: "", normalStrategy: "" },
    dimensions: { width: 1, height: 1, depth: 1, units: "relative", confidence: 0.8 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    actionProfile: {
      animationRole: "static", pivot: { mode: "center", localPosition: [0, 0, 0], axis: [0, 1, 0], confidence: 0.6 },
      transformChannels: { translate: true, rotate: true, scale: true, bend: false, twist: false, detach: false, visibility: true, materialState: false },
      sockets: [], collider: { type: "box", offset: [0, 0, 0], scale: [1, 1, 1], isTrigger: false, notes: "" },
      constraints: [], destruction: { breakable: false, fractureGroup: "c1", seamRefs: [], detachableFragments: [], breakImpulse: 0, debrisMaterial: "wood" },
    },
    material: "wood", localFeatures: [],
    surfaceDetail: { macroRoughness: 0, microRoughness: 0, bumpAmplitude: 0, normalPattern: "", displacementPattern: "", occlusionPattern: "", edgeWearPattern: "" },
    evidenceRefs: ["full-object"], fidelityTier: "blockout",
    ...overrides,
  };
}

describe("validateSculptSpec — structural", () => {
  it("rejects a spec with no components", () => {
    const spec = newSculptSpec("Empty", "ref.png");
    const result = validateSculptSpec(spec, false);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("no components"))).toBe(true);
  });

  it("rejects a component referencing an unknown material", () => {
    const spec = newSculptSpec("Box", "ref.png");
    spec.components = [component({ material: "does-not-exist" })];
    const result = validateSculptSpec(spec, false);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown material"))).toBe(true);
  });

  it("rejects a component with a dangling parent id", () => {
    const spec = newSculptSpec("Box", "ref.png");
    spec.materials = [material("wood")];
    spec.components = [component({ parent: "ghost-parent" })];
    const result = validateSculptSpec(spec, false);
    expect(result.errors.some((e) => e.includes("dangling parent"))).toBe(true);
  });

  it("accepts a minimal valid single-component spec", () => {
    const spec = newSculptSpec("Box", "ref.png");
    spec.materials = [material("wood")];
    spec.components = [component()];
    const result = validateSculptSpec(spec, false);
    expect(result.ok).toBe(true);
  });
});

describe("validateSculptSpec — strict quality", () => {
  it("blocks a complex-tier spec that is still a single root component", () => {
    const spec = newSculptSpec("Bike", "ref.png");
    spec.materials = [material("wood")];
    spec.components = [component()];
    spec.preSpecAssessment.complexity.tier = "complex";
    spec.qualityContract.minimumSpecDepth.macroComponents = 1;
    const result = validateSculptSpec(spec, true);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("single root component"))).toBe(true);
  });

  it("blocks generic feature-review target names", () => {
    const spec = newSculptSpec("Box", "ref.png");
    spec.materials = [material("wood")];
    spec.components = [component()];
    spec.featureReviewTargets = [{ id: "f1", name: "looks right", tier: "critical", passIds: ["blockout"], minimumScore: 0.8, evidenceRefs: [] }];
    const result = validateSculptSpec(spec, true);
    expect(result.errors.some((e) => e.includes("too generic"))).toBe(true);
  });

  it("blocks an appendage component with no attachment contract", () => {
    const spec = newSculptSpec("Mug", "ref.png");
    spec.materials = [material("wood")];
    spec.components = [
      component(),
      component({ id: "handle", name: "Handle", parent: "c1", role: "handle", primitive: "tube" }),
    ];
    spec.featureReviewTargets = [{ id: "f1", name: "Handle attachment fidelity", tier: "critical", passIds: ["blockout"], minimumScore: 0.8, evidenceRefs: [] }];
    const result = validateSculptSpec(spec, true);
    expect(result.errors.some((e) => e.includes("attachment contract"))).toBe(true);
  });

  it("requires a filled anatomy block for a character-domain spec", () => {
    const spec = newSculptSpec("Hero", "ref.png");
    spec.materials = [material("skin")];
    spec.components = [component({ material: "skin" })];
    spec.preSpecAssessment.objectClass.primaryDomain = "character";
    spec.featureReviewTargets = [{ id: "f1", name: "Head proportions", tier: "critical", passIds: ["blockout"], minimumScore: 0.8, evidenceRefs: [] }];
    const result = validateSculptSpec(spec, true);
    expect(result.errors.some((e) => e.includes("anatomy block"))).toBe(true);
  });
});

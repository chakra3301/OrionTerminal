import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { newSculptSpec, type SculptComponent, type SculptMaterial } from "./sculptSpec";
import { buildSculptModel, type ProceduralModelRuntime } from "./factoryBuilder";

function material(id: string, baseColor = "#ff0000"): SculptMaterial {
  return { id, baseColor, roughness: { base: 0.4, variation: 0 }, metalness: 0, opacity: { base: 1 }, localOverrides: [] };
}

function component(overrides: Partial<SculptComponent> = {}): SculptComponent {
  return {
    id: "body", name: "Body", level: "macro", role: "shell", importance: "critical", confidence: 0.8,
    primitive: "box", topologyClass: "box-like", topologyRationale: "", parent: null, attachment: null,
    geometryDescriptor: { topologyIntent: "", edgeTreatment: { type: "none", bevelRadius: 0, segments: 1 }, deformationStack: [], uvStrategy: "", normalStrategy: "" },
    dimensions: { width: 1, height: 1, depth: 1, units: "relative", confidence: 0.8 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    actionProfile: {
      animationRole: "static", pivot: { mode: "center", localPosition: [0, 0, 0], axis: [0, 1, 0], confidence: 0.6 },
      transformChannels: { translate: true, rotate: true, scale: true, bend: false, twist: false, detach: false, visibility: true, materialState: false },
      sockets: [{ id: "top", localPosition: [0, 0.5, 0], localRotation: [0, 0, 0], kind: "attach" }],
      collider: { type: "box", offset: [0, 0, 0], scale: [1, 1, 1], isTrigger: false, notes: "" },
      constraints: [], destruction: { breakable: true, fractureGroup: "body-frac", seamRefs: [], detachableFragments: [], breakImpulse: 1, debrisMaterial: "wood" },
    },
    material: "wood", localFeatures: [],
    surfaceDetail: { macroRoughness: 0, microRoughness: 0, bumpAmplitude: 0, normalPattern: "", displacementPattern: "", occlusionPattern: "", edgeWearPattern: "" },
    evidenceRefs: [], fidelityTier: "blockout",
    ...overrides,
  };
}

function twoComponentSpec() {
  const spec = newSculptSpec("Box", "ref.png");
  spec.materials = [material("wood", "#8b5a2b")];
  spec.components = [
    component({ id: "body", level: "macro" }),
    component({ id: "detail", name: "Cap", level: "micro", parent: "body", primitive: "sphere" }),
  ];
  return spec;
}

describe("buildSculptModel — pass gating", () => {
  it("blockout: only macro components appear, materials are flat gray", () => {
    const spec = twoComponentSpec();
    spec.sculptPipeline.currentPass = "blockout";
    const root = buildSculptModel(spec);
    const runtime = root.userData.sculptRuntime as ProceduralModelRuntime;
    expect(Object.keys(runtime.nodes)).toEqual(["body"]);
    const mesh = runtime.meshes.body as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe("8a8a8a");
  });

  it("structural-pass: meso/micro components appear too", () => {
    const spec = twoComponentSpec();
    spec.sculptPipeline.currentPass = "structural-pass";
    const root = buildSculptModel(spec);
    const runtime = root.userData.sculptRuntime as ProceduralModelRuntime;
    expect(Object.keys(runtime.nodes).sort()).toEqual(["body", "detail"]);
  });

  it("material-pass: real material colors are applied", () => {
    const spec = twoComponentSpec();
    spec.sculptPipeline.currentPass = "material-pass";
    const root = buildSculptModel(spec);
    const runtime = root.userData.sculptRuntime as ProceduralModelRuntime;
    const mesh = runtime.meshes.body as THREE.Mesh;
    const mat = mesh.material as THREE.MeshPhysicalMaterial;
    expect(mat.color.getHexString()).toBe("8b5a2b");
  });

  it("interaction-pass: sockets and destruction groups populate sculptRuntime", () => {
    const spec = twoComponentSpec();
    spec.sculptPipeline.currentPass = "interaction-pass";
    const root = buildSculptModel(spec);
    const runtime = root.userData.sculptRuntime as ProceduralModelRuntime;
    expect(runtime.sockets["body:top"]).toBeDefined();
    expect(runtime.colliders.body).toBeDefined();
    expect(runtime.destructionGroups["body-frac"]).toBeDefined();
  });

  it("root scale is always [1,1,1] — never hides the container via scale", () => {
    const spec = twoComponentSpec();
    const root = buildSculptModel(spec);
    expect(root.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("lighting-pass adds a lights group; blockout does not", () => {
    const spec = twoComponentSpec();
    spec.sculptPipeline.currentPass = "blockout";
    const noLights = buildSculptModel(spec);
    expect(noLights.getObjectByName("lights")).toBeUndefined();
    spec.sculptPipeline.currentPass = "lighting-pass";
    const withLights = buildSculptModel(spec);
    expect(withLights.getObjectByName("lights")).toBeDefined();
  });
});

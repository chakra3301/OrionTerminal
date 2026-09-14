import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildAttachedMember, buildBeveledBox, buildInstancedRepetition, buildPrimitiveGeometry } from "./geometryPatterns";
import type { SculptComponent } from "./sculptSpec";

function baseComponent(overrides: Partial<SculptComponent> = {}): SculptComponent {
  return {
    id: "c1", name: "Part", level: "macro", role: "shell", importance: "critical", confidence: 0.8,
    primitive: "box", topologyClass: "box-like", topologyRationale: "", parent: null, attachment: null,
    geometryDescriptor: { topologyIntent: "", edgeTreatment: { type: "none", bevelRadius: 0, segments: 1 }, deformationStack: [], uvStrategy: "", normalStrategy: "" },
    dimensions: { width: 1, height: 0.5, depth: 0.3, units: "relative", confidence: 0.8 },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    actionProfile: {
      animationRole: "static", pivot: { mode: "center", localPosition: [0, 0, 0], axis: [0, 1, 0], confidence: 0.6 },
      transformChannels: { translate: true, rotate: true, scale: true, bend: false, twist: false, detach: false, visibility: true, materialState: false },
      sockets: [], collider: { type: "box", offset: [0, 0, 0], scale: [1, 1, 1], isTrigger: false, notes: "" },
      constraints: [], destruction: { breakable: false, fractureGroup: "c1", seamRefs: [], detachableFragments: [], breakImpulse: 0, debrisMaterial: "m" },
    },
    material: "m", localFeatures: [],
    surfaceDetail: { macroRoughness: 0, microRoughness: 0, bumpAmplitude: 0, normalPattern: "", displacementPattern: "", occlusionPattern: "", edgeWearPattern: "" },
    evidenceRefs: [], fidelityTier: "blockout",
    ...overrides,
  };
}

describe("buildPrimitiveGeometry", () => {
  it("builds a box with position attributes for the box primitive", () => {
    const geo = buildPrimitiveGeometry(baseComponent());
    expect(geo.getAttribute("position").count).toBeGreaterThan(0);
  });
  it("builds a sphere for the sphere primitive", () => {
    const geo = buildPrimitiveGeometry(baseComponent({ primitive: "sphere" }));
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute("position").count).toBeGreaterThan(8);
  });
  it("builds a bevel-aware cylinder for the cylinder primitive with a chamfer requested", () => {
    const geo = buildPrimitiveGeometry(baseComponent({
      primitive: "cylinder",
      geometryDescriptor: { topologyIntent: "", edgeTreatment: { type: "chamfer", bevelRadius: 0.05, segments: 2 }, deformationStack: [], uvStrategy: "", normalStrategy: "" },
    }));
    expect(geo.getAttribute("position").count).toBeGreaterThan(0);
  });
});

describe("buildBeveledBox", () => {
  it("falls back to a plain BoxGeometry when no bevel is requested", () => {
    const geo = buildBeveledBox(1, 1, 1, { type: "none", bevelRadius: 0, segments: 1 });
    expect(geo).toBeInstanceOf(THREE.BoxGeometry);
  });
  it("produces real extra geometry (more verts) when a chamfer is requested", () => {
    const flat = buildBeveledBox(1, 1, 1, { type: "none", bevelRadius: 0, segments: 1 });
    const chamfered = buildBeveledBox(1, 1, 1, { type: "chamfer", bevelRadius: 0.1, segments: 3 });
    expect(chamfered.getAttribute("position").count).toBeGreaterThan(flat.getAttribute("position").count);
  });
});

describe("buildAttachedMember", () => {
  it("pivots at localStart and orients toward localEnd, matching the segment length", () => {
    const member = buildAttachedMember([0, 0, 0], [0, 2, 0], 0.1, 0.05);
    expect(member.pivot.toArray()).toEqual([0, 0, 0]);
    expect(member.length).toBeCloseTo(2, 5);
  });
  it("orients a horizontal member with a 90-degree-ish rotation off the default Y axis", () => {
    const vertical = buildAttachedMember([0, 0, 0], [0, 1, 0], 0.1, 0.1);
    const horizontal = buildAttachedMember([0, 0, 0], [1, 0, 0], 0.1, 0.1);
    expect(vertical.quaternion.equals(horizontal.quaternion)).toBe(false);
  });
});

describe("buildInstancedRepetition", () => {
  it("creates an InstancedMesh with the requested instance count", () => {
    const mat = new THREE.MeshStandardMaterial();
    const mesh = buildInstancedRepetition(
      new THREE.SphereGeometry(0.02, 6, 4), mat, 12, "radial",
      { w: 1, h: 1, d: 1 }, { scale: 0.1, rotation: 0.2, positionJitter: 0.01 }, 7,
    );
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.count).toBe(12);
  });
  it("is deterministic for a fixed seed", () => {
    const mat = new THREE.MeshStandardMaterial();
    const a = buildInstancedRepetition(new THREE.SphereGeometry(0.02, 6, 4), mat, 5, "scatter", { w: 1, h: 1, d: 1 }, { scale: 0.1, rotation: 0.2, positionJitter: 0.05 }, 42);
    const b = buildInstancedRepetition(new THREE.SphereGeometry(0.02, 6, 4), mat, 5, "scatter", { w: 1, h: 1, d: 1 }, { scale: 0.1, rotation: 0.2, positionJitter: 0.05 }, 42);
    const ma = new THREE.Matrix4(), mb = new THREE.Matrix4();
    a.getMatrixAt(2, ma); b.getMatrixAt(2, mb);
    expect(ma.equals(mb)).toBe(true);
  });
});

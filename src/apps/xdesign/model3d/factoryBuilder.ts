/**
 * Port of img2threejs `forge/stage3_build/generate_threejs_factory.py` —
 * builds the `THREE.Group` for the CURRENT UNLOCKED PASS ONLY (a future
 * pass's fidelity — real materials before `material-pass`, real lights
 * before `lighting-pass` — never leaks into an earlier pass's review, or
 * the comparison sheet would be judging fidelity the pass hasn't earned
 * yet). Exposes `root.userData.sculptRuntime` — nodes/meshes/sockets/
 * colliders/destructionGroups — building an action-ready hierarchy per
 * `grimoire/readiness/action_rigging.md`, never an inert lump.
 *
 * Divergence from upstream (documented): the Python skill emits a
 * from-scratch literal TypeScript file per pass (string-templated
 * `new THREE.BoxGeometry(...)` calls). We build the SAME structure live, in
 * one runtime (`buildSculptModel` below), and `emitFactorySource` exports a
 * thin TS file that imports this module and calls it with the embedded
 * spec JSON. One implementation instead of two parallel code paths that
 * would drift — the exported file is still diffable/version-controllable
 * (the deliverable upstream promises), it just delegates instead of
 * re-deriving.
 */

import * as THREE from "three";
import type { ObjectSculptSpec, PassId, SculptComponent } from "./sculptSpec";
import { passOrderFor } from "./passOrchestrator";
import { buildAttachedMember, buildInstancedRepetition, buildPrimitiveGeometry } from "./geometryPatterns";
import { buildMaterial } from "./materialBuild";

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh | THREE.InstancedMesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, SculptComponent["actionProfile"]["collider"]>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

function passRank(order: PassId[], passId: PassId | "complete"): number {
  if (passId === "complete") return order.length;
  const i = order.indexOf(passId);
  return i < 0 ? 0 : i;
}
function atLeast(order: PassId[], current: PassId | "complete", target: PassId): boolean {
  return passRank(order, current) >= passRank(order, target as PassId | "complete");
}

const FLAT_GRAY = new THREE.MeshStandardMaterial({ color: "#8a8a8a", roughness: 0.7, metalness: 0.05 });

function buildLights(_spec: ObjectSculptSpec): THREE.Group {
  const g = new THREE.Group();
  g.name = "lights";
  const key = new THREE.DirectionalLight("#fff2e0", 1.1);
  key.position.set(2, 3, 2.5);
  const fill = new THREE.DirectionalLight("#cfe8ff", 0.35);
  fill.position.set(-2.5, 1, -1.5);
  const rim = new THREE.DirectionalLight("#ffffff", 0.5);
  rim.position.set(0, 1.5, -3);
  const ambient = new THREE.AmbientLight("#404040", 0.4);
  g.add(key, fill, rim, ambient);
  g.userData.reviewMode = "lit";
  g.userData.lightingFromPhoto = { keyDirection: "upper-right, matched to reference specular hotspot", note: "heuristic 3-point rig; refine key azimuth against the reference's own highlight position" };
  return g;
}

/** Build the live model for the spec's CURRENT unlocked pass. Pure w.r.t.
 * inputs (always constructs fresh THREE objects) — caller owns disposal of
 * the previous root when rebuilding. */
export function buildSculptModel(spec: ObjectSculptSpec): THREE.Group {
  const order = passOrderFor(spec);
  const current = spec.sculptPipeline.currentPass;
  const structuralUnlocked = atLeast(order, current, "structural-pass");
  const formUnlocked = atLeast(order, current, "form-refinement");
  const materialUnlocked = atLeast(order, current, "material-pass");
  const surfaceUnlocked = atLeast(order, current, "surface-pass");
  const lightingUnlocked = atLeast(order, current, "lighting-pass");
  const interactionUnlocked = atLeast(order, current, "interaction-pass");

  const root = new THREE.Group();
  root.name = spec.name || "SculptModel";
  root.scale.set(1, 1, 1); // NEVER hide the root via scale — see geometryPatterns.md hard-won pattern

  const runtime: ProceduralModelRuntime = { nodes: {}, meshes: {}, sockets: {}, colliders: {}, destructionGroups: {} };
  const materialCache = new Map<string, THREE.Material>();
  const getMaterial = (id: string): THREE.Material => {
    if (!materialUnlocked) return FLAT_GRAY;
    if (materialCache.has(id)) return materialCache.get(id)!;
    const spec_ = spec.materials.find((m) => m.id === id);
    const mat = spec_ ? buildMaterial(spec_) : FLAT_GRAY;
    materialCache.set(id, mat);
    return mat;
  };

  // Blockout: macro components only, as simple boxes sized to `dimensions`.
  const visibleComponents = structuralUnlocked
    ? spec.components
    : spec.components.filter((c) => c.level === "macro");

  // Build parent-first so children can look up their parent node.
  const byId = new Map(spec.components.map((c) => [c.id, c]));
  const built = new Set<string>();
  const buildOrder: SculptComponent[] = [];
  const visit = (c: SculptComponent) => {
    if (built.has(c.id)) return;
    if (c.parent && byId.has(c.parent) && !built.has(c.parent)) visit(byId.get(c.parent)!);
    built.add(c.id);
    buildOrder.push(c);
  };
  for (const c of visibleComponents) visit(c);

  for (const c of buildOrder) {
    if (!visibleComponents.includes(c)) continue;
    const parentNode = c.parent && runtime.nodes[c.parent] ? runtime.nodes[c.parent]! : root;

    const pivot = new THREE.Group();
    pivot.name = `${c.name}-pivot`;
    pivot.userData.sculptComponent = c;
    pivot.userData.actionProfile = c.actionProfile;

    let geometry: THREE.BufferGeometry;
    let localOrigin: THREE.Vector3 | null = null;
    let quat: THREE.Quaternion | null = null;
    if (structuralUnlocked && c.attachment && formUnlocked) {
      const member = buildAttachedMember(
        c.attachment.localStart, c.attachment.localEnd,
        c.attachment.baseRadius ?? c.dimensions.width / 2, c.attachment.endRadius ?? c.dimensions.width / 2,
      );
      geometry = member.geometry;
      localOrigin = member.pivot;
      quat = member.quaternion;
    } else {
      geometry = formUnlocked ? buildPrimitiveGeometry(c) : new THREE.BoxGeometry(c.dimensions.width, c.dimensions.height, c.dimensions.depth);
    }

    const mesh = new THREE.Mesh(geometry, getMaterial(c.material));
    mesh.name = c.name;
    mesh.userData.sculptComponent = c;
    pivot.add(mesh);

    if (localOrigin && quat) {
      pivot.position.copy(localOrigin);
      pivot.quaternion.copy(quat);
    } else {
      pivot.position.set(...c.transform.position);
      pivot.rotation.set(...c.transform.rotation);
      pivot.scale.set(...c.transform.scale);
    }

    parentNode.add(pivot);
    runtime.nodes[c.id] = pivot;
    runtime.meshes[c.id] = mesh;

    // Surface-pass: local features (grooves/ridges/instanced fasteners).
    if (surfaceUnlocked) {
      for (const feature of c.localFeatures) {
        if (feature.instancing) {
          const inst = buildInstancedRepetition(
            new THREE.SphereGeometry(0.01, 8, 6), getMaterial(c.material),
            feature.instancing.count, feature.instancing.distribution,
            { w: c.dimensions.width, h: c.dimensions.height, d: c.dimensions.depth },
            { scale: 0.15, rotation: 0.3, positionJitter: 0.01 }, hashSeed(feature.id),
          );
          inst.name = `${c.name}-${feature.kind}`;
          pivot.add(inst);
        }
      }
    }

    // Interaction-pass: sockets + colliders + destruction groups.
    if (interactionUnlocked) {
      for (const s of c.actionProfile.sockets) {
        const socketObj = new THREE.Object3D();
        socketObj.name = `socket-${s.id}`;
        socketObj.position.set(...s.localPosition);
        socketObj.rotation.set(...s.localRotation);
        socketObj.userData.socket = s;
        pivot.add(socketObj);
        runtime.sockets[`${c.id}:${s.id}`] = socketObj;
      }
      runtime.colliders[c.id] = c.actionProfile.collider;
      if (c.actionProfile.destruction.breakable) {
        const group = c.actionProfile.destruction.fractureGroup || c.id;
        (runtime.destructionGroups[group] ??= []).push(mesh);
      }
    }
  }

  root.userData.sculptRuntime = runtime;
  root.userData.actionReadiness = {
    note: "Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.",
  };
  root.userData.sculptSpecName = spec.name;
  root.userData.currentPass = current;

  if (lightingUnlocked) root.add(buildLights(spec));

  return root;
}

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return h || 1;
}

/** Thin, diffable TS export — delegates to `buildSculptModel` above with
 * the spec embedded as JSON (see module doc for why this isn't a from-
 * scratch code emission like upstream's Python generator). */
export function emitFactorySource(spec: ObjectSculptSpec): string {
  const fnName = `create${pascal(spec.name || "Object")}Model`;
  return `// Generated by XDesign's img2model pipeline (img2threejs-inspired).
// Pass "${spec.sculptPipeline.currentPass}" — regenerate after further review passes.
import { buildSculptModel, type ProceduralModelRuntime } from "@/apps/xdesign/model3d/factoryBuilder";
import type { ObjectSculptSpec } from "@/apps/xdesign/model3d/sculptSpec";

export const ${fnName}Spec: ObjectSculptSpec = ${JSON.stringify(spec, null, 2)};

/** root.userData.sculptRuntime: ProceduralModelRuntime — nodes/meshes/sockets/colliders/destructionGroups. */
export function ${fnName}() {
  return buildSculptModel(${fnName}Spec);
}
`;
}

function pascal(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase());
}

/**
 * Live state for the open img2model project — one spec at a time, mirrors
 * `useFxStore`'s pattern (the projects store hydrates/flushes it on
 * switch). The live `THREE.Group` is rebuilt from `spec` on every relevant
 * mutation via `rebuild()` — it is NOT persisted (only the spec JSON is;
 * the group is cheap to reconstruct deterministically).
 */

import { create } from "zustand";
import * as THREE from "three";
import { newSculptSpec, type ObjectSculptSpec } from "./sculptSpec";
import { buildSculptModel } from "./factoryBuilder";
import { syncPipeline } from "./passOrchestrator";

export type ModelDoc = { spec: ObjectSculptSpec; reference?: Omit<ReferenceImage, "dataUrl"> | null };

export function emptyModelDoc(name = "Untitled Model"): ModelDoc {
  return { spec: newSculptSpec(name, "") };
}

/** `filePath` is ALWAYS a normalized, guaranteed-PNG snapshot written by
 * `ModelStudio.tsx::loadReferenceFromPath` (not necessarily the original
 * asset's own file) — `claude_send`'s image attach hardcodes PNG, so a
 * mismatched source format could hang that turn. `assetId` still points at
 * the original ingested asset for library linkage. */
export type ReferenceImage = { assetId: string | null; filePath: string; dataUrl: string; w: number; h: number };

type ModelState = {
  spec: ObjectSculptSpec;
  reference: ReferenceImage | null;
  root: THREE.Group | null;
  rebuildNonce: number;
  showReferenceOverlay: boolean;
  orbitAutoSpin: boolean;

  hydrateModel: (doc: ModelDoc) => void;
  setSpec: (spec: ObjectSculptSpec) => void;
  patchSpec: (patch: (spec: ObjectSculptSpec) => ObjectSculptSpec) => void;
  setReference: (ref: ReferenceImage | null) => void;
  rebuild: () => void;
  setShowReferenceOverlay: (v: boolean) => void;
  setOrbitAutoSpin: (v: boolean) => void;
};

export const useModelStore = create<ModelState>((set, get) => ({
  spec: newSculptSpec("Untitled Model", ""),
  reference: null,
  root: null,
  rebuildNonce: 0,
  showReferenceOverlay: true,
  orbitAutoSpin: true,

  hydrateModel: (doc) => {
    const root = buildSculptModel(doc.spec);
    const previous = get().root;
    set((s) => ({ spec: doc.spec, reference: doc.reference ? { ...doc.reference, dataUrl: doc.spec.sourceImage } : null,
      root, rebuildNonce: s.rebuildNonce + 1 }));
    if (previous) disposeGroup(previous);
  },
  setSpec: (spec) => {
    set({ spec: syncPipeline(spec) });
    get().rebuild();
  },
  patchSpec: (patch) => {
    set((s) => ({ spec: syncPipeline(patch(s.spec)) }));
    get().rebuild();
  },
  setReference: (ref) => set((s) => ({ reference: ref, spec: ref ? { ...s.spec, sourceImage: ref.dataUrl } : s.spec })),
  rebuild: () => {
    const prev = get().root;
    const root = buildSculptModel(get().spec);
    if (prev) disposeGroup(prev);
    set((s) => ({ root, rebuildNonce: s.rebuildNonce + 1 }));
  },
  setShowReferenceOverlay: (v) => set({ showReferenceOverlay: v }),
  setOrbitAutoSpin: (v) => set({ orbitAutoSpin: v }),
}));

export function snapshotModelDoc(): ModelDoc {
  const { spec, reference } = useModelStore.getState();
  const savedReference = reference ? { assetId: reference.assetId, filePath: reference.filePath, w: reference.w, h: reference.h } : null;
  return { spec, reference: savedReference };
}

function disposeGroup(root: THREE.Group): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        for (const value of Object.values(m)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        m.dispose();
      }
    }
  });
}

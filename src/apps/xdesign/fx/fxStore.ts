/**
 * Live state for the open FX scene. One scene at a time (mirrors how
 * `useXDesign` holds one design doc); the projects store hydrates/flushes
 * it when switching projects. Undo/redo intentionally deferred to a later
 * slice — noted in the tracker.
 */

import { create } from "zustand";
import { ulid } from "ulid";
import {
  emptyScene,
  defaultParams,
  type FxDoc,
  type FxLayer,
  type FxParamValue,
  type FxScene,
} from "./fxModel";
import { fxEffect, FX_EFFECTS } from "./fxRegistry";

type ScenePatch = Partial<
  Pick<FxScene, "width" | "height" | "background" | "dpi" | "fps">
>;
type LayerPatch = Partial<Pick<FxLayer, "name" | "hidden" | "opacity" | "blend">>;

type FxState = {
  scene: FxScene;
  selectedLayerId: string | null;
  playing: boolean;

  addLayer: (effectId: string) => void;
  removeLayer: (id: string) => void;
  patchLayer: (id: string, patch: LayerPatch) => void;
  setParam: (id: string, key: string, value: FxParamValue) => void;
  /** dir +1 moves toward the top of the stack (later in render order). */
  moveLayer: (id: string, dir: 1 | -1) => void;
  selectLayer: (id: string | null) => void;
  setPlaying: (playing: boolean) => void;
  patchScene: (patch: ScenePatch) => void;
  hydrateFx: (doc: FxDoc) => void;
};

/** Unique layer name within the scene: "Gradient", "Gradient 2", … */
function uniqueLayerName(layers: FxLayer[], base: string): string {
  const names = new Set(layers.map((l) => l.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Drop layers whose effect no longer exists (registry renames/removals)
 * and backfill any params added since the doc was saved. */
export function sanitizeScene(scene: FxScene): FxScene {
  const layers = scene.layers
    .filter((l) => fxEffect(l.effectId))
    .map((l) => ({
      ...l,
      params: { ...defaultParams(fxEffect(l.effectId)!), ...l.params },
    }));
  return { ...emptyScene(), ...scene, layers };
}

export const useFxStore = create<FxState>((set, get) => ({
  scene: emptyScene(),
  selectedLayerId: null,
  playing: true,

  addLayer: (effectId) => {
    const spec = fxEffect(effectId);
    if (!spec) return;
    const layer: FxLayer = {
      id: ulid(),
      effectId,
      name: uniqueLayerName(get().scene.layers, spec.label),
      opacity: 1,
      params: defaultParams(spec),
    };
    set((s) => ({
      scene: { ...s.scene, layers: [...s.scene.layers, layer] },
      selectedLayerId: layer.id,
    }));
  },

  removeLayer: (id) =>
    set((s) => ({
      scene: { ...s.scene, layers: s.scene.layers.filter((l) => l.id !== id) },
      selectedLayerId: s.selectedLayerId === id ? null : s.selectedLayerId,
    })),

  patchLayer: (id, patch) =>
    set((s) => ({
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      },
    })),

  setParam: (id, key, value) =>
    set((s) => ({
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) =>
          l.id === id ? { ...l, params: { ...l.params, [key]: value } } : l,
        ),
      },
    })),

  moveLayer: (id, dir) =>
    set((s) => {
      const layers = [...s.scene.layers];
      const i = layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= layers.length) return s;
      [layers[i], layers[j]] = [layers[j]!, layers[i]!];
      return { scene: { ...s.scene, layers } };
    }),

  selectLayer: (id) => set({ selectedLayerId: id }),
  setPlaying: (playing) => set({ playing }),

  patchScene: (patch) => set((s) => ({ scene: { ...s.scene, ...patch } })),

  hydrateFx: (doc) =>
    set({
      scene: sanitizeScene(doc.scene),
      selectedLayerId: null,
      playing: true,
    }),
}));

export function snapshotFxDoc(): FxDoc {
  return { scene: useFxStore.getState().scene };
}

/** Fresh scene with a default gradient layer so a new FX project renders
 * something alive immediately (Unicorn does the same). */
export function emptyFxDoc(): FxDoc {
  const scene = emptyScene();
  const spec = FX_EFFECTS.find((s) => s.id === "gradient");
  if (spec) {
    scene.layers.push({
      id: ulid(),
      effectId: spec.id,
      name: spec.label,
      opacity: 1,
      params: defaultParams(spec),
    });
  }
  return { scene };
}

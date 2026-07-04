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
  type FxBinding,
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
  /** Bumps to restart scene time (re-fires appear bindings). */
  restartNonce: number;

  addLayer: (effectId: string) => void;
  removeLayer: (id: string) => void;
  patchLayer: (id: string, patch: LayerPatch) => void;
  setParam: (id: string, key: string, value: FxParamValue) => void;
  /** null removes the binding for that param. */
  setBinding: (id: string, key: string, binding: FxBinding | null) => void;
  restart: () => void;
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

/** Drop layers whose effect no longer exists (registry renames/removals),
 * backfill any params added since the doc was saved, and strip bindings
 * that point at params that are gone or non-numeric. */
export function sanitizeScene(scene: FxScene): FxScene {
  const layers = scene.layers
    .filter((l) => fxEffect(l.effectId))
    .map((l) => {
      const spec = fxEffect(l.effectId)!;
      let bindings = l.bindings;
      if (bindings) {
        const valid = Object.entries(bindings).filter(([key]) => {
          const p = spec.params.find((q) => q.key === key);
          return p?.type === "number";
        });
        bindings = valid.length > 0 ? Object.fromEntries(valid) : undefined;
      }
      return {
        ...l,
        params: { ...defaultParams(spec), ...l.params },
        ...(bindings ? { bindings } : { bindings: undefined }),
      };
    });
  return { ...emptyScene(), ...scene, layers };
}

export const useFxStore = create<FxState>((set, get) => ({
  scene: emptyScene(),
  selectedLayerId: null,
  playing: true,
  restartNonce: 0,

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

  setBinding: (id, key, binding) =>
    set((s) => ({
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) => {
          if (l.id !== id) return l;
          const bindings = { ...l.bindings };
          if (binding) bindings[key] = binding;
          else delete bindings[key];
          return {
            ...l,
            bindings: Object.keys(bindings).length > 0 ? bindings : undefined,
          };
        }),
      },
    })),

  restart: () => set((s) => ({ restartNonce: s.restartNonce + 1 })),

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

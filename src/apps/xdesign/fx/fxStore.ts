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
  type FxKeyframe,
  type FxLayer,
  type FxParamValue,
  type FxScene,
} from "./fxModel";
import { upsertKeyframe } from "./fxTimeline";
import { fxEffect, FX_EFFECTS } from "./fxRegistry";

type ScenePatch = Partial<
  Pick<FxScene, "width" | "height" | "background" | "dpi" | "fps" | "duration">
>;
type LayerPatch = Partial<Pick<FxLayer, "name" | "hidden" | "opacity" | "blend">>;

type FxState = {
  scene: FxScene;
  selectedLayerId: string | null;
  playing: boolean;
  /** Bumps to restart scene time (re-fires appear bindings). */
  restartNonce: number;
  /** Non-null while the user drags the timeline scrubber (seconds). The
   * viewport pins scene time to it. Transient — never persisted. */
  scrubTime: number | null;
  /** Perf HUD visibility. Transient. */
  showPerf: boolean;
  /** Mic reactivity on. Transient. */
  audioOn: boolean;

  addLayer: (effectId: string) => void;
  addImageLayer: (filePath: string, name?: string) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  /** Re-roll every number/color/select param within its legal range
   * (text/image/code untouched) — the exploration dice. */
  randomizeLayer: (id: string) => void;
  resetParam: (id: string, key: string) => void;
  patchLayer: (id: string, patch: LayerPatch) => void;
  setParam: (id: string, key: string, value: FxParamValue) => void;
  /** null removes the binding for that param. */
  setBinding: (id: string, key: string, binding: FxBinding | null) => void;
  restart: () => void;
  setScrub: (t: number | null) => void;
  setShowPerf: (v: boolean) => void;
  setAudioOn: (v: boolean) => void;
  /** Insert/replace a key for a param at normalized t (0..1). */
  addKeyframe: (id: string, key: string, kf: FxKeyframe) => void;
  /** Remove one key by index, or all keys for the param when index is -1. */
  removeKeyframe: (id: string, key: string, index: number) => void;
  setMask: (id: string, maskLayerId: string | null) => void;
  /** dir +1 moves toward the top of the stack (later in render order). */
  moveLayer: (id: string, dir: 1 | -1) => void;
  selectLayer: (id: string | null) => void;
  setPlaying: (playing: boolean) => void;
  patchScene: (patch: ScenePatch) => void;
  hydrateFx: (doc: FxDoc) => void;
};

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

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
      const numericKey = (key: string) => {
        const p = spec.params.find((q) => q.key === key);
        return p?.type === "number";
      };
      let bindings = l.bindings;
      if (bindings) {
        const valid = Object.entries(bindings).filter(([key]) => numericKey(key));
        bindings = valid.length > 0 ? Object.fromEntries(valid) : undefined;
      }
      let keyframes = l.keyframes;
      if (keyframes) {
        const valid = Object.entries(keyframes)
          .filter(([key, kfs]) => numericKey(key) && kfs.length > 0)
          .map(([key, kfs]) => [key, [...kfs].sort((a, b) => a.t - b.t)] as const);
        keyframes = valid.length > 0 ? Object.fromEntries(valid) : undefined;
      }
      return {
        ...l,
        params: { ...defaultParams(spec), ...l.params },
        ...(bindings ? { bindings } : { bindings: undefined }),
        ...(keyframes ? { keyframes } : { keyframes: undefined }),
      };
    });
  // Masks must point at a still-existing SOURCE layer (and never at self).
  const ids = new Set(layers.map((l) => l.id));
  const sane = layers.map((l) => {
    if (!l.maskLayerId) return l;
    const ok =
      l.maskLayerId !== l.id &&
      ids.has(l.maskLayerId) &&
      fxEffect(layers.find((m) => m.id === l.maskLayerId)!.effectId)?.category ===
        "source";
    return ok ? l : { ...l, maskLayerId: undefined };
  });
  return { ...emptyScene(), ...scene, layers: sane };
}

export const useFxStore = create<FxState>((set, get) => ({
  scene: emptyScene(),
  selectedLayerId: null,
  playing: true,
  restartNonce: 0,
  scrubTime: null,
  showPerf: false,
  audioOn: false,

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

  addImageLayer: (filePath, name) => {
    const spec = fxEffect("srcImage");
    if (!spec) return;
    const baseName = name?.trim() || spec.label;
    const layer: FxLayer = {
      id: ulid(),
      effectId: spec.id,
      name: uniqueLayerName(get().scene.layers, baseName),
      opacity: 1,
      params: { ...defaultParams(spec), file: filePath },
    };
    set((s) => ({
      scene: { ...s.scene, layers: [...s.scene.layers, layer] },
      selectedLayerId: layer.id,
    }));
  },

  duplicateLayer: (id) =>
    set((s) => {
      const i = s.scene.layers.findIndex((l) => l.id === id);
      const src = s.scene.layers[i];
      if (!src) return s;
      const copy: FxLayer = {
        ...src,
        id: ulid(),
        name: uniqueLayerName(s.scene.layers, src.name),
        params: { ...src.params },
        bindings: src.bindings ? { ...src.bindings } : undefined,
        keyframes: src.keyframes
          ? Object.fromEntries(
              Object.entries(src.keyframes).map(([k, v]) => [k, v.map((kf) => ({ ...kf }))]),
            )
          : undefined,
      };
      const layers = [...s.scene.layers];
      layers.splice(i + 1, 0, copy);
      return { scene: { ...s.scene, layers }, selectedLayerId: copy.id };
    }),

  randomizeLayer: (id) =>
    set((s) => ({
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) => {
          if (l.id !== id) return l;
          const spec = fxEffect(l.effectId);
          if (!spec) return l;
          const params = { ...l.params };
          for (const p of spec.params) {
            if (p.hidden) continue;
            if (p.type === "number") {
              const v = p.min + Math.random() * (p.max - p.min);
              const snapped = Math.round(v / p.step) * p.step;
              params[p.key] = Number(snapped.toFixed(4));
            } else if (p.type === "color") {
              const h = Math.floor(Math.random() * 360);
              const sMax = 60 + Math.random() * 40;
              const lit = 35 + Math.random() * 40;
              params[p.key] = hslToHex(h, sMax, lit);
            } else if (p.type === "select") {
              const o = p.options[Math.floor(Math.random() * p.options.length)];
              if (o) params[p.key] = o.value;
            }
          }
          return { ...l, params };
        }),
      },
    })),

  resetParam: (id, key) =>
    set((s) => ({
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) => {
          if (l.id !== id) return l;
          const spec = fxEffect(l.effectId);
          const p = spec?.params.find((q) => q.key === key);
          if (!p) return l;
          return { ...l, params: { ...l.params, [key]: p.default } };
        }),
      },
    })),

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

  setScrub: (t) => set({ scrubTime: t }),

  setShowPerf: (v) => set({ showPerf: v }),

  setAudioOn: (v) => set({ audioOn: v }),

  addKeyframe: (id, key, kf) =>
    set((s) => ({
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) =>
          l.id === id
            ? {
                ...l,
                keyframes: {
                  ...l.keyframes,
                  [key]: upsertKeyframe(l.keyframes?.[key], kf),
                },
              }
            : l,
        ),
      },
    })),

  removeKeyframe: (id, key, index) =>
    set((s) => ({
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) => {
          if (l.id !== id || !l.keyframes?.[key]) return l;
          const kfs =
            index < 0 ? [] : l.keyframes[key]!.filter((_, i) => i !== index);
          const keyframes = { ...l.keyframes };
          if (kfs.length === 0) delete keyframes[key];
          else keyframes[key] = kfs;
          return {
            ...l,
            keyframes: Object.keys(keyframes).length > 0 ? keyframes : undefined,
          };
        }),
      },
    })),

  setMask: (id, maskLayerId) =>
    set((s) => ({
      scene: {
        ...s.scene,
        layers: s.scene.layers.map((l) =>
          l.id === id ? { ...l, maskLayerId: maskLayerId ?? undefined } : l,
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
      scrubTime: null,
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

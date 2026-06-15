import { create } from "zustand";
import { setAppState } from "@/lib/db";
import { DEFAULT_MODEL_ID } from "@/lib/models";

// Each interactive Claude surface remembers its own model choice. Hermes is
// excluded — its model is per-agent (stored on the agent row), not per-surface.
export type ModelSurface = "archives" | "orion" | "xdesign" | "rosie" | "learn";

type Prefs = Record<ModelSurface, string>;

const EMPTY: Prefs = { archives: "", orion: "", xdesign: "", rosie: "", learn: "" };

type ModelPrefsState = {
  models: Prefs;
  /** Resolved model id for a surface (falls back to the default). */
  modelFor: (surface: ModelSurface) => string;
  setModel: (surface: ModelSurface, id: string) => void;
  hydrate: (value: Partial<Prefs> | null | undefined) => void;
};

export const useModelPrefs = create<ModelPrefsState>((set, get) => ({
  models: { ...EMPTY },
  modelFor: (surface) => get().models[surface] || DEFAULT_MODEL_ID,
  setModel: (surface, id) => {
    const models = { ...get().models, [surface]: id };
    set({ models });
    void setAppState("models", models);
  },
  hydrate: (value) => {
    if (value) set({ models: { ...EMPTY, ...value } });
  },
}));

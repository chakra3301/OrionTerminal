import { create } from "zustand";
import { setAppState } from "@/lib/db";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { toast } from "@/store/toastStore";

// Each interactive Claude surface remembers its own model choice. Hermes is
// excluded — its model is per-agent (stored on the agent row), not per-surface.
export type ModelSurface = "default" | "archives" | "orion" | "xdesign" | "rosie" | "learn" | "model3d" | "fx";

type Prefs = Record<ModelSurface, string>;

const EMPTY: Prefs = { default: "", archives: "", orion: "", xdesign: "", rosie: "", learn: "", model3d: "", fx: "" };
let persistence: Promise<unknown> = Promise.resolve();

type ModelPrefsState = {
  models: Prefs;
  /** Resolved model id for a surface (falls back to the default). */
  modelFor: (surface: ModelSurface) => string;
  setModel: (surface: ModelSurface, id: string) => void;
  hydrate: (value: Partial<Prefs> | null | undefined) => void;
};

export const useModelPrefs = create<ModelPrefsState>((set, get) => ({
  models: { ...EMPTY },
  modelFor: (surface) => get().models[surface] || get().models.default || DEFAULT_MODEL_ID,
  setModel: (surface, id) => {
    const models = { ...get().models, [surface]: id };
    set({ models });
    persistence = persistence.then(() => setAppState("models", models)).catch((e) => {
      toast.error("Could not save AI preference", { body: String(e) });
    });
  },
  hydrate: (value) => {
    const models = { ...EMPTY };
    for (const surface of Object.keys(EMPTY) as ModelSurface[]) {
      if (typeof value?.[surface] === "string") models[surface] = value[surface];
    }
    set({ models });
  },
}));

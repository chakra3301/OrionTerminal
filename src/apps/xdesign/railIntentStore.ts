import { create } from "zustand";

/** A request the side tool rail / project-start picker can fire at the docked
 * Claude rail without being coupled to its internal React state. "open" just
 * surfaces the rail; the rest arm a tool flow or run a direct action. */
export type RailIntentMode =
  | "open"
  | "generate"
  | "variations"
  | "webpage"
  | "deck"
  | "motion"
  | "illustrate"
  | "image"
  | "critique"
  | "applyBrand"
  | "extractBrand";

type RailIntentState = {
  /** Bumps on every request so repeated same-mode clicks re-fire the effect. */
  seq: number;
  mode: RailIntentMode | null;
  request: (mode: RailIntentMode) => void;
  /** Called by the rail once it has handled the pending intent. */
  consume: () => void;
};

export const useRailIntent = create<RailIntentState>((set) => ({
  seq: 0,
  mode: null,
  request: (mode) => set((s) => ({ seq: s.seq + 1, mode })),
  consume: () => set({ mode: null }),
}));

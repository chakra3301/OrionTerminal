import { create } from "zustand";
import type { ProtoTransition } from "./prototype";

/** Ephemeral present-mode UI state (not persisted). A "screen" is a top-level
 * frame id; navigation pushes onto a history stack so Back works. */
type PresentState = {
  active: boolean;
  screenId: string | null;
  history: string[];
  /** The transition used for the most recent navigation (drives the anim). */
  transition: ProtoTransition;
  /** Bumps on every navigation so the overlay can re-key its anim wrapper. */
  navSeq: number;
  enter: (screenId: string | null) => void;
  exit: () => void;
  navigate: (target: string, transition?: ProtoTransition) => void;
  back: () => void;
};

export const usePresentMode = create<PresentState>((set) => ({
  active: false,
  screenId: null,
  history: [],
  transition: "instant",
  navSeq: 0,
  enter: (screenId) =>
    set({ active: true, screenId, history: [], transition: "instant", navSeq: 0 }),
  exit: () => set({ active: false, screenId: null, history: [] }),
  navigate: (target, transition = "instant") =>
    set((s) =>
      s.screenId === target
        ? s
        : {
            screenId: target,
            history: s.screenId ? [...s.history, s.screenId] : s.history,
            transition,
            navSeq: s.navSeq + 1,
          },
    ),
  back: () =>
    set((s) => {
      if (s.history.length === 0) return s;
      const prev = s.history[s.history.length - 1]!;
      return {
        screenId: prev,
        history: s.history.slice(0, -1),
        transition: "instant",
        navSeq: s.navSeq + 1,
      };
    }),
}));

import { create } from "zustand";

/**
 * Clip-test mode: steps the companion through every animation clip (by name) so
 * the user can eyeball each one and decide the event mapping. Toggled via the
 * `companion.clipTest` command; the names list is registered by RosieModel on load.
 */
type CompanionDebugState = {
  testMode: boolean;
  index: number;
  names: string[];
  setNames: (names: string[]) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
};

export const useCompanionDebug = create<CompanionDebugState>((set) => ({
  testMode: false,
  index: 0,
  names: [],
  setNames: (names) => set({ names }),
  toggle: () => set((s) => ({ testMode: !s.testMode })),
  next: () =>
    set((s) => ({
      index: s.names.length ? (s.index + 1) % s.names.length : 0,
    })),
  prev: () =>
    set((s) => ({
      index: s.names.length ? (s.index - 1 + s.names.length) % s.names.length : 0,
    })),
}));

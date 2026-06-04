import { create } from "zustand";

/**
 * Proactive companion state: occasionally (while idle) she asks the user a
 * question — a speech bubble + a gesture. The scheduler lives in
 * useProactiveCompanion(); the bubble UI in CompanionAvatar; the gesture is
 * triggered in the rig off `gestureNonce`.
 */
type CompanionProactiveState = {
  prompt: string | null;
  /** Bumped each time she proactively asks — the rig plays a gesture on change. */
  gestureNonce: number;
  /** Proactive question: bubble + a gesture. */
  ask: (prompt: string) => void;
  /** Her chat reply surfacing in the bubble (panel closed): bubble, no gesture. */
  say: (text: string) => void;
  dismiss: () => void;
};

export const useCompanionProactive = create<CompanionProactiveState>((set) => ({
  prompt: null,
  gestureNonce: 0,
  ask: (prompt) => set((s) => ({ prompt, gestureNonce: s.gestureNonce + 1 })),
  say: (prompt) => set({ prompt }),
  dismiss: () => set({ prompt: null }),
}));

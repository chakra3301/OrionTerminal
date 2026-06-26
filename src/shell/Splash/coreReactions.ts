import { create } from "zustand";

/** A lightweight impulse channel: the login fields fire spark() on each
 * keystroke and the energy core reads the decaying envelope each frame. The
 * core reads via getState() (no subscription), so typing doesn't re-render the
 * React tree. */
type CoreReactionState = {
  impulses: number[]; // performance.now() ms timestamps
  spark: (count?: number) => void;
};

const MAX_AGE_MS = 1400;

export const useCoreReactions = create<CoreReactionState>((set, get) => ({
  impulses: [],
  spark: (count = 1) => {
    const now = performance.now();
    const kept = get().impulses.filter((t) => now - t < MAX_AGE_MS);
    for (let i = 0; i < count; i++) kept.push(now + i * 12);
    set({ impulses: kept });
  },
}));

/** Sum of exponentially-decaying impulses → 0..~ envelope, clamped. */
export function sparkEnvelope(
  impulses: number[],
  nowMs: number,
  tauMs = 300,
): number {
  let e = 0;
  for (const t of impulses) {
    const dt = nowMs - t;
    if (dt < 0 || dt > tauMs * 5) continue;
    e += Math.exp(-dt / tauMs);
  }
  return Math.min(2.4, e);
}

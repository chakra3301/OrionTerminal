import { create } from "zustand";

/** A lightweight impulse channel: the login fields fire spark() on each
 * keystroke and the energy core reads the decaying envelope each frame. The
 * core reads via getState() (no subscription), so typing doesn't re-render the
 * React tree. */
type CoreReactionState = {
  impulses: number[]; // performance.now() ms timestamps
  // Normalized pointer (-1..1) for parallax. Read imperatively each frame, so
  // mouse movement never re-renders the React tree. Defaults to 0,0 → no tilt
  // (the login/splash leave it untouched, so only the wallpaper overlay tilts).
  px: number;
  py: number;
  spark: (count?: number) => void;
  setPointer: (x: number, y: number) => void;
};

const MAX_AGE_MS = 1400;

export const useCoreReactions = create<CoreReactionState>((set, get) => ({
  impulses: [],
  px: 0,
  py: 0,
  spark: (count = 1) => {
    const now = performance.now();
    const kept = get().impulses.filter((t) => now - t < MAX_AGE_MS);
    for (let i = 0; i < count; i++) kept.push(now + i * 12);
    set({ impulses: kept });
  },
  // Mutate in place + skip set() to avoid churn: the core reads getState()
  // each frame, so no subscriber needs notifying.
  setPointer: (x, y) => {
    const s = get();
    s.px = Math.max(-1, Math.min(1, x));
    s.py = Math.max(-1, Math.min(1, y));
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

// src/apps/archives/learn/bkt.ts
// Bayesian Knowledge Tracing — a 2-state HMM mastery estimate per concept.

export const BKT_DEFAULTS = {
  pInit: 0.3,     // prior P(known) for a fresh concept
  pTransit: 0.15, // P(learn) per opportunity
  pSlip: 0.1,     // P(wrong | known)
  pGuess: 0.2,    // P(right | not known)
};

export const MASTERY_THRESHOLD = 0.8;
export const MIN_ATTEMPTS = 3;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Update P(mastery) given the prior and whether the latest answer was correct. */
export function bktUpdate(prior: number, correct: boolean, params = BKT_DEFAULTS): number {
  const p = clamp01(prior);
  const { pTransit, pSlip, pGuess } = params;
  let posterior: number;
  if (correct) {
    const num = p * (1 - pSlip);
    const den = p * (1 - pSlip) + (1 - p) * pGuess;
    posterior = den === 0 ? p : num / den;
  } else {
    const num = p * pSlip;
    const den = p * pSlip + (1 - p) * (1 - pGuess);
    posterior = den === 0 ? p : num / den;
  }
  return clamp01(posterior + (1 - posterior) * pTransit);
}

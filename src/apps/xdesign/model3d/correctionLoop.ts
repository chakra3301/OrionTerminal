/**
 * Port of img2threejs `forge/stage4_review/correction_loop.py`. Guarantees
 * the self-correction loop terminates — success, repeated-defect,
 * oscillation, plateau, or a hard iteration ceiling — and escalates to
 * `request-input` instead of a silent infinite token burn.
 */

export type LoopHistoryEntry = { fidelity: number; action: string; mismatchSignature?: string };

export type LoopDecision = {
  done: boolean;
  reason:
    | "success"
    | "repeated-defect"
    | "oscillation"
    | "plateau"
    | "hard-ceiling"
    | "in-progress";
  requestInput: boolean;
};

const MAX_ITER = 6;
const MIN_DELTA = 0.02;
const TARGET_FIDELITY = 0.85;

export function decideLoop(
  history: LoopHistoryEntry[],
  targetFidelity = TARGET_FIDELITY,
  maxIter = MAX_ITER,
  minDelta = MIN_DELTA,
): LoopDecision {
  if (history.length === 0) return { done: false, reason: "in-progress", requestInput: false };

  const last = history[history.length - 1]!;
  if (last.action === "continue" && last.fidelity >= targetFidelity) {
    return { done: true, reason: "success", requestInput: false };
  }
  if (last.action === "request-input" || last.action === "stop") {
    return { done: true, reason: "success", requestInput: last.action === "request-input" };
  }

  // repeated-defect: same mismatch signature reappears 3x in a row.
  if (history.length >= 3) {
    const tail = history.slice(-3);
    const sig = tail[0]!.mismatchSignature;
    if (sig && tail.every((h) => h.mismatchSignature === sig)) {
      return { done: true, reason: "repeated-defect", requestInput: true };
    }
  }

  // oscillation: fidelity alternates up/down across the last 4 entries
  // without net progress (classic refine-spec ↔ refine-code ping-pong).
  if (history.length >= 4) {
    const tail = history.slice(-4).map((h) => h.fidelity);
    const deltas = tail.slice(1).map((v, i) => v - tail[i]!);
    const signs = deltas.map((d) => Math.sign(d));
    const alternating = signs.every((s, i) => i === 0 || s !== 0 && s !== signs[i - 1]);
    const netProgress = tail[tail.length - 1]! - tail[0]!;
    if (alternating && netProgress < minDelta) {
      return { done: true, reason: "oscillation", requestInput: true };
    }
  }

  // plateau: progress has stalled below min-delta over the last 3 passes.
  if (history.length >= 3) {
    const tail = history.slice(-3).map((h) => h.fidelity);
    const delta = tail[tail.length - 1]! - tail[0]!;
    if (delta < minDelta && tail[tail.length - 1]! < targetFidelity) {
      return { done: true, reason: "plateau", requestInput: true };
    }
  }

  if (history.length >= maxIter) {
    return { done: true, reason: "hard-ceiling", requestInput: true };
  }

  return { done: false, reason: "in-progress", requestInput: false };
}

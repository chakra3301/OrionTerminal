export type TwoPassPhase = "plan" | "execute";

export type TwoPassEntry = {
  phase: TwoPassPhase;
  /** Raw model-prefs selection value — for phase-aware cancel routing. */
  value: string;
  /** Seal the streamed plan message in the rail store and return its text.
   *  Implemented by the rail; must keep the turn's running flag true. */
  capturePlan: () => string;
  /** Fire the Action pass on the same chatId with the captured plan. */
  fireExecute: (plan: string) => void;
};

/** chatId → in-flight two-pass turn. Module scope so it survives EventBridge
 *  re-mounts and is shared between the orchestrator and the exit handlers. */
const turns = new Map<string, TwoPassEntry>();

export function beginTwoPass(chatId: string, entry: TwoPassEntry): void {
  turns.set(chatId, entry);
}

export function twoPassPhase(chatId: string): TwoPassPhase | null {
  return turns.get(chatId)?.phase ?? null;
}

export function twoPassValue(chatId: string): string | null {
  return turns.get(chatId)?.value ?? null;
}

export function clearTwoPass(chatId: string): void {
  turns.delete(chatId);
}

/** Consult on every rail `claude:exit`. Returns true iff the exit was the
 *  Brain pass and the Action pass was fired (caller must NOT finalize). */
export function onPassExit(chatId: string, error: string | null): boolean {
  const e = turns.get(chatId);
  if (!e) return false;
  if (e.phase === "execute") {
    // Action pass done — let the caller finalize normally.
    turns.delete(chatId);
    return false;
  }
  // Plan phase.
  if (error) {
    // Brain failed — stop the turn; the caller finalizes with the error.
    turns.delete(chatId);
    return false;
  }
  const plan = e.capturePlan();
  e.phase = "execute";
  e.fireExecute(plan);
  return true;
}

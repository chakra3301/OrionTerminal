// Pure autonomy-ladder logic for the delegation flow. The General's autonomy
// level decides whether a planned mission needs your approval or auto-dispatches,
// and how many directives may fire without you (the budget). No IO.
//
//   0 manual          — nothing auto; you drive every step
//   1 approve-each    — General plans; you approve before dispatch (default)
//   2 auto-within-budget — auto-dispatch up to BUDGET directives, then stop
//   3 full-auto+digest   — auto-dispatch everything; read the briefing after

export const L2_DIRECTIVE_BUDGET = 3;

/** Does a planned mission dispatch without an approval click? (L2/L3) */
export function autoDispatches(level: number): boolean {
  return level >= 2;
}

/** Max directives that may auto-fire for this level (Infinity = no cap). */
export function directiveBudget(level: number): number {
  if (level === 2) return L2_DIRECTIVE_BUDGET;
  return Infinity;
}

/** Trim a plan to the level's budget; returns the kept directives + whether
 * anything was held back (so the UI can say so). */
export function applyBudget<T>(
  directives: T[],
  level: number,
): { kept: T[]; heldBack: number } {
  const budget = directiveBudget(level);
  if (directives.length <= budget) return { kept: directives, heldBack: 0 };
  return {
    kept: directives.slice(0, budget),
    heldBack: directives.length - budget,
  };
}

export const AUTONOMY_LEVELS: { level: number; label: string; hint: string }[] = [
  { level: 0, label: "Manual", hint: "You drive every step" },
  { level: 1, label: "Approve", hint: "Plan → you approve → dispatch" },
  { level: 2, label: "Auto·budget", hint: `Auto-dispatch up to ${L2_DIRECTIVE_BUDGET}` },
  { level: 3, label: "Full auto", hint: "Runs free; read the briefing" },
];

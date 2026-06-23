// Model routing for XDesign's heavy creative turns.
//
// Frontend benchmarks (Dec 2025) put the strongest Claude at the top for UI /
// frontend generation, and the XDesign rail runs on the Claude subscription
// path (no per-token cost), so the expensive creative actions — Generate,
// Variations, Build webpage, Critique, Apply/Extract brand, Illustrate — should
// always use the strongest model regardless of what the chat dropdown is set to.
//
// We only upgrade a BUILT-IN Claude selection (sonnet/haiku → opus). An agent
// (`agent:<id>`) or a non-builtin provider model is an explicit user choice and
// is passed through untouched. Plain chat (handleSend) keeps the user's choice;
// only the labelled build buttons route through here.

import { MODELS, DEFAULT_MODEL_ID } from "@/lib/models";

/** The strongest built-in Claude id (first in the registry = most capable). */
export const STRONGEST_DESIGN_MODEL = MODELS[0]?.id ?? DEFAULT_MODEL_ID;

/** Upgrade a built-in Claude selection to the strongest model for creative
 * turns; leave agents / provider models as-is. */
export function designTurnModel(selected: string): string {
  return MODELS.some((m) => m.id === selected) ? STRONGEST_DESIGN_MODEL : selected;
}

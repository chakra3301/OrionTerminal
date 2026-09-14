// Model routing for XDesign's heavy creative turns.
//
// Creative actions honor the same explicit model/provider choice as chat.

import { MODELS, DEFAULT_MODEL_ID } from "@/lib/models";

/** The strongest built-in Claude id (first in the registry = most capable). */
export const STRONGEST_DESIGN_MODEL = MODELS[0]?.id ?? DEFAULT_MODEL_ID;

/** Never silently change the user's selected provider, model, or cost tier. */
export function designTurnModel(selected: string): string {
  return selected;
}

import { ulid } from "ulid";
import { useXDesign } from "./store";
import { planToShapes, resolveColorRefs, type DesignPlan } from "./designPlan";
import { toast } from "@/store/toastStore";

/** Seed/reuse a plan's color variables and return the name→id map used to
 * resolve color/<name> refs. */
function seedColors(plan: DesignPlan): Map<string, string> {
  const store = useXDesign.getState();
  const nameToId = new Map<string, string>();
  for (const v of store.variables) nameToId.set(v.name, v.id);
  for (const c of plan.tokens.colors) {
    const existing = nameToId.get(c.name);
    if (existing) {
      store.setVariableValue(existing, store.activeModeId, c.value);
    } else {
      const id = store.addVariable(c.name, c.value, "color");
      nameToId.set(c.name, id);
    }
  }
  return nameToId;
}

/** Build a DesignPlan into the live document as one undo step: create (or
 * reuse) the color variables, resolve color/<name> refs to var ids, then
 * append the auto-layout shape graph and select the root. */
export function ingestDesignPlan(plan: DesignPlan): void {
  const nameToId = seedColors(plan);
  const { shapes } = planToShapes(plan, () => ulid());
  const resolved = resolveColorRefs(shapes, nameToId);
  if (resolved.length === 0) return;
  useXDesign.getState().addShapesBatch(resolved, resolved[0]!.id);
  toast.success("Design generated", { body: "⌘Z to undo" });
}

/** Ingest several design directions side-by-side so the user can compare and
 * keep the one they like (delete the rest). Each screen is offset horizontally
 * by its width plus a gutter; colors are seeded once (shared token set). */
export function ingestDesignPlans(plans: DesignPlan[]): void {
  if (plans.length === 0) return;
  if (plans.length === 1) return ingestDesignPlan(plans[0]!);
  const GUTTER = 160;
  const START_X = 120;
  const START_Y = 120;
  let cursorX = START_X;
  const all: ReturnType<typeof planToShapes>["shapes"] = [];
  let firstRootId: string | undefined;
  for (const plan of plans) {
    const nameToId = seedColors(plan);
    const { shapes } = planToShapes(plan, () => ulid(), {
      x: cursorX,
      y: START_Y,
    });
    const resolved = resolveColorRefs(shapes, nameToId);
    if (resolved.length) {
      if (!firstRootId) firstRootId = resolved[0]!.id;
      all.push(...resolved);
    }
    cursorX += (plan.screen.w || 1440) + GUTTER;
  }
  if (all.length === 0) return;
  useXDesign.getState().addShapesBatch(all, firstRootId);
  toast.success(`${plans.length} directions generated`, {
    body: "Keep the one you like · ⌘Z to undo",
  });
}

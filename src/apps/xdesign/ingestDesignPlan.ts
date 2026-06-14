import { ulid } from "ulid";
import { useXDesign } from "./store";
import { planToShapes, resolveColorRefs, type DesignPlan } from "./designPlan";
import { toast } from "@/store/toastStore";

/** Build a DesignPlan into the live document as one undo step: create (or
 * reuse) the color variables, resolve color/<name> refs to var ids, then
 * append the auto-layout shape graph and select the root. */
export function ingestDesignPlan(plan: DesignPlan): void {
  const store = useXDesign.getState();

  // Create or reuse color variables by name; build name→id map.
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

  const { shapes } = planToShapes(plan, () => ulid());
  const resolved = resolveColorRefs(shapes, nameToId);
  if (resolved.length === 0) return;
  useXDesign.getState().addShapesBatch(resolved, resolved[0]!.id);
  toast.success("Design generated", { body: "⌘Z to undo" });
}

import type { Editor } from "@open-pencil/core/editor";
import { findInstanceAncestor, recordInstanceOverride } from "@open-pencil/scene-graph/instances";
import { editPencilGraph } from "./toolExecution";
import { claimSlotContent, containingSlot } from "./slots";

/** Property-panel edits must record instance overrides together with their undo state. */
export function installInstancePropertyUpdates(editor: Editor) {
  const update = editor.updateNodeWithUndo;
  editor.updateNodeWithUndo = (id, changes, label = "Update instance") => {
    if (!findInstanceAncestor(editor.graph, id)) { update(id, changes, label); return; }
    editPencilGraph(editor, label, () => {
      const node=editor.graph.getNode(id),slot=node&&containingSlot(editor.graph,node);
      if(slot)claimSlotContent(editor.graph,slot);
      editor.updateNode(id, changes);
      recordInstanceOverride(editor.graph, id, Object.keys(changes));
    });
  };
  return () => { editor.updateNodeWithUndo = update; };
}

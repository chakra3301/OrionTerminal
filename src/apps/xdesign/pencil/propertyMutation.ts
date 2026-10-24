import { styleDetachmentChanges, type SceneNode } from "@open-pencil/scene-graph";
import { recordInstanceOverride } from "@open-pencil/scene-graph/instances";
import type { Editor } from "@open-pencil/core/editor";

/** Used inside a graph transaction. Explicit edits detach only their bindings. */
export function updateDesignProperties(editor:Editor,id:string,changes:Partial<SceneNode>):void {
  const node=editor.graph.getNode(id);if(!node)throw new Error("The edited layer no longer exists");
  const keys=Object.keys(changes),boundVariables={...node.boundVariables};
  for(const key of Object.keys(boundVariables))if(keys.some(changed=>key===changed||key.startsWith(`${changed}/`)))delete boundVariables[key];
  const patch={...changes,...styleDetachmentChanges(node,changes),boundVariables};
  editor.updateNode(id,patch);recordInstanceOverride(editor.graph,id,Object.keys(patch));
}

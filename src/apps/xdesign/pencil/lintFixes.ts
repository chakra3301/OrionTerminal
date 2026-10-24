import type { SceneNode } from "@open-pencil/scene-graph";
import type { LintMessage } from "@open-pencil/core/lint";
import type { Editor } from "@open-pencil/core/editor";
import { updateDesignProperties } from "./propertyMutation";
import { editPencilGraph } from "./toolExecution";

export function lintFix(node:SceneNode|undefined,issue:LintMessage):Partial<SceneNode>|null {
  if(!node||node.locked)return null;
  if(issue.ruleId==="min-text-size"&&node.type==="TEXT"&&node.fontSize<12&&!node.styleRuns.length)return {fontSize:12};
  if(issue.ruleId==="touch-target-size"&&(node.width<44||node.height<44))return {width:Math.max(44,node.width),height:Math.max(44,node.height)};
  if(issue.ruleId==="pixel-perfect"){
    const patch:Partial<SceneNode>={};for(const key of ["x","y","width","height"] as const)if(Math.abs(node[key]-Math.round(node[key]))>=.01)patch[key]=Math.round(node[key]);
    return Object.keys(patch).length?patch:null;
  }
  return null;
}
export function fixLintIssues(editor:Editor,issues:LintMessage[]):number {
  const patches=new Map<string,Partial<SceneNode>>();for(const issue of issues){const fix=lintFix(editor.graph.getNode(issue.nodeId),issue);if(fix)patches.set(issue.nodeId,{...patches.get(issue.nodeId),...fix});}
  if(!patches.size)return 0;
  return editPencilGraph(editor,"Fix design checks",()=>{for(const [id,patch] of patches)updateDesignProperties(editor,id,patch);return patches.size;});
}

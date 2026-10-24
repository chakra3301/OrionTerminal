import { SceneGraph, type SceneNode } from "@open-pencil/scene-graph";
import type { Editor } from "@open-pencil/core/editor";
import { selectionToJSX } from "@open-pencil/core/io";
import { renderTree } from "@open-pencil/core/design-jsx";
import { parseDesignJSX } from "./designJsx";
import { updateDesignProperties } from "./propertyMutation";
import { editPencilGraph } from "./toolExecution";

// Diff against the generated baseline rather than replacing imported nodes with
// the lossy JSX representation. Identity, overrides and opaque metadata survive.
const PROPERTIES = ["name","x","y","width","height","rotation","opacity","visible","locked","fills","strokes","effects","cornerRadius","topLeftRadius","topRightRadius","bottomLeftRadius","bottomRightRadius","layoutMode","layoutWrap","primaryAxisSizing","counterAxisSizing","primaryAxisAlign","counterAxisAlign","itemSpacing","counterAxisSpacing","paddingTop","paddingRight","paddingBottom","paddingLeft","text","fontFamily","fontSize","fontWeight","italic","letterSpacing","lineHeight","textAlignHorizontal","textAlignVertical","textAutoResize"] as const satisfies readonly (keyof SceneNode)[];
type Patch = {id:string;properties:Partial<SceneNode>};
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function generated(source:string) {
  const graph=new SceneGraph(),page=graph.createNode("CANVAS",graph.rootId,{name:"Code review"});
  const trees=parseDesignJSX(source);if(trees.length!==1)throw new Error("Property edits require one root layer");
  const root=await renderTree(graph,trees[0]!,{parentId:page.id});return {graph,root:graph.getNode(root.id)!};
}
export async function prepareCodeEdits(editor:Editor,id:string,baseline:string,source:string):Promise<Patch[]> {
  if(selectionToJSX([id],editor.graph,"openpencil")!==baseline)throw new Error("The selected design changed. Refresh its code before applying edits.");
  const before=await generated(baseline),after=await generated(source),patches:Patch[]=[],pending=[[id,before.root.id,after.root.id]];
  while(pending.length){
    if(patches.length+pending.length>10_000)throw new Error("Code edits exceed the 10,000-layer limit");
    const [originalId,beforeId,afterId]=pending.pop()!,original=editor.graph.getNode(originalId!),a=before.graph.getNode(beforeId!)!,b=after.graph.getNode(afterId!)!;
    if(!original||a.type!==b.type||a.childIds.length!==b.childIds.length||original.childIds.length!==a.childIds.length)throw new Error("The layer structure changed. Use Replace selected layer for structural edits.");
    const properties:Partial<SceneNode>={};
    for(const key of PROPERTIES)if(!equal(a[key],b[key]))(properties as Record<string,unknown>)[key]=structuredClone(b[key]);
    if(original.locked&&Object.keys(properties).length)throw new Error("Unlock the edited layers before applying code changes");
    if(properties.text!==undefined&&original.styleRuns.length)throw new Error("Edit rich text on the canvas to preserve its character formatting");
    if(properties.fills?.some(fill=>fill.imageHash&&!editor.graph.images.has(fill.imageHash)))throw new Error("Import new images before referring to them in code");
    patches.push({id:original.id,properties});
    for(let i=a.childIds.length-1;i>=0;i--)pending.push([original.childIds[i]!,a.childIds[i]!,b.childIds[i]!]);
  }
  if(selectionToJSX([id],editor.graph,"openpencil")!==baseline)throw new Error("The selected design changed while checking the code");
  return patches.filter(patch=>Object.keys(patch.properties).length>0);
}
export function applyCodeEdits(editor:Editor,patches:Patch[]):number {
  if(!patches.length)return 0;
  return editPencilGraph(editor,"Apply design code edits",()=>{for(const patch of patches)updateDesignProperties(editor,patch.id,patch.properties);return patches.length;});
}

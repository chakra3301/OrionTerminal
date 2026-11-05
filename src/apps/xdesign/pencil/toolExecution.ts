import type { Editor } from "@open-pencil/core/editor";
import { executeAtomicTool } from "@open-pencil/core/editor";
import { isAtomicTool, type ToolDef } from "@open-pencil/core/tools";
import type { FigmaAPI } from "@open-pencil/core/figma-api";
import type { SceneGraph } from "@open-pencil/scene-graph";

function checkpoint(graph:SceneGraph) {
  return {nodes:structuredClone(graph.nodes),variables:structuredClone(graph.variables),variableCollections:structuredClone(graph.variableCollections),images:new Map(graph.images),activeMode:new Map(graph.activeMode),enabledLibraries:structuredClone(graph.enabledLibraries),rootId:graph.rootId,documentColorSpace:graph.documentColorSpace,figKiwiVersion:graph.figKiwiVersion,figSchemaDeflated:graph.figSchemaDeflated?.slice()??null};
}
function replay(editor:Editor,state:ReturnType<typeof checkpoint>) {
  const graph=editor.graph;
  // Preserve surviving node identity: earlier upstream undo entries may hold it.
  for(const id of graph.nodes.keys())if(!state.nodes.has(id))graph.nodes.delete(id);
  for(const [id,node] of state.nodes){const current=graph.nodes.get(id);if(current){for(const key of Object.keys(current))if(!Object.hasOwn(node,key))Reflect.deleteProperty(current,key);Object.assign(current,structuredClone(node));}else graph.nodes.set(id,structuredClone(node));}
  graph.variables=structuredClone(state.variables);graph.variableCollections=structuredClone(state.variableCollections);graph.images=new Map(state.images);graph.activeMode=new Map(state.activeMode);graph.enabledLibraries=structuredClone(state.enabledLibraries);graph.rootId=state.rootId;graph.documentColorSpace=state.documentColorSpace;graph.figKiwiVersion=state.figKiwiVersion;graph.figSchemaDeflated=state.figSchemaDeflated?.slice()??null;
  graph.instanceIndex.clear();for(const node of graph.nodes.values())if(node.type==="INSTANCE"&&node.componentId){let ids=graph.instanceIndex.get(node.componentId);if(!ids){ids=new Set();graph.instanceIndex.set(node.componentId,ids);}ids.add(node.id);}
  graph.clearAbsPosCache();editor.state.selectedIds=new Set([...editor.state.selectedIds].filter(id=>graph.nodes.has(id)));
  if(!graph.getNode(editor.state.currentPageId))editor.state.currentPageId=graph.getPages()[0]!.id;
  editor.renderer?.invalidateAllPictures();editor.state.sceneVersion++;editor.requestRender();
}
export function applyPencilGraphSnapshot(editor:Editor,graph:SceneGraph):void { replay(editor,checkpoint(graph)); }
export function executePencilTool(editor:Editor,figma:FigmaAPI,tool:ToolDef,args:Record<string,unknown>):unknown {
  if(tool.execution.kind!=="sync")throw new Error("This action needs an asynchronous integration");
  if(isAtomicTool(tool))return executeAtomicTool(editor,figma,tool,args);
  if(tool.execution.mutation==="none"||tool.execution.mutation==="view"){const result=tool.execute(figma,args);editor.select(figma.currentPage.selection.map(n=>n.id));editor.requestRender();return result;}
  return editPencilGraph(editor,tool.name.replaceAll("_"," "),()=>{
    const result=tool.execute(figma,args);
    if(result instanceof Promise)throw new Error("The action returned an asynchronous operation");
    if(result&&typeof result==="object"&&"error" in result)throw new Error(String(result.error));
    return result;
  });
}
export function editPencilGraph<T>(editor:Editor,label:string,work:()=>T):T {
  if(editor.graph.nodes.size>10_000)throw new Error("This action exceeds the 10,000-layer transaction limit");
  const before=checkpoint(editor.graph);
  try{const result=work();editor.runLayoutForNode(editor.state.currentPageId);const after=checkpoint(editor.graph);editor.pushUndoEntry({label,forward:()=>replay(editor,after),inverse:()=>replay(editor,before)});editor.requestRender();return result;}
  catch(error){replay(editor,before);throw error;}
}
export function editPencilGraphAndView<T>(editor:Editor,label:string,work:()=>T):T {
  if(editor.graph.nodes.size>10_000)throw new Error("This action exceeds the 10,000-layer transaction limit");
  const captureView=()=>({pageId:editor.state.currentPageId,selection:[...editor.state.selectedIds]});
  const restoreView=(view:ReturnType<typeof captureView>)=>{editor.state.currentPageId=view.pageId;editor.select(view.selection.filter(id=>editor.graph.nodes.has(id)));editor.requestRender();};
  const before=checkpoint(editor.graph),beforeView=captureView();
  try {
    const result=work();for(const page of editor.graph.getPages())editor.runLayoutForNode(page.id);
    const after=checkpoint(editor.graph),afterView=captureView();
    editor.pushUndoEntry({label,forward:()=>{replay(editor,after);restoreView(afterView);},inverse:()=>{replay(editor,before);restoreView(beforeView);}});editor.requestRender();return result;
  }catch(error){replay(editor,before);restoreView(beforeView);throw error;}
}
export async function editPencilGraphAsync<T>(editor:Editor,label:string,work:()=>Promise<T>):Promise<T> {
  if(editor.graph.nodes.size>10_000)throw new Error("This action exceeds the 10,000-layer transaction limit");
  const before=checkpoint(editor.graph);
  try{const result=await work();editor.runLayoutForNode(editor.state.currentPageId);const after=checkpoint(editor.graph);editor.pushUndoEntry({label,forward:()=>replay(editor,after),inverse:()=>replay(editor,before)});editor.requestRender();return result;}
  catch(error){replay(editor,before);throw error;}
}

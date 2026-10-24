import { parseColor } from "@open-pencil/core/color";
import type { SceneNode } from "@open-pencil/scene-graph";
import type { CanvasCommand, CanvasRunOutcome } from "../claudeCommands";
import { usePencilWorkspace, executeDesignTool, executeDesignToolAsync, persistPencil, designTools } from "./runtime";
import { usePhotoWorkspace } from "../photo/runtime";
import { editPencilGraph } from "./toolExecution";
import { trackXDesignActivity } from "../runtimeActivity";

export function pencilCanvasSnapshot():Record<string,unknown> {
  const editor=usePencilWorkspace.getState().editor;if(!editor)throw new Error("Wait for the design canvas to load");
  return {workspace:"design",activePageId:editor.state.currentPageId,pages:editor.getPages().map(p=>({id:p.id,name:p.name,shapeCount:editor.graph.countDescendants(p.id)})),selection:[...editor.state.selectedIds],shapes:editor.getLayerTree().map(({node})=>({id:node.id,kind:node.type,name:node.name,x:node.x,y:node.y,w:node.width,h:node.height,parentId:node.parentId,text:node.text,layoutMode:node.layoutMode,fills:node.fills,strokes:node.strokes,effects:node.effects,componentId:node.componentId,boundVariables:node.boundVariables})),note:"Coordinates are local to each parent. Basic canvas commands and {action:'designTool',name,input} are supported."};
}
function patch(value:Record<string,unknown>):Partial<SceneNode> {
  const next:Partial<SceneNode>={};
  for(const field of ["x","y","rotation","name","text","fontSize","fontFamily","fontWeight","opacity","cornerRadius","layoutMode","itemSpacing","paddingTop","paddingRight","paddingBottom","paddingLeft"] as const)if(value[field]!==undefined)(next as Record<string,unknown>)[field]=value[field];
  if(typeof value.w==="number")next.width=value.w;if(typeof value.h==="number")next.height=value.h;if(typeof value.radius==="number")next.cornerRadius=value.radius;
  if(typeof value.hidden==="boolean")next.visible=!value.hidden;
  if(typeof value.layoutMode==="string")next.layoutMode=value.layoutMode.toUpperCase() as SceneNode["layoutMode"];
  if(typeof value.fill==="string"){const color=parseColor(value.fill);if(!color)throw new Error("Invalid fill color");next.fills=[{type:"SOLID",color,opacity:1,visible:true}];}
  if(typeof value.stroke==="string"){const color=parseColor(value.stroke);if(!color)throw new Error("Invalid stroke color");next.strokes=[{color,weight:typeof value.strokeWidth==="number"?value.strokeWidth:1,opacity:1,visible:true,align:"CENTER"}];}
  for(const field of ["x","y","width","height","rotation","fontSize","fontWeight","opacity","cornerRadius","itemSpacing","paddingTop","paddingRight","paddingBottom","paddingLeft"] as const)if(next[field]!==undefined&&!Number.isFinite(next[field]))throw new Error(`Invalid ${field}`);
  return next;
}
export function runPencilCommands(commands:CanvasCommand[]):CanvasRunOutcome {
  const editor=usePencilWorkspace.getState().editor;
  if(!editor||usePhotoWorkspace.getState().busy||usePencilWorkspace.getState().busy)throw new Error("Wait for the active image operation or design canvas to finish");
  const results:CanvasRunOutcome["results"]=[];const newIds:string[]=[];
  editor.undo.beginBatch("Design partner edits");
  try{for(const command of commands){const c=command as unknown as Record<string,unknown>;const action=String(c.action);try{
    let id:string|undefined;
    if(["addRect","addEllipse","addFrame","addText","addStar"].includes(action)){
      const type=({addRect:"RECTANGLE",addEllipse:"ELLIPSE",addFrame:"FRAME",addText:"TEXT",addStar:"STAR"} as const)[action as "addRect"];
      const props=action==="addStar"?{...c,x:Number(c.cx)-Number(c.outerR),y:Number(c.cy)-Number(c.outerR),w:Number(c.outerR)*2,h:Number(c.outerR)*2}:c;
      const values=patch(props);if(action==="addStar"){values.pointCount=Number(c.points??5);values.starInnerRadius=Number(c.innerR)/Number(c.outerR);}const width=values.width??200,height=values.height??60;if(width<=0||height<=0)throw new Error("Shape dimensions must be positive");
      id=editor.createShape(type,values.x??0,values.y??0,width,height,undefined,typeof c.name==="string"?c.name:undefined);editor.updateNodeWithUndo(id,values);newIds.push(id);
    }else if(action==="designTool"){const result=executeDesignTool(String(c.name),c.input as Record<string,unknown>);if(result&&typeof result==="object"&&"id" in result)id=String(result.id);}
    else if(action==="update"){if(!editor.graph.getNode(String(c.id)))throw new Error("Layer not found");editor.updateNodeWithUndo(String(c.id),patch(c));}
    else if(action==="select")editor.select(c.ids as string[]);
    else if(action==="delete"){editor.select([String(c.id)]);editor.deleteSelected();}
    else if(action==="clearCanvas"){editor.selectAll();editor.deleteSelected();}
    else if(action==="addPath"){const points=c.points as {x:number;y:number}[];const path=points.map((p,i)=>`${i?"L":"M"}${p.x*Number(c.w)} ${p.y*Number(c.h)}`).join(" ")+(c.closed!==false?" Z":"");const result=executeDesignTool("create_vector",{x:c.x,y:c.y,path,fill:c.fill??"#ffffff",name:c.name}) as {id:string};id=result.id;newIds.push(id);}
    else if(action==="group"||action==="ungroup"||action==="duplicate"){editor.select(c.ids as string[]);if(action==="group")id=editor.groupSelected()??undefined;else if(action==="ungroup")editor.ungroupSelected();else editor.duplicateSelected();}
    else if(action==="makeComponent"){editor.select([String(c.id)]);editor.createComponentFromSelection();}
    else if(action==="createInstance"){id=editor.createInstanceFromComponent(String(c.componentId??c.mainId),Number(c.x??0),Number(c.y??0))??undefined;}
    else if(action==="detachInstance"){editor.select([String(c.id)]);editor.detachInstance();}
    else if(action==="syncInstance"){const instance=editor.graph.getNode(String(c.id));if(!instance?.componentId)throw new Error("Select a component instance");editPencilGraph(editor,"Sync component instance",()=>editor.graph.syncInstances(instance.componentId!));}
    else if(action==="reparent"){executeDesignTool("reparent_node",{id:c.id,parent_id:c.parentId});}
    else if(action==="addPage")id=editor.addPage(typeof c.name==="string"?c.name:undefined);
    else if(action==="renamePage")editor.updateNodeWithUndo(String(c.id),{name:String(c.name)});
    else if(action==="deletePage")editor.deletePage(String(c.id));
    else throw new Error(`Use a designTool action for ${action}; it has not been mapped to this canvas`);
    results.push({action:command.action,ok:true,...(id?{id}:{})});
  }catch(error){results.push({action:command.action,ok:false,error:String(error)});}}
  }finally{editor.undo.commitBatch();persistPencil();}
  return {applied:results.filter(r=>r.ok).length,newIds,results};
}
let batchRunning=false;
export async function runPencilCommandsAsync(commands:CanvasCommand[]):Promise<CanvasRunOutcome> {
  if(batchRunning||usePencilWorkspace.getState().busy||usePhotoWorkspace.getState().busy)throw new Error("Wait for the current design or image action to finish");
  batchRunning=true;
  try{return await trackXDesignActivity("ui-tool","Wait for the design edits before switching projects or disabling XDesign.",()=>runPencilCommandBatch(commands));}finally{batchRunning=false;}
}
async function runPencilCommandBatch(commands:CanvasCommand[]):Promise<CanvasRunOutcome> {
  const editor=usePencilWorkspace.getState().editor;if(!editor)throw new Error("Wait for the design canvas to load");
  const outcome:CanvasRunOutcome={applied:0,newIds:[],results:[]};editor.undo.beginBatch("Design partner edits");
  try{for(const cmd of commands){const c=cmd as unknown as {action:string;name?:string;input?:Record<string,unknown>};if(c.action==="designTool"&&designTools.find(t=>t.name===c.name)?.execution.kind==="async"){try{const result=await executeDesignToolAsync(c.name!,c.input??{});const id=result&&typeof result==="object"&&"id" in result?String(result.id):undefined;outcome.results.push({action:cmd.action,ok:true,...(id?{id}:{})});if(id)outcome.newIds.push(id);outcome.applied++;}catch(error){outcome.results.push({action:cmd.action,ok:false,error:String(error)});}}else{const result=runPencilCommands([cmd]);outcome.results.push(...result.results);outcome.newIds.push(...result.newIds);outcome.applied+=result.applied;}}}
  finally{editor.undo.commitBatch();persistPencil();}return outcome;
}

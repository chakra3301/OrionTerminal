import { FigmaAPI } from "@open-pencil/core/figma-api";
import { createSVGNodesFromImport } from "@open-pencil/core/io/formats/svg";
import { parseColor } from "@open-pencil/core/color";
import type { Editor } from "@open-pencil/core/editor";
import type { SceneGraph, SceneNode } from "@open-pencil/scene-graph";
import { serializeGraph } from "./document";
import { editPencilGraphAndView } from "./toolExecution";
import { initializeCanvasKit, persistPencil, usePencilWorkspace, withPencilTask, assertPencilEditable } from "./runtime";
import { useXDProjects } from "../projectsStore";
import { trackXDesignActivity } from "../runtimeActivity";
import { activeStockProvider, assetQuery, downloadStockPhoto, fetchIcons, iconName, iconPaths, notifyStockDownload, numeric, photoCredit, searchIcons, searchPhotos, type AssetCredit, type StockPhoto } from "./assetService";

const CREDIT_PLUGIN="orion.xdesign.asset",CREDIT_KEY="source";
export { assetCredits } from "./assetCredits";

function credit(graph:SceneGraph,node:SceneNode,value:AssetCredit):void {if(JSON.stringify(value).length>8192)throw new Error("The asset source metadata exceeds the document limit.");graph.updateNode(node.id,{pluginData:[...node.pluginData.filter(entry=>entry.pluginId!==CREDIT_PLUGIN||entry.key!==CREDIT_KEY),{pluginId:CREDIT_PLUGIN,key:CREDIT_KEY,value:JSON.stringify(value)}]});}
function editable(graph:SceneGraph,node:SceneNode):void {let current:SceneNode|undefined=node;while(current){if(current.locked||current.internalOnly||current.librarySource?.readOnly)throw new Error("Choose an unlocked editable layer.");current=current.parentId?graph.getNode(current.parentId):undefined;}}
function parent(editor:Editor,id:unknown):SceneNode {const node=editor.graph.getNode(typeof id==="string"?id:editor.state.currentPageId);if(!node||!["CANVAS","FRAME","GROUP","COMPONENT","INSTANCE","SECTION"].includes(node.type)||node.id===editor.graph.rootId)throw new Error("Choose a page, frame, group or component for the icons.");editable(editor.graph,node);return node;}
function photoTarget(graph:SceneGraph,id:unknown):SceneNode {const node=typeof id==="string"?graph.getNode(id):undefined;if(!node||!["FRAME","RECTANGLE","ROUNDED_RECTANGLE","ELLIPSE","STAR","POLYGON","VECTOR","BOOLEAN_OPERATION","COMPONENT","INSTANCE"].includes(node.type))throw new Error("Choose a leaf image placeholder or closed shape.");editable(graph,node);if(node.type==="VECTOR"&&!node.vectorNetwork?.regions.length)throw new Error("Choose closed vector regions.");if(node.type!=="BOOLEAN_OPERATION"&&node.childIds.length)throw new Error("Choose a leaf image placeholder.");return node;}
export function canFillStockPhoto(graph:SceneGraph,id:string):boolean {try{photoTarget(graph,id);return true;}catch{return false;}}
function assertActive(signal?:AbortSignal):void {if(signal?.aborted)throw new Error("Asset request cancelled.");}
function current(signal?:AbortSignal) {
  assertActive(signal);assertPencilEditable();
  const editor=usePencilWorkspace.getState().editor,project=useXDProjects.getState().activeId;if(!editor||useXDProjects.getState().transitioning)throw new Error("Wait for the design canvas to load.");
  const graph=serializeGraph(editor.graph),page=editor.state.currentPageId,selection=[...editor.state.selectedIds];
  return{editor,assert(){assertActive(signal);assertPencilEditable();if(editor!==usePencilWorkspace.getState().editor||project!==useXDProjects.getState().activeId||useXDProjects.getState().transitioning||graph!==serializeGraph(editor.graph)||page!==editor.state.currentPageId||JSON.stringify(selection)!==JSON.stringify([...editor.state.selectedIds]))throw new Error("The design changed during the asset request.");}};
}
function publish<T>(editor:Editor,label:string,work:()=>T):T {editor.undo.beginBatch(label);try{const result=editPencilGraphAndView(editor,label,work);persistPencil();editor.undo.commitBatch();return result;}catch(error){editor.undo.rollbackBatch();throw error;}}
function task<T>(work:()=>Promise<T>):Promise<T> {return withPencilTask(()=>trackXDesignActivity("remote-assets","Wait for or cancel the asset request before switching projects.",work));}
async function preparedPhoto(photo:StockPhoto,signal?:AbortSignal) {
  assertActive(signal);const image=await downloadStockPhoto(photo,signal);assertActive(signal);const kit=await initializeCanvasKit();assertActive(signal);const decoded=kit.MakeImageFromEncoded(image.bytes);
  if(!decoded)throw new Error("The stock image could not decode.");try{if(decoded.width()!==image.width||decoded.height()!==image.height)throw new Error("The stock image dimensions changed.");}finally{decoded.delete();}return image;
}
function fillPhoto(editor:Editor,node:SceneNode,photo:StockPhoto,bytes:Uint8Array):void {const figma=new FigmaAPI(editor.graph),image=figma.createImage(bytes);figma.wrapNode(node.id).fills=[{type:"IMAGE",color:{r:1,g:1,b:1,a:1},imageHash:image.hash,imageScaleMode:"FILL",visible:true,opacity:1}];editor.graph.updateNode(node.id,{pluginData:node.pluginData.filter(entry=>entry.pluginId!=="orion.xdesign"||entry.key!=="photoDocumentId")});credit(editor.graph,node,photoCredit(photo));}
export async function placeStockPhoto(photo:StockPhoto,targetId?:string,signal?:AbortSignal):Promise<string> {
  assertPencilEditable();
  return task(async()=>{const context=current(signal),editor=context.editor;if(targetId)photoTarget(editor.graph,targetId);const image=await preparedPhoto(photo,signal);context.assert();await notifyStockDownload(photo,signal);context.assert();
    return publish(editor,"Place stock photo",()=>{let node=targetId?photoTarget(editor.graph,targetId):editor.graph.createNode("RECTANGLE",editor.state.currentPageId,{name:`Photo / ${photo.photographer}`,x:40,y:40,width:Math.min(640,image.width),height:Math.min(640,image.width)*image.height/image.width});fillPhoto(editor,node,photo,image.bytes);editor.select([node.id]);return node.id;});
  });
}
export async function runRemoteAssetTool(name:string,args:Record<string,unknown>,signal?:AbortSignal):Promise<unknown> {
  if(name==="insert_icon"||name==="stock_photo")assertPencilEditable();
  return task(async()=>{
    if(name==="search_icons")return searchIcons(args.queries as string[],numeric(args.limit,1,100,5),args.prefix as string|undefined,signal);
    if(name==="fetch_icons"){numeric(args.size,1,4096,24);const names=(args.names as string[]).map(iconName),icons=await fetchIcons(names,signal);return{fetched:[...icons.keys()],count:icons.size,...(names.some(name=>!icons.has(name))?{not_found:names.filter(name=>!icons.has(name))}:{})};}
    if(name==="insert_icon"){
      const context=current(signal),editor=context.editor,destination=parent(editor,args.parent_id);const names=(args.names??(args.name?[args.name]:[])) as string[];const size=numeric(args.size,1,4096,24),color=typeof args.color==="string"?args.color:"#000000";parseColor(color);const icons=await fetchIcons(names,signal);context.assert();const prepared=names.map(iconName).flatMap(name=>{const icon=icons.get(name);if(!icon)return[];const paths=iconPaths(icon,size,color);return paths?[{icon,paths}]:[];});context.assert();
      if(editor.graph.nodes.size+prepared.reduce((count,entry)=>count+1+entry.paths.paths.length,0)>10_000)throw new Error("This icon batch exceeds the 10,000-layer transaction limit.");
      if(!prepared.length)return{inserted:[],not_found:names};
      const inserted=publish(editor,"Insert icons",()=>{const created=prepared.map(({icon,paths},index)=>{const node=createSVGNodesFromImport(editor.graph,destination.id,paths,{name:`Icon / ${icon.name}`,x:index*(size+16),y:0});if(!node)throw new Error("The icon could not create vector layers.");credit(editor.graph,node,icon.credit);return{id:node.id,name:node.name,icon:icon.name};});editor.select(created.map(node=>node.id));return created;});
      if(args.name&&inserted.length===1)return{id:inserted[0]!.id,name:inserted[0]!.name,type:"FRAME"};const notFound=names.filter(name=>!prepared.some(entry=>entry.icon.name===name));return{inserted,...(notFound.length?{not_found:notFound}:{})};
    }
    if(name!=="stock_photo")throw new Error("Unknown resource tool.");
    if(typeof args.requests!=="string"||args.requests.length>64*1024)throw new Error("Provide a JSON array of stock-photo requests.");
    const raw:unknown=JSON.parse(args.requests),requests=Array.isArray(raw)?raw:[raw];if(!requests.length||requests.length>16)throw new Error("Apply stock photos to 1–16 layers.");
    const context=current(signal),editor=context.editor,provider=activeStockProvider();const prepared:{nodeId:string;photo:StockPhoto;bytes:Uint8Array}[]=[],results:Record<string,unknown>[]=[];
    for(const value of requests){
      context.assert();
      if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid stock-photo request.");const request=value as Record<string,unknown>;
      try{const target=photoTarget(editor.graph,request.id),query=assetQuery(request.query),index=numeric(request.index,0,14,0);if(!Number.isInteger(index))throw new Error("Choose an integer photo index.");const photos=await searchPhotos(provider,query,typeof request.orientation==="string"?request.orientation:"landscape",Math.max(1,target.width,target.height),Math.min(index+3,15),signal);context.assert();const photo=photos[Math.min(index,photos.length-1)];if(!photo)throw new Error(`No photos for "${query}".`);const image=await preparedPhoto(photo,signal);context.assert();if(prepared.reduce((total,item)=>total+item.bytes.length,0)+image.bytes.length>32*1024*1024)throw new Error("This stock batch exceeds the 32 MiB image preparation limit.");prepared.push({nodeId:target.id,photo,bytes:image.bytes});results.push({id:target.id,photo:{sourceId:photo.sourceId,photographer:photo.photographer,width:photo.width,height:photo.height,provider}});}catch(error){if(signal?.aborted)throw error;results.push({id:request.id,error:String(error)});}
    }
    context.assert();for(const item of prepared){context.assert();await notifyStockDownload(item.photo,signal);}context.assert();
    if(prepared.length)publish(editor,"Apply stock photos",()=>{for(const item of prepared)fillPhoto(editor,photoTarget(editor.graph,item.nodeId),item.photo,item.bytes);});
    return{applied:prepared.length,failed:results.length-prepared.length,provider,results};
  });
}

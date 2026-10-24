import { executePencilTool, editPencilGraphAsync, applyPencilGraphSnapshot } from "./toolExecution";
import { canonicalJSONString } from '@open-pencil/core/library';
import { reactive } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import { createEditor, createDefaultEditorState, type Editor } from "@open-pencil/core/editor";
import { FigmaAPI } from "@open-pencil/core/figma-api";
import { ALL_TOOLS } from "@open-pencil/core/tools";
import { SceneGraph } from "@open-pencil/scene-graph";
import { parse } from "valibot";
import { fontManager } from "@open-pencil/core/text";
import regularFont from "open-pencil-fonts/Inter-Regular.ttf?url";
import mediumFont from "open-pencil-fonts/Inter-Medium.ttf?url";
import semiBoldFont from "open-pencil-fonts/Inter-SemiBold.ttf?url";
import boldFont from "open-pencil-fonts/Inter-Bold.ttf?url";
import extraBoldFont from "open-pencil-fonts/Inter-ExtraBold.ttf?url";
import { getCanvasKit } from "@open-pencil/core/canvaskit";
import wasmURL from "canvaskit-wasm/bin/canvaskit.wasm?url";
import { useXDesign } from "../store";
import { useXDProjects, flushActive } from "../projectsStore";
import { deserializeGraph, serializeGraph, type PencilDocument, registerPencilSnapshot } from "./document";
import { trackXDesignActivity } from "../runtimeActivity";
import { bindPencilLibraries, pencilLibraries, type PencilLibrarySession } from "./librarySession";
import { installInstancePropertyUpdates } from "./instanceUpdates";
import { convertFigImageModes, exportFigImageCompatible } from "./figPaintCompatibility";
import { assertDesignImportSize } from "./designImportLimits";
import { installProceduralPaints } from "./proceduralPaints";
import { installVideoPaints, prepareVideo, placePreparedVideo, bakeVideoPosters } from './videoPaints';
import { installSlotEditing } from "./slotEditing";
import { installPrototypeEditing } from './prototypeEditing';
import { materializeCommentTargets } from './comments';
import { imageHash } from "./imageHash";
import { capPhotoUndo } from "./photoUndoCap";
import type { SharedEditorBinding, SharedEditorOptions } from './sharedEditor';
import type { SharedDesign } from './sharedDesign';
import type { RoomConnectionOptions, SharedRoomConnection } from './sharedRoomConnection';
import { encodeSharedCheckpoint, restoreSharedDesign, validateSharedDocumentId, type SharedCheckpoint } from './sharedCheckpoint';
import { ulid } from 'ulid';
import { readRoomImageBindings, findRoomImageBinding, type RoomImageBindings } from './roomImageBindings';
import { roomImageForNode, roomImageImportedBinding, roomImagePublicationPlan, roomImageRevisionPlan, roomImagePlacementState, type RoomImageCanvasScope, type RoomImagePlacementPlan } from './roomImageCanvas';
import type { RoomImageManifest } from './roomImageProtocol';
import { readRoomImagePluginData, roomImageReferenceText, type RoomImageReference } from './roomImageReferences';
import type { RoomImageResult } from './roomImageClient';
import type { PhotoDocument } from '../photo/types';
import { assertCanvasResourceRead, withCanvasResourceRead, type CanvasResourceRead } from './resourceRead';
import { expandRasterBounds, withRasterBoundsPadding } from './nativeRasterBounds';
installProceduralPaints();
installVideoPaints();

export const usePencilWorkspace=create<{editor:Editor|null;version:number;error:string|null;busy:boolean;readOnly:boolean}>(()=>({editor:null,version:0,error:null,busy:false,readOnly:false}));
export function assertPencilEditable():void {if(usePencilWorkspace.getState().readOnly)throw new Error('This room has viewer access. Artwork changes are unavailable.');}
export const designTools=ALL_TOOLS.filter(t=>!t.capabilities.some(c=>["filesystem:read","filesystem:write","network:access","code:execute"].includes(c)));
export const REMOTE_ASSET_TOOLS=["fetch_icons","insert_icon","search_icons","stock_photo"];
for(const name of REMOTE_ASSET_TOOLS){const tool=ALL_TOOLS.find(tool=>tool.name===name);if(tool)designTools.push({...tool,execute:async(_figma,args)=>{const {runRemoteAssetTool}=await import("./assetRuntime");return runRemoteAssetTool(name,args);}});}
export const ISOLATED_SCRIPT_TOOLS=["eval"];
const scriptTool=ALL_TOOLS.find(tool=>tool.name==="eval");
if(scriptTool)designTools.push({...scriptTool,description:"Execute JavaScript with the OpenPencil figma API in an isolated worker, then atomically apply the validated draft. No filesystem, network or Orion credentials are available.",execute:async(_figma,args)=>{const {runPencilScript}=await import("./scriptRuntime");return runPencilScript(args.code as string);}});
const fonts:Record<string,string>={Regular:regularFont,Medium:mediumFont,SemiBold:semiBoldFont,Bold:boldFont,ExtraBold:extraBoldFont};
fontManager.setHostFontLoader(async(family,style)=>{const url=family==="Inter"?fonts[style]:null;if(url){const reply=await fetch(url);return reply.ok?reply.arrayBuffer():null;}if(!isTauri())return null;const base64=await invoke<string|null>("xdesign_font_load",{family,style});if(!base64)return null;const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));return bytes.buffer;});
fontManager.setOnlineFontProviders({google:false,fontshare:false,fontsource:false});
export const initializeCanvasKit=()=>getCanvasKit({locateFile:()=>wasmURL});
export async function withPencilTask<T>(work:()=>Promise<T>):Promise<T> {
  if(usePencilWorkspace.getState().busy)throw new Error("Wait for the current design action to finish");
  const editor = usePencilWorkspace.getState().editor, project = useXDProjects.getState().activeId;
  const owns = () => usePencilWorkspace.getState().editor === editor && useXDProjects.getState().activeId === project;
  usePencilWorkspace.setState({busy:true,error:null});
  try{return await work();}catch(error){if(owns())usePencilWorkspace.setState({error:String(error)});throw error;}finally{if(owns())usePencilWorkspace.setState({busy:false});}
}
export async function runPencilLibraryAction<T>(work:(session:PencilLibrarySession, read:CanvasResourceRead)=>Promise<T>):Promise<T> {
  assertPencilEditable();
  return withPencilTask(()=>trackXDesignActivity("component-library","Wait for the component library action before switching projects.",async()=>{
    const editor=usePencilWorkspace.getState().editor;if(!editor)throw new Error("Wait for the design canvas to load");
    const project = activeProject;
    return withCanvasResourceRead(editor, () => {
      assertPencilEditable();
      if (usePencilWorkspace.getState().editor !== editor || activeProject !== project || project !== useXDProjects.getState().activeId || useXDProjects.getState().transitioning) throw new Error('The library source changed while loading images.');
    }, async read => {
      const result=await work(pencilLibraries(editor), read);editor.requestRender();persistPencil();return result;
    });
  }));
}
export async function libraryPhotoBytes(photoId:string):Promise<Uint8Array> {
  const {fullResolutionPhotoPath}=await import("../photo/exportResources");
  const {convertFileSrc}=await import("@tauri-apps/api/core");
  const response=await fetch(convertFileSrc(await fullResolutionPhotoPath(photoId)));
  if(!response.ok)throw new Error("A linked image could not be read for the library");
  const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>48*1024*1024)throw new Error("A library image exceeds 48MB");return bytes;
}
let photoLinks:Record<string,string>={};
let roomImages: RoomImageBindings = { version: 1, bindings: [] };
const roomImageScopes = new WeakMap<Editor, () => RoomImageCanvasScope | null>();
export function bindPencilRoomImages(editor: Editor, scope: () => RoomImageCanvasScope | null): () => void {
  roomImageScopes.set(editor, scope);
  return () => { if (roomImageScopes.get(editor) === scope) roomImageScopes.delete(editor); };
}
export function pencilRoomImageBinding(nodeId: string) {
  const editor = usePencilWorkspace.getState().editor, scope = editor && roomImageScopes.get(editor)?.();
  return editor && scope ? roomImageForNode(editor.graph, nodeId, roomImages, scope) : null;
}
export function pencilRoomImageReference(reference: RoomImageReference) {
  const editor = usePencilWorkspace.getState().editor, scope = editor && roomImageScopes.get(editor)?.();
  return editor && scope ? findRoomImageBinding(roomImages, scope.serverUrl, scope.documentId, reference) : null;
}
export function pencilRoomImageCandidates(nodeId: string) {
  const editor = usePencilWorkspace.getState().editor, scope = editor && roomImageScopes.get(editor)?.();
  const node = editor?.graph.getNode(nodeId), photoId = node && pencilPhotoDocumentId(nodeId), current = node && readRoomImagePluginData(node.pluginData);
  return scope && photoId ? roomImages.bindings.filter(binding => binding.serverUrl === scope.serverUrl && binding.documentId === scope.documentId && binding.photo.id === photoId && (!current || roomImageReferenceText(binding.reference) !== roomImageReferenceText(current))).map(binding => structuredClone(binding)) : [];
}
function imagePlacementDestination(scope: RoomImageCanvasScope): Editor {
  const editor = usePencilWorkspace.getState().editor, actual = editor && roomImageScopes.get(editor)?.();
  assertPencilEditable();
  if (!editor || activeProject !== useXDProjects.getState().activeId || useXDProjects.getState().transitioning || actual?.serverUrl !== scope.serverUrl || actual.documentId !== scope.documentId) throw new Error('The image destination changed. Review its placements again.');
  return editor;
}
export type PreparedRoomImagePlacement = { plan: RoomImagePlacementPlan; preview: Uint8Array };
export async function preparePencilRoomImagePlacement(scope: RoomImageCanvasScope, nodeId: string, reference: RoomImageReference, manifest: RoomImageManifest): Promise<PreparedRoomImagePlacement> {
  const editor = imagePlacementDestination(scope), binding = pencilRoomImageCandidates(nodeId).find(candidate => roomImageReferenceText(candidate.reference) === roomImageReferenceText(reference));
  if (!editor.graph.getNode(nodeId)?.fills.some(fill => fill.type === 'IMAGE')) throw new Error('Select an image placement before using a published revision.');
  if (!binding) throw new Error('This published image is no longer available for the selected placement.');
  const response = await fetch((await import('@tauri-apps/api/core')).convertFileSrc(binding.photo.previewPath));
  if (!response.ok) throw new Error('The published image preview could not be read.');
  const preview = new Uint8Array(await response.arrayBuffer());
  if (imagePlacementDestination(scope) !== editor) throw new Error('The image destination changed. Review its placements again.');
  const plan = await roomImageRevisionPlan(editor.graph, roomImages, scope, binding.photo, manifest, preview);
  if (imagePlacementDestination(scope) !== editor || JSON.stringify(plan.binding) !== JSON.stringify(binding) || !plan.patches.some(patch => patch.nodeId === nodeId)) throw new Error('This revision does not replace the selected image’s original placement. Its artwork was preserved.');
  return { plan, preview };
}
export async function applyPencilRoomImagePlacement(scope: RoomImageCanvasScope, prepared: PreparedRoomImagePlacement): Promise<void> {
  const editor = imagePlacementDestination(scope), { plan, preview } = prepared;
  if (JSON.stringify(pencilRoomImageReference(plan.binding.reference)) !== JSON.stringify(plan.binding)) throw new Error('The saved image mapping changed. Review its placements again.');
  const remaining = plan.patches.filter(patch => {
    const node = editor.graph.getNode(patch.nodeId), current = node && roomImagePlacementState(node.fills, node.pluginData);
    if (current === roomImagePlacementState(patch.fills, patch.pluginData)) return false;
    if (current !== patch.before) throw new Error('An image placement changed after review. Review it again before applying this revision.');
    return true;
  });
  if (remaining.length) {
    const originals = new Map(remaining.map(patch => [patch.nodeId, structuredClone(editor.graph.getNode(patch.nodeId)!)]));
    editor.undo.beginBatch('Use published image');
    try {
      editor.storeImage(preview);
      for (const { nodeId, before, ...patch } of remaining) {
        if (imagePlacementDestination(scope) !== editor) throw new Error('The image destination changed while applying its revision.');
        const node = editor.graph.getNode(nodeId);
        if (!node || roomImagePlacementState(node.fills, node.pluginData) !== before) throw new Error('An image placement changed during apply. Review it again before continuing.');
        editor.updateNodeWithUndo(nodeId, patch, 'Use published image');
      }
      imagePlacementDestination(scope);
      editor.undo.commitBatch();
    } catch (error) {
      // Shared batch rollback restores a whole snapshot. Retain intervening edits
      // while removing only our fields that still match the attempted patch.
      const restored = deserializeGraph(serializeGraph(editor.graph));
      for (const patch of remaining) {
        const node = restored.getNode(patch.nodeId), original = originals.get(patch.nodeId)!;
        if (!node) continue;
        for (const field of ['fills', 'pluginData'] as const) if (canonicalJSONString(node[field]) === canonicalJSONString(patch[field])) {
          Object.assign(node, { [field]: structuredClone(original[field]) });
          if (!original.source.editedFields.includes(field)) node.source = { ...node.source, editedFields: node.source.editedFields.filter(item => item !== field) };
        }
      }
      editor.undo.rollbackBatch(); applyPencilGraphSnapshot(editor, restored);
      currentSharedPencilBinding()?.binding.flush(); persistPencil(); throw error;
    }
  }
  editor.requestRender(); persistPencil(); await flushActive();
  if (imagePlacementDestination(scope) !== editor) throw new Error('The image destination changed after saving.');
}
export async function libraryRoomImageBytes(reference: RoomImageReference, read: CanvasResourceRead): Promise<Uint8Array> {
  assertCanvasResourceRead(read, read.editor);
  const { canvasRoomSession } = await import('./roomSession'), room = canvasRoomSession(read.editor);
  if (!room) throw new Error('Reconnect the shared image’s original room before loading its editable contents.');
  const photo = await room.resolveImageResource(reference, read); assertCanvasResourceRead(read, read.editor);
  const projectId = useXDProjects.getState().activeId;
  const path = await invoke<string>('xdesign_photo_render', { projectId, photoId: photo.id, version: photo.version }); assertCanvasResourceRead(read, read.editor);
  const response = await fetch((await import('@tauri-apps/api/core')).convertFileSrc(path));
  if (!response.ok) throw new Error('The full-resolution shared image could not be read.');
  const bytes = new Uint8Array(await response.arrayBuffer()); assertCanvasResourceRead(read, read.editor);
  if (!bytes.length || bytes.byteLength > 48 * 1024 * 1024) throw new Error('A full-resolution shared image exceeds its 48 MB resource limit or is empty.');
  return bytes;
}
export async function savePencilRoomImageResult(scope: RoomImageCanvasScope, result: Exclude<RoomImageResult, { kind: 'prepared' }>): Promise<void> {
  const editor = usePencilWorkspace.getState().editor, project = activeProject;
  const current = () => {
    const actual = editor && roomImageScopes.get(editor)?.();
    if (!editor || usePencilWorkspace.getState().editor !== editor || project !== useXDProjects.getState().activeId || useXDProjects.getState().transitioning || actual?.serverUrl !== scope.serverUrl || actual.documentId !== scope.documentId) throw new Error('The image destination changed. Recover the original transfer in its room.');
  };
  current();
  if (result.kind === 'published') {
    const response = await fetch((await import('@tauri-apps/api/core')).convertFileSrc(result.source.previewPath));
    if (!response.ok) throw new Error('The reviewed native preview could not be read. The publication receipt was retained.');
    const bytes = new Uint8Array(await response.arrayBuffer()); current();
    const plan = await roomImagePublicationPlan(editor!.graph, roomImages, scope, result, bytes); current();
    roomImages = plan.bindings;
    useXDesign.setState(state => ({ photoDocuments: { ...state.photoDocuments, [result.source.id]: state.photoDocuments[result.source.id] ?? result.source } }));
    if (!usePencilWorkspace.getState().readOnly && plan.patches.length) {
      editor!.undo.beginBatch('Publish shared image');
      try {
        editor!.storeImage(bytes);
        for (const { nodeId, before, ...patch } of plan.patches) {
          const node = editor!.graph.getNode(nodeId);
          if (node && roomImagePlacementState(node.fills, node.pluginData) === before) editor!.updateNodeWithUndo(nodeId, patch, 'Publish shared image');
        }
        editor!.undo.commitBatch();
      } catch (error) { editor!.undo.rollbackBatch(); persistPencil(); throw error; }
    }
  } else {
    const plan = roomImageImportedBinding(roomImages, scope, result);
    const existing = useXDesign.getState().photoDocuments[result.photo.id];
    if (existing && !roomImages.bindings.some(item => JSON.stringify(item) === JSON.stringify(plan.binding))) throw new Error('The imported image identity is already in use. The original artwork was preserved.');
    if (!existing && Object.keys(useXDesign.getState().photoDocuments).length >= 1024) throw new Error('This project has reached its editable image limit. The imported transfer was retained.');
    roomImages = plan.bindings;
    useXDesign.setState(state => ({ photoDocuments: { ...state.photoDocuments, [result.photo.id]: state.photoDocuments[result.photo.id] ?? result.photo } }));
  }
  editor!.requestRender(); persistPencil(); await flushActive(); current();
}
let activeProject:string|null=null;
let activeShared:{binding:SharedEditorBinding;documentId:string;stored?:{revision:number;value:SharedCheckpoint}}|null=null;
export function currentSharedPencilBinding():{binding:SharedEditorBinding;documentId:string}|null {
  return activeShared&&activeShared.binding.editor===usePencilWorkspace.getState().editor&&activeProject===useXDProjects.getState().activeId?{binding:activeShared.binding,documentId:activeShared.documentId}:null;
}
// Every graph mutation path ends in requestRender (sceneVersion++), the same key the
// renderer caches its scene picture on. Reusing the encoding keeps view, selection and
// autosave snapshots from re-packing image bytes on the main thread.
let encodedGraph:{graph:SceneGraph;sceneVersion:number;json:string}|null=null;
function persistedGraph(editor:Editor):string {
  const graph=editor.graph,sceneVersion=editor.state.sceneVersion;
  if(encodedGraph?.graph!==graph||encodedGraph.sceneVersion!==sceneVersion)encodedGraph={graph,sceneVersion,json:serializeGraph(graph,{referencedImagesOnly:true})};
  return encodedGraph.json;
}
export function currentPencilSnapshot():PencilDocument|null {
  const editor=usePencilWorkspace.getState().editor;
  if(!editor || activeProject!==useXDProjects.getState().activeId) return useXDesign.getState().pencilDocument;
  if(activeShared?.binding.editor===editor){
    const snapshot=activeShared.binding.snapshot({acceptedOnly:useXDProjects.getState().transitioning});
    photoLinks=Object.fromEntries(Object.entries(snapshot.photoLinks).filter(([,id])=>useXDesign.getState().photoDocuments[id]));
    if(activeShared.stored?.revision!==snapshot.revision)activeShared.stored={revision:snapshot.revision,value:encodeSharedCheckpoint(activeShared.documentId,snapshot.checkpoint)};
    return {formatVersion:1,graph:snapshot.graph,pageId:snapshot.view.page,panX:snapshot.view.panX,panY:snapshot.view.panY,zoom:snapshot.view.zoom,photoLinks:{...photoLinks},...(roomImages.bindings.length?{roomImages:structuredClone(roomImages)}:{}),shared:activeShared.stored.value};
  }
  photoLinks=Object.fromEntries([...editor.graph.nodes.values()].flatMap(node=>{const id=node.pluginData.find(p=>p.pluginId==="orion.xdesign"&&p.key==="photoDocumentId")?.value;return id&&useXDesign.getState().photoDocuments[id]?[[node.id,id]]:[];}));
  return {formatVersion:1,graph:persistedGraph(editor),pageId:editor.state.currentPageId,panX:editor.state.panX,panY:editor.state.panY,zoom:editor.state.zoom,photoLinks:{...photoLinks},...(roomImages.bindings.length?{roomImages:structuredClone(roomImages)}:{})};
}
export function persistPencil() {
  const doc=currentPencilSnapshot();
  const previous=useXDesign.getState().pencilDocument;
  if(doc && activeProject===useXDProjects.getState().activeId && !(previous&&doc.graph===previous.graph&&doc.pageId===previous.pageId&&doc.panX===previous.panX&&doc.panY===previous.panY&&doc.zoom===previous.zoom&&JSON.stringify(doc.photoLinks)===JSON.stringify(previous.photoLinks)&&doc.shared?.documentId===previous.shared?.documentId&&doc.shared?.checkpoint===previous.shared?.checkpoint&&JSON.stringify(doc.roomImages)===JSON.stringify(previous.roomImages)))useXDesign.setState({pencilDocument:doc});
}
export function startPencilSession(element:HTMLElement,doc:PencilDocument,onReady:()=>void,bindShared?: (editor:Editor)=>SharedEditorBinding) {
  if(doc.shared&&!bindShared)throw new Error('Open this saved shared design through the recoverable session loader. Its checkpoint was preserved.');
  const graph=deserializeGraph(doc.graph);
  materializeCommentTargets(graph);
  const state=reactive(createDefaultEditorState(doc.pageId));
  Object.assign(state,{panX:doc.panX,panY:doc.panY,zoom:doc.zoom});
  const editor=createEditor({graph,state,getViewportSize:()=>({width:element.clientWidth,height:element.clientHeight})});
  const restoreInstanceUpdates=installInstancePropertyUpdates(editor);
  const restoreSlotEditing=installSlotEditing(editor);
  const restorePrototypeEditing=installPrototypeEditing(editor);
  editor.state.documentName=useXDProjects.getState().registry.find(p=>p.id===useXDProjects.getState().activeId)?.name??"design";
  photoLinks={...doc.photoLinks};roomImages=readRoomImageBindings(doc.roomImages);activeProject=useXDProjects.getState().activeId;
  usePencilWorkspace.setState({editor,error:null,readOnly:false});
  const project=activeProject;
  const unbindLibraries=bindPencilLibraries(editor,project!,()=>{if(usePencilWorkspace.getState().editor!==editor||project!==useXDProjects.getState().activeId||useXDProjects.getState().transitioning)throw new Error("The library's design project is no longer active");});
  let shared:SharedEditorBinding|undefined;
  try{shared=bindShared?.(editor);}catch(error){unbindLibraries();restorePrototypeEditing();restoreSlotEditing();restoreInstanceUpdates();editor.dispose();usePencilWorkspace.setState({editor:null,error:String(error)});activeProject=null;if(activeShared?.binding.editor===editor)activeShared=null;throw error;}
  let timer:ReturnType<typeof setTimeout>|null=null;
  let changed=false;
  const update=()=>{
    usePencilWorkspace.setState(s=>({version:s.version+1}));
    if(editor.isInteractiveEditing()) return;
    changed=true;
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=null;try{persistPencil();changed=false;}catch(error){usePencilWorkspace.setState({error:String(error)});}},250);
  };
  const subscriptions=(["render:requested","selection:changed","page:changed","viewport:changed"] as const).map(event=>editor.onEditorEvent(event,update));
  const unsubscribe=()=>subscriptions.forEach(stop=>stop());
  const unregister=registerPencilSnapshot(currentPencilSnapshot);
  let disposed=false;
  const session={editor,shared,dispose(saveChanges=true){
    if(disposed)return;disposed=true;
    unsubscribe();if(timer)clearTimeout(timer);
    if(changed&&saveChanges){try{persistPencil();}catch(error){usePencilWorkspace.setState({error:String(error)});}}
    if(encodedGraph?.graph===editor.graph)encodedGraph=null;
    unregister();unbindLibraries();restorePrototypeEditing();restoreSlotEditing();restoreInstanceUpdates();if(shared)shared.dispose();else editor.dispose();if(activeShared?.binding.editor===editor)activeShared=null;if(usePencilWorkspace.getState().editor===editor){usePencilWorkspace.setState({editor:null,readOnly:false});activeProject=null;}
  }};
  try{onReady();return session;}catch(error){session.dispose(false);throw error;}
}
export type SharedSessionOptions=SharedEditorOptions&{documentId?:string;room?:RoomConnectionOptions};
export async function startSharedPencilSession(element:HTMLElement,doc:PencilDocument,replica:SharedDesign,onReady:()=>void,options:SharedSessionOptions={}) {
  const project=useXDProjects.getState().activeId;
  const original=useXDesign.getState().pencilDocument;
  const documentId=options.documentId??doc.shared?.documentId??ulid();validateSharedDocumentId(documentId);
  const [{SharedEditorBinding},roomModule]=await Promise.all([import('./sharedEditor'),options.room?import('./sharedRoomConnection'):Promise.resolve(null)]);
  if(project!==useXDProjects.getState().activeId||useXDProjects.getState().transitioning||options.isCurrent&&!options.isCurrent())throw new Error('The shared design project changed while loading.');
  const session=startPencilSession(element,doc,onReady,editor=>{
    let ownsBusy=false;
    const isCurrent=()=>usePencilWorkspace.getState().editor===editor&&project===useXDProjects.getState().activeId&&!useXDProjects.getState().transitioning&&(!options.isCurrent||options.isCurrent());
    const publish=()=>{
      const previous=useXDesign.getState().pencilDocument;
      try{
        const result:unknown=(options.publish??persistPencil)();
        if(result&&typeof result==='object'&&'then' in result){void Promise.resolve(result).catch(()=>{});throw new Error('Shared editor publication must be synchronous.');}
      }catch(error){
        if(usePencilWorkspace.getState().editor===editor&&useXDProjects.getState().activeId===project){try{useXDesign.setState({pencilDocument:previous});}catch{/* State is restored before subscriber notification. */}}
        throw error;
      }
    };
    const binding=new SharedEditorBinding(editor,replica,{...options,isCurrent,publish,onBusyChange:busy=>{
      if(busy&&isCurrent()&&!usePencilWorkspace.getState().busy){ownsBusy=true;usePencilWorkspace.setState({busy:true});}
      if(!busy&&ownsBusy){ownsBusy=false;if(usePencilWorkspace.getState().editor===editor)usePencilWorkspace.setState({busy:false});}
      options.onBusyChange?.(busy);
    },onError:error=>{if(usePencilWorkspace.getState().editor===editor)usePencilWorkspace.setState({error:error.message});options.onError?.(error);}});
    activeShared={binding,documentId};return binding;
  });
  let room:SharedRoomConnection|undefined;
  try{
    persistPencil();
    if(options.room&&roomModule){
      const owns=()=>usePencilWorkspace.getState().editor===session.editor&&useXDProjects.getState().activeId===project&&!useXDProjects.getState().transitioning&&(!options.isCurrent||options.isCurrent())&&(!options.room?.isCurrent||options.room.isCurrent());
      room=new roomModule.SharedRoomConnection(documentId,session.shared!,{...options.room,isCurrent:owns,onState:state=>{if(owns())options.room?.onState?.(state);}});
      room.connect();
    }
    return {...session,room,dispose(saveChanges=true){room?.dispose();session.dispose(saveChanges);}};
  }catch(error){
    const owned=usePencilWorkspace.getState().editor===session.editor&&useXDProjects.getState().activeId===project;
    room?.dispose();session.dispose(false);
    if(owned&&useXDProjects.getState().activeId===project){try{useXDesign.setState({pencilDocument:original});}catch{/* Preserve the record even if an observer rejects its notification. */}}
    throw error;
  }
}
export async function openPencilSession(element:HTMLElement,doc:PencilDocument,onReady:()=>void,options:SharedSessionOptions={}) {
  if(!doc.shared)return startPencilSession(element,doc,onReady);
  const replica=restoreSharedDesign(doc);
  try{
    const session=await startSharedPencilSession(element,doc,replica,onReady,{...options,documentId:doc.shared.documentId});
    return {editor:session.editor,shared:session.shared,room:session.room,dispose(){session.dispose();replica.dispose();}};
  }catch(error){replica.dispose();throw error;}
}
export async function newPencilProject(file?:File):Promise<void> {
  // Import always creates a project so an existing document cannot be overwritten.
  let graph=new SceneGraph();
  if(file){
    assertDesignImportSize(file.name,file.size);
    const {parsePenFile}=await import("@open-pencil/core/io");
    graph=file.name.toLowerCase().endsWith(".pen")?parsePenFile(await file.text()):await (await import("./figSlots")).parseFigWithSlots(await file.arrayBuffer());
    convertFigImageModes(graph,"import");
  }
  const doc:PencilDocument={formatVersion:1,graph:serializeGraph(graph),pageId:graph.getPages()[0]!.id,panX:0,panY:0,zoom:1,photoLinks:{}};
  await useXDProjects.getState().newProject(file?.name.replace(/\.(fig|pen)$/i,"")??"Untitled design");
  useXDesign.setState({pencilDocument:doc});
  await flushActive();
}
export async function placePencilVideo(file:File):Promise<string> {
  assertPencilEditable();
  return withPencilTask(()=>trackXDesignActivity('canvas-image-import','Wait for video import before switching projects.',async()=>{
    const editor=usePencilWorkspace.getState().editor,project=useXDProjects.getState().activeId;
    if(!editor||activeProject!==project||useXDProjects.getState().transitioning)throw new Error('Wait for the design canvas to load.');
    const pageId=editor.state.currentPageId,selected=editor.getSelectedNodes()[0];
    const prepared=await prepareVideo(file);
    if(usePencilWorkspace.getState().editor!==editor||useXDProjects.getState().activeId!==project||editor.state.currentPageId!==pageId)throw new Error('The destination changed during video import.');
    assertPencilEditable();
    const parent=selected?.type==='FRAME'?selected:editor.graph.getNode(pageId)!;
    let current:typeof parent|undefined=parent;
    while(current){if(current.locked||current.internalOnly||current.librarySource?.readOnly)throw new Error('Choose an unlocked destination for this video.');current=current.parentId?editor.graph.getNode(current.parentId):undefined;}
    const x=parent.type==='CANVAS'?editor.graph.getChildren(pageId).reduce((right,node)=>Math.max(right,node.x+node.width),0)+40:20;
    const id=placePreparedVideo(editor,prepared,x,20,parent.id);persistPencil();return id;
  }));
}
/** Scene point under a client position on the design canvas, or at the middle of the view. */
export function pencilCanvasPoint(client?:{x:number;y:number}):{x:number;y:number}|null {
  const editor=usePencilWorkspace.getState().editor,host=document.querySelector<HTMLElement>(".xd-pencil-canvas");
  if(!editor||!host)return null;
  const rect=host.getBoundingClientRect(),inside=!!client&&client.x>=rect.left&&client.x<=rect.right&&client.y>=rect.top&&client.y<=rect.bottom;
  return editor.screenToCanvas(inside?client!.x-rect.left:rect.width/2,inside?client!.y-rect.top:rect.height/2);
}
export async function placePencilAsset(source:string,name:string,x:number,y:number,width?:number,height?:number):Promise<void> {
  assertPencilEditable();
  return withPencilTask(()=>trackXDesignActivity("canvas-image-import","Wait for image import to finish before changing projects.",async()=>{
    const editor=usePencilWorkspace.getState().editor;const project=useXDProjects.getState().activeId;
    if(!editor||activeProject!==project||useXDProjects.getState().transitioning)throw new Error("Wait for the design canvas to load");
    const {convertFileSrc}=await import("@tauri-apps/api/core");const response=await fetch(source.startsWith("data:")?source:convertFileSrc(source));if(!response.ok)throw new Error("The image could not be read");
    const blob=await response.blob();const type=name.toLowerCase().endsWith(".svg")?"image/svg+xml":blob.type||"image/png";
    const file=new File([blob],name,{type});
    assertPencilEditable();if(usePencilWorkspace.getState().editor!==editor||project!==useXDProjects.getState().activeId||useXDProjects.getState().transitioning)throw new Error("The destination changed during image import");
    editor.undo.beginBatch("Place image");
    const beforeIds=new Set(editor.graph.nodes.keys());
    try{await editor.placeFiles([file],x+(width??0)/2,y+(height??0)/2);if(project!==useXDProjects.getState().activeId)throw new Error("The project changed during image import");assertPencilEditable();const nodes=editor.getSelectedNodes().filter(node=>!beforeIds.has(node.id));if(!nodes.length)throw new Error("This image format could not be placed");if(width&&height&&nodes.length===1)editor.updateNodeWithUndo(nodes[0]!.id,{width,height});persistPencil();editor.undo.commitBatch();}catch(error){editor.undo.rollbackBatch();throw error;}
  }));
}
export function executeDesignTool(name:string,input:Record<string,unknown>):unknown {
  const editor=usePencilWorkspace.getState().editor;
  if(!editor || usePencilWorkspace.getState().busy || activeProject!==useXDProjects.getState().activeId || useXDProjects.getState().transitioning)throw new Error("Wait for the design canvas and its current action to finish");
  const tool=designTools.find(t=>t.name===name);
  if(!tool)throw new Error("This action needs a separate Orion integration");
  if(tool.execution.mutation!=="none"&&tool.execution.mutation!=="view")assertPencilEditable();
  const args=parse(tool.input,input);
  const figma=new FigmaAPI(editor.graph);
  figma.currentPage=figma.wrapNode(editor.state.currentPageId);
  figma.currentPage.selection=[...editor.state.selectedIds].map(id=>figma.wrapNode(id));
  figma.setRenderer(editor.renderer);
  const result=executePencilTool(editor,figma,tool,args);
  persistPencil();return result;
}
export async function executeDesignToolAsync(name:string,input:Record<string,unknown>):Promise<unknown> {
  const tool=designTools.find(t=>t.name===name);if(!tool)throw new Error("This action needs a separate Orion integration");
  if(tool.execution.mutation!=="none"&&tool.execution.mutation!=="view"||name==="eval"||name==="insert_icon"||name==="stock_photo")assertPencilEditable();
  if(REMOTE_ASSET_TOOLS.includes(name)){const args=parse(tool.input,input);const {runRemoteAssetTool}=await import("./assetRuntime");return runRemoteAssetTool(name,args);}
  if(name==="eval"){const args=parse(tool.input,input);const {runPencilScript}=await import("./scriptRuntime");return runPencilScript(args.code as string);}
  if(tool.execution.kind==="sync")return executeDesignTool(name,input);
  const editor=usePencilWorkspace.getState().editor;const project=useXDProjects.getState().activeId;
  if(!editor||usePencilWorkspace.getState().busy||activeProject!==project||useXDProjects.getState().transitioning)throw new Error("Wait for the design canvas and its current action to finish");
  if(JSON.stringify(input).length>1024*1024)throw new Error("Design action parameters exceed 1MB");
  const args=parse(tool.input,input);if(args.path)throw new Error("Use the Export button to choose a destination in Orion");
  const figma=new FigmaAPI(editor.graph);figma.currentPage=figma.wrapNode(editor.state.currentPageId);figma.currentPage.selection=[...editor.state.selectedIds].map(id=>figma.wrapNode(id));figma.setRenderer(editor.renderer);
  usePencilWorkspace.setState({busy:true,error:null});
  try{return await trackXDesignActivity("ui-tool","Wait for the design action before switching projects or disabling XDesign.",async()=>{
    const work=async()=>{let result:unknown;if(name==="list_available_fonts"&&isTauri()){const fonts=await invoke<string[]>("xdesign_font_families");const filtered=fonts.filter(f=>!args.family||f.toLowerCase().includes(String(args.family).toLowerCase()));result={count:filtered.length,fonts:filtered};}else if(["export_svg","export_pdf","export_image"].includes(name)){const ids=(args.ids as string[]|undefined)??editor.graph.getChildren(editor.state.currentPageId).map(n=>n.id);const format=name==="export_svg"?"SVG":name==="export_pdf"?"PDF":args.format as "PNG"|"JPG"|"WEBP";let scale=Number(args.scale??1);if(name==="export_image"){const io=await import("@open-pencil/core/io");const base=io.computeContentBounds(editor.graph,ids);const bounds=base&&expandRasterBounds(editor.graph,ids,base);if(bounds)scale=Math.min(scale,Number(args.maxEdge??1280)/Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY));}const bytes=await exportPencilContents(format,scale,ids);if(format==="SVG")result={svg:new TextDecoder().decode(bytes)};else{let data="";for(let i=0;i<bytes.length;i+=8192)data+=String.fromCharCode(...bytes.subarray(i,i+8192));result={mimeType:format==="PDF"?"application/pdf":format==="JPG"?"image/jpeg":`image/${format.toLowerCase()}`,base64:btoa(data),byteLength:bytes.length};}}else if(name==="render"){const {renderDesignJSX}=await import("./designJsx");result=await renderDesignJSX(editor.graph,editor.state.currentPageId,args);}else result=await tool.execute(figma,args);if(result&&typeof result==="object"&&"error" in result)throw new Error(String(result.error));if(project!==useXDProjects.getState().activeId)throw new Error("The project changed during the action");return result;};
    const result=tool.execution.mutation==="document"?await editPencilGraphAsync(editor,tool.name.replaceAll("_"," "),work):await work();editor.requestRender();persistPencil();return result;
  });}catch(error){usePencilWorkspace.setState({error:String(error)});throw error;}finally{usePencilWorkspace.setState({busy:false});}
}
export type PencilExportFormat="FIG"|"SVG"|"PNG"|"JPG"|"WEBP"|"PDF"|"PPTX"|"JSX"|"REACT"|"NATIVE_REACT";
export async function exportPencil(format:PencilExportFormat,scale=1,targetIds?:string[]):Promise<Uint8Array> {
  return withPencilTask(() => exportPencilContents(format, scale, targetIds));
}
async function exportPencilContents(format:PencilExportFormat,scale=1,targetIds?:string[]):Promise<Uint8Array> {
  return trackXDesignActivity("canvas-export","Wait for design export to finish before changing projects.",async()=>{
    const editor=usePencilWorkspace.getState().editor;
    if(!editor)throw new Error("Open a design canvas before exporting");
    const project = activeProject;
    return withCanvasResourceRead(editor, () => {
      if (usePencilWorkspace.getState().editor !== editor || activeProject !== project || project !== useXDProjects.getState().activeId || useXDProjects.getState().transitioning) throw new Error('The export source changed while loading images.');
    }, async read => {
    const io=await import("@open-pencil/core/io");
    const pageId=editor.state.currentPageId;
    const ids=targetIds??(editor.state.selectedIds.size?[...editor.state.selectedIds]:editor.graph.getChildren(pageId).map(n=>n.id));
    const reactExport=format==="REACT"||format==="NATIVE_REACT"?await import("./reactExport"):null;
    let exportRoots=ids;
    if(format==='NATIVE_REACT') {
      if(ids.length!==1)throw new Error('Select one starting layer for native React export.');
      const {resolveNativeReactScreens}=await import('./nativeReactScreens');exportRoots=resolveNativeReactScreens(editor.graph,ids[0]!);
    }
    const graph=reactExport?reactExport.cloneReactExportGraph(editor.graph,exportRoots):deserializeGraph(serializeGraph(editor.graph));
    if(format==='FIG'&&[...graph.nodes.values()].some(node=>node.fills.some(fill=>fill.type==='VIDEO')))throw new Error('Save a portable XDesign project to keep playable videos. FIG export cannot carry these media resources yet.');
    if(!reactExport)bakeVideoPosters(graph);
    const {fullResolutionPhotoPath}=await import("../photo/exportResources");
    const {convertFileSrc}=await import("@tauri-apps/api/core");
    const {computeImageHash}=await import("@open-pencil/scene-graph");
    const exportedNodes = new Set<string>(), remaining = [...ids];
    while (remaining.length) {
      const id = remaining.pop()!; if (exportedNodes.has(id)) continue; exportedNodes.add(id);
      const node = graph.getNode(id); if (node) remaining.push(...node.childIds);
    }
    const resources = new Map<string, Uint8Array>();
    for(const node of graph.nodes.values()){
      if (format !== 'FIG' && !reactExport && !exportedNodes.has(node.id)) continue;
      const sharedReference = readRoomImagePluginData(node.pluginData);
      const photoId = node.pluginData.find(entry=>entry.pluginId==='orion.xdesign'&&entry.key==='photoDocumentId')?.value;
      if (!sharedReference && !photoId) continue;
      const key = sharedReference ? 'shared:' + roomImageReferenceText(sharedReference) : 'local:' + photoId;
      let bytes = resources.get(key);
      if (!bytes) {
        if (sharedReference) bytes = await libraryRoomImageBytes(sharedReference, read);
        else {
          const path = await fullResolutionPhotoPath(photoId!), response = await fetch(convertFileSrc(path));
          if (!response.ok) throw new Error('An image could not be loaded for export');
          bytes = new Uint8Array(await response.arrayBuffer());
        }
        assertCanvasResourceRead(read, editor); resources.set(key, bytes);
      }
      const hash = computeImageHash(bytes); graph.images.set(hash,bytes);
      graph.updateNode(node.id,{fills:node.fills.map(fill=>fill.type==='IMAGE'?{...fill,imageHash:hash}:fill),pluginData:node.pluginData.filter(entry=>!(entry.pluginId==='orion.xdesign'&&['photoDocumentId','roomImage'].includes(entry.key)))});
    }
    if(format==="NATIVE_REACT") {
      const { selectionToNativeReactArchive } = await import('./nativeReactExport');
      return selectionToNativeReactArchive(graph, ids, editor.renderer?.ck ?? await initializeCanvasKit(), undefined, { assertSourceCurrent: () => assertCanvasResourceRead(read, editor) });
    }
    if(format==="REACT"){
      const ck=reactExport!.reactExportNeedsRenderer(graph)?(editor.renderer?.ck??await initializeCanvasKit()):undefined;
      return new TextEncoder().encode(reactExport!.selectionToReact(graph,ids,editor.graph.getNode(ids[0]!)?.name,ck).code);
    }
    if(format==="JSX")return new TextEncoder().encode(io.selectionToJSX(ids,graph,"tailwind"));
    const ck=await initializeCanvasKit();
    if(format==="FIG")return exportFigImageCompatible(graph,ck,editor.renderer??undefined,pageId);
    if(format==="SVG"||format==="PDF"||format==="PPTX"){const {bakeProceduralPaints}=await import("./proceduralExport");bakeProceduralPaints(graph,ck,true);}
    if(!ids.length)throw new Error("The canvas is empty");
    if(format==="SVG"){const svg=io.renderNodesToSVG(graph,pageId,ids);if(!svg)throw new Error("Design export could not be rendered");return new TextEncoder().encode(svg);}
    if(format==="PDF"){const pdf=await import("open-pencil-pdf");const bytes=await pdf.renderNodesToPDF(graph,pageId,ids,{title:editor.state.documentName});if(!bytes)throw new Error("PDF export could not be rendered");return bytes;}
    if(format==="PPTX"){const bytes=await io.renderNodesToPPTX(graph,pageId,ids,{context:{canvasKit:ck,renderer:editor.renderer??undefined}});if(!bytes)throw new Error("PowerPoint export could not be rendered");return bytes;}
    if(!editor.renderer)throw new Error("Wait for the design canvas to load");
    if(!Number.isFinite(scale)||scale<=0||scale>8)throw new Error("Choose an export scale between 0 and 8");
    const baseBounds=io.computeContentBounds(graph,ids);if(!baseBounds)throw new Error("This raster export has no visible content");const bounds=expandRasterBounds(graph,ids,baseBounds);if(Math.ceil((bounds.maxX-bounds.minX)*scale)*Math.ceil((bounds.maxY-bounds.minY)*scale)>64_000_000)throw new Error("This raster export exceeds 64 megapixels; reduce its scale or export a selection");
    const restore=await editor.renderer.prepareForExport(graph,pageId,ids);
    try { const {renderDesignNodes}=await import("./proceduralPaints"); const bytes=withRasterBoundsPadding(graph,pageId,ids,baseBounds,bounds,nodeIds=>renderDesignNodes(ck,editor.renderer!,graph,pageId,nodeIds,{format,scale,quality:.95}));
    if(!bytes)throw new Error("Design export could not be rendered");return bytes; } finally { restore(); }
    });
  });
}

export async function editPencilImage(nodeId:string):Promise<void> {
  assertPencilEditable();
  const editor=usePencilWorkspace.getState().editor;
  const node=editor?.graph.getNode(nodeId);const fill=node?.fills.find(f=>f.type==="IMAGE");
  if(!editor||!node||!fill?.imageHash)throw new Error("Select an image fill to edit");
  let linkedId=pencilPhotoDocumentId(nodeId);
  if (readRoomImagePluginData(node.pluginData) && !linkedId) {
    const { canvasRoomSession } = await import('./roomSession'), room = canvasRoomSession(editor);
    if (!room) throw new Error('Reconnect this image’s shared room before opening its editable contents.');
    await room.hydrateRoomImage(nodeId); linkedId = pencilPhotoDocumentId(nodeId);
    if (!linkedId) throw new Error('The image placement changed while its editable contents loaded. The imported document was preserved.');
  }
  const {openPencilPhoto}=await import("../photo/runtime");
  assertPencilEditable();if(usePencilWorkspace.getState().editor!==editor)throw new Error("The design canvas changed before Image opened");
  if(linkedId){await openPencilPhoto(nodeId,linkedId);return;}
  const bytes=editor.graph.images.get(fill.imageHash);if(!bytes)throw new Error("The imported image bytes are missing");
  let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const png=bytes[0]===137 && bytes[1]===80;
  const webp=bytes.length>=12&&String.fromCharCode(...bytes.subarray(0,4))==="RIFF"&&String.fromCharCode(...bytes.subarray(8,12))==="WEBP";
  await openPencilPhoto(nodeId,null,btoa(binary),png?"image.png":webp?"image.webp":"image.jpg");
}
export function pencilPhotoDocumentId(nodeId:string):string|null {
  const node=usePencilWorkspace.getState().editor?.graph.getNode(nodeId);
  // Metadata is authoritative after undo, redo, duplication and detachment.
  return node?.pluginData.find(p=>p.pluginId==="orion.xdesign"&&p.key==="photoDocumentId")?.value??pencilRoomImageBinding(nodeId)?.photo.id??null;
}
export async function commitPencilPhoto(document:PhotoDocument,nodeId?:string,recordHistory=true):Promise<string> {
  assertPencilEditable();
  const editor=usePencilWorkspace.getState().editor;
  if(!editor || activeProject!==useXDProjects.getState().activeId)throw new Error("Reopen the design canvas before applying the image");
  const sharedImage = nodeId && editor.graph.getNode(nodeId);
  if (sharedImage && readRoomImagePluginData(sharedImage.pluginData)) {
    const binding = pencilRoomImageBinding(nodeId!);
    if (!binding || binding.photo.id !== document.id) throw new Error('The shared image placement changed. The native edit was preserved without publishing it.');
    useXDesign.setState(state => ({ photoDocuments: { ...state.photoDocuments, [document.id]: document } }));
    editor.requestRender(); persistPencil(); return nodeId!;
  }
  const {convertFileSrc}=await import("@tauri-apps/api/core");
  const response=await fetch(convertFileSrc(document.previewPath));if(!response.ok)throw new Error("The edited image could not be loaded");
  const bytes=new Uint8Array(await response.arrayBuffer());assertPencilEditable();if(usePencilWorkspace.getState().editor!==editor||activeProject!==useXDProjects.getState().activeId||useXDProjects.getState().transitioning)throw new Error("The destination changed while loading the edited image");const hash=imageHash(bytes);editor.graph.images.set(hash,bytes);
  const beforeDocument=useXDesign.getState().photoDocuments[document.id];
  const beforeLinks=Object.fromEntries([...editor.graph.nodes.values()].flatMap(node=>{const id=node.pluginData.find(p=>p.pluginId==="orion.xdesign"&&p.key==="photoDocumentId")?.value;return id?[[node.id,id]]:[];}));
  const placing=!nodeId;
  if(placing&&recordHistory)editor.undo.beginBatch("Place image");
  let placement=nodeId;
  if(!placement){const scale=Math.min(1,600/Math.max(document.width,document.height));const right=editor.graph.getChildren(editor.state.currentPageId).reduce((right,node)=>Math.max(right,node.x+node.width),60);placement=editor.createShape("RECTANGLE",right+40,100,document.width*scale,document.height*scale);editor.graph.updateNode(placement,{name:document.name});}
  const target=editor.graph.getNode(placement);if(!target)throw new Error("The image layer no longer exists");
  const linkedNodes=[...editor.graph.nodes.values()].filter(n=>n.pluginData.find(p=>p.pluginId==="orion.xdesign"&&p.key==="photoDocumentId")?.value===document.id||n.id===placement);
  const beforeFills=new Map(linkedNodes.map(n=>[n.id,n.fills]));
  const beforePluginData=new Map(linkedNodes.map(n=>[n.id,n.pluginData]));
  const apply=()=>{
    photoLinks={...beforeLinks,[placement!]:document.id};
    useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[document.id]:document}}));
    for(const node of linkedNodes){const fills=node.fills.some(f=>f.type==="IMAGE")?node.fills.map(f=>f.type==="IMAGE"?{...f,imageHash:hash}:f):[{type:"IMAGE" as const,color:{r:0,g:0,b:0,a:1},opacity:1,visible:true,imageHash:hash,imageScaleMode:"FILL" as const}];photoLinks[node.id]=document.id;editor.graph.updateNode(node.id,{fills,pluginData:[...node.pluginData.filter(p=>!(p.pluginId==="orion.xdesign"&&p.key==="photoDocumentId")),{pluginId:"orion.xdesign",key:"photoDocumentId",value:document.id}]});}
    // The session saves once edits go quiet; encoding here stalled every photo edit.
    editor.requestRender();
  };
  const revert=()=>{
    photoLinks={...beforeLinks};
    useXDesign.setState(s=>{const photoDocuments={...s.photoDocuments};if(beforeDocument)photoDocuments[document.id]=beforeDocument;else delete photoDocuments[document.id];return {photoDocuments};});
    for(const [id,fills] of beforeFills)if(editor.graph.getNode(id))editor.graph.updateNode(id,{fills,pluginData:beforePluginData.get(id)});
    editor.requestRender();
  };
  try{apply();if(recordHistory)editor.pushUndoEntry({label:"Edit linked photo",forward:apply,inverse:revert});if(placing&&recordHistory)editor.undo.commitBatch();}
  catch(error){try{revert();}finally{if(placing&&recordHistory)editor.undo.rollbackBatch();}throw error;}
  if(recordHistory&&activeShared?.binding.editor!==editor)capPhotoUndo(editor,hash);
  return placement;
}

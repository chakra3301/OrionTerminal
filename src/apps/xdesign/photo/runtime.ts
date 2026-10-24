import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ulid } from "ulid";
import { useXDProjects } from "../projectsStore";
import { useXDesign } from "../store";
import { beginXDesignActivity, trackXDesignActivity } from "../runtimeActivity";
import { ipc } from "@/lib/ipc";
import { validatePhotoDocuments, type PhotoDocument, type PhotoReply, type PhotoState, type PhotoOpenReply, type PhotoColorDecision, type PhotoPasteDecision, type PhotoClipboardReply } from "./types";
import { usePencilWorkspace } from "../pencil/runtime";
import { channelWorkspaceRequired } from "./channelSources";

import { validatePhotoDrafts, type SmartContentsFrame } from "./drafts";
export type { SmartContentsFrame } from "./drafts";
type WorkspaceState = {
  shapeId: string | null;
  documentId: string | null;
  projectId: string | null;
  source: "legacy" | "pencil";
  state: PhotoState | null;
  stateVersion: string | null;
  busy: boolean;
  /** `busy` is held by a canvas gesture or an edit command: the lock stays, but the controls don't
   * dim for something that lasts a moment. Only opening, refreshing and saving the image dim them. */
  quiet: boolean;
  error: string | null;
  warnings: string[];
  smartTrail:SmartContentsFrame[];
  pasteDecision:PhotoPasteDecision|null;
  pasteDecisionBusy:boolean;
  pasteDecisionError:string|null;
  colorDecision:PhotoColorDecision|null;
  colorDecisionBusy:boolean;
  colorDecisionError:string|null;
  close: () => void;
};
export const usePhotoWorkspace = create<WorkspaceState>(set => ({
  shapeId: null, documentId: null, projectId:null, source:"legacy", state: null, stateVersion:null, busy: false, quiet: false, error: null, warnings: [],smartTrail:[],pasteDecision:null,pasteDecisionBusy:false,pasteDecisionError:null,colorDecision:null,colorDecisionBusy:false,colorDecisionError:null,
  close: () => set(s => s.busy ? s : { shapeId: null, documentId: null, projectId:null, state: null, stateVersion:null, error: null, warnings: [],smartTrail:[] }),
}));

function requireDesktop() {
  if (!isTauri()) throw new Error("Image editing uses Orion Terminal’s native engine. Open this project in the desktop app.");
}

/** What the workspace's controls show: locked, except for gestures and edit commands. */
export const controlsLocked = (state: WorkspaceState) => state.busy && !state.quiet;

let quietCommit: Promise<void> | null = null;
/** Holds the lock quietly for a pointer gesture. What starts meanwhile waits for the release, and
 * a command started synchronously after the release runs before it. */
export function holdImageGesture(reason: string): () => void {
  const end = beginXDesignActivity("photo-operation", reason);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  quietCommit = held;
  usePhotoWorkspace.setState({ busy: true, quiet: true });
  let open = true;
  return () => {
    if (!open) return;
    open = false; end();
    if (quietCommit === held) quietCommit = null;
    usePhotoWorkspace.setState({ busy: false, quiet: false });
    release();
  };
}
async function operation<T>(work: (projectId: string) => Promise<T>, quiet = false): Promise<T> {
  requireDesktop();
  // A quiet commit leaves the controls usable, so what they start meanwhile runs after it instead of failing.
  while (quietCommit) await quietCommit;
  if (usePhotoWorkspace.getState().busy) throw new Error("Wait for the image operation to finish");
  if (usePencilWorkspace.getState().busy) throw new Error("Wait for the design operation to finish");
  const projectId = useXDProjects.getState().activeId;
  if (!projectId || useXDProjects.getState().transitioning) throw new Error("Open a design project before editing images");
  usePhotoWorkspace.setState({ busy: true, quiet, error: null });
  const running = (async () => {
    try {
      return await trackXDesignActivity("photo-operation", "Wait for the image operation to finish before switching projects or disabling XDesign.", () => work(projectId));
    } catch (error) {
      usePhotoWorkspace.setState({ error: String(error) });
      throw error;
    } finally {
      usePhotoWorkspace.setState({ busy: false, quiet: false });
    }
  })();
  if (quiet) {
    const settled = running.then(() => {}, () => {});
    quietCommit = settled;
    void settled.then(() => { if (quietCommit === settled) quietCommit = null; });
  }
  return running;
}

type ImportContinuation={token:string;resolve:(reply:PhotoReply)=>void;reject:(error:Error)=>void};
let importContinuation:ImportContinuation|null=null;
const nativeId=(value:unknown):value is string=>typeof value==="string"&&/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(value);
function validDecision(value:unknown,projectId:string,photoId:unknown):value is PhotoColorDecision{
  if(!value||typeof value!=="object")return false;
  const d=value as PhotoColorDecision,r=d.report;
  return nativeId(d.token)&&d.projectId===projectId&&d.photoId===photoId&&!!r&&typeof r.name==="string"&&r.name.length<=4096&&["Rgb","Cmyk","Grayscale"].includes(r.mode)&&[8,16,32].includes(r.depth)&&typeof r.working==="string"&&r.working.length<=4096&&(r.embedded===undefined||typeof r.embedded==="string"&&r.embedded.length<=4096)&&r.ask===true&&["preserve","convert","off"].includes(r.policy)&&(r.missing===true||r.mismatch===true)&&Array.isArray(d.choices)&&d.choices.length<=3&&d.choices.length>0&&new Set(d.choices).size===d.choices.length&&d.choices.every(choice=>(r.missing?["preserve","assignWorking","assignProfile"]:["preserve","convert","discard"]).includes(choice))&&d.choices.includes("preserve")&&!!d.settings&&typeof d.settings.revision==="string"&&(/^[0-9a-f]{64}$/.test(d.settings.revision)||d.settings.revision==="default");
}
async function openPhoto(request:Record<string,unknown>,projectId:string):Promise<PhotoReply>{
  const response=await invoke<PhotoOpenReply>("xdesign_photo_open",request);
  if(!response||!("colorDecision" in response))return response as PhotoReply;
  const decision=response.colorDecision;
  if(!validDecision(decision,projectId,request.photoId)||useXDProjects.getState().activeId!==projectId||importContinuation){
    if(nativeId(decision?.token))await invoke("xdesign_photo_import_decision",{projectId,photoId:request.photoId,token:decision.token,params:{action:"cancel"}}).catch(()=>undefined);
    throw new Error("The import color decision is unavailable or its source changed");
  }
  return new Promise<PhotoReply>((resolve,reject)=>{importContinuation={token:decision.token,resolve,reject};usePhotoWorkspace.setState({colorDecision:decision,colorDecisionBusy:false,colorDecisionError:null});});
}
export async function resolveColorImport(params:Record<string,unknown>):Promise<void>{
  const state=usePhotoWorkspace.getState(),decision=state.colorDecision,continuation=importContinuation;
  if(!decision||!continuation||continuation.token!==decision.token||state.colorDecisionBusy)return;
  if(useXDProjects.getState().activeId!==decision.projectId){cancelColorImport();return;}
  usePhotoWorkspace.setState({colorDecisionBusy:true,colorDecisionError:null});
  try{
    const reply=await invoke<PhotoReply|null>("xdesign_photo_import_decision",{projectId:decision.projectId,photoId:decision.photoId,token:decision.token,params});
    if(importContinuation!==continuation)return;
    if(params.action!=="cancel"&&(!reply||reply.document?.id!==decision.photoId))throw new Error("The native import returned another image");
    importContinuation=null;usePhotoWorkspace.setState({colorDecision:null,colorDecisionBusy:false,colorDecisionError:null});
    if(params.action==="cancel")continuation.reject(new Error("Image import canceled"));else continuation.resolve(reply!);
  }catch(error){if(importContinuation===continuation)usePhotoWorkspace.setState({colorDecisionBusy:false,colorDecisionError:String(error)});}
}
export function cancelColorImport():void{
  const decision=usePhotoWorkspace.getState().colorDecision,continuation=importContinuation;
  if(!decision||!continuation)return;importContinuation=null;usePhotoWorkspace.setState({colorDecision:null,colorDecisionBusy:false,colorDecisionError:null});continuation.reject(new Error("Image import canceled"));
  void invoke("xdesign_photo_import_decision",{projectId:decision.projectId,photoId:decision.photoId,token:decision.token,params:{action:"cancel"}}).catch(()=>undefined);
}

function receive(reply: PhotoReply, projectId: string) {
  if (useXDProjects.getState().activeId !== projectId) throw new Error("The project changed before the image operation completed");
  const source=useXDesign.getState().photoDocuments[reply.document.id]?.historyBrushSourceId;
  if(source)reply.document={...reply.document,historyBrushSourceId:source};
  validatePhotoDocuments({ [reply.document.id]: reply.document });
  usePhotoWorkspace.setState({ state: reply.state, stateVersion:reply.document.version, error: null, warnings: reply.warnings });
}

const CLIPBOARD_COMMANDS=["edit.copy","edit.copyMerged","edit.cut","edit.paste","edit.pasteSpecial.pasteInPlace","edit.pasteSpecial.pasteInto","edit.pasteSpecial.pasteOutside"];
type PasteRequest={requestId:string;projectId:string;photoId:string;version:string|null;command:string;params:Record<string,unknown>;viewKey?:string|null};
type PasteContinuation={decision:PhotoPasteDecision;request:PasteRequest;resolve:(reply:PhotoReply)=>void;reject:(error:Error)=>void};
let pasteContinuation:PasteContinuation|null=null;
function validPasteDecision(value:PhotoPasteDecision,request:PasteRequest):boolean{
  if(!value||!nativeId(value.token)||value.requestId!==request.requestId||value.projectId!==request.projectId||value.photoId!==request.photoId||value.version!==request.version||value.command!==request.command||typeof value.viewKey!=="string"||value.viewKey.length>8192||request.viewKey&&value.viewKey!==request.viewKey)return false;
  const report=value.report;if(!report||typeof report.canKeepNumbers!=="boolean"||typeof report.bpc!=="boolean"||!["preserve","convert","off"].includes(report.policy)||!["relative","perceptual","saturation","absolute"].includes(report.intent)||![report.sourceName,report.sourceProfile,report.targetProfile,report.sourceMode,report.targetMode].every(value=>typeof value==="string"&&value.length<=4096))return false;
  return Array.isArray(value.choices)&&value.choices.length===(report.canKeepNumbers?2:1)&&value.choices[0]==="convert"&&(!report.canKeepNumbers||value.choices[1]==="numbers");
}
async function clipboardCommand(input:Omit<PasteRequest,"requestId">):Promise<PhotoReply>{
  const request={...input,requestId:ulid()},reply=await invoke<PhotoClipboardReply>("xdesign_photo_clipboard",{...request,token:null,action:null});
  if("pasteCanceled" in reply)throw new Error("Image paste canceled");
  if(!("pasteDecision" in reply)){if(reply.document?.id!==request.photoId)throw new Error("The clipboard returned another image");return reply;}
  const decision=reply.pasteDecision;
  if(!validPasteDecision(decision,request)||useXDProjects.getState().activeId!==request.projectId||pasteContinuation){
    if(nativeId(decision?.token))await invoke("xdesign_photo_clipboard",{...request,token:decision.token,action:"cancel"}).catch(()=>undefined);
    throw new Error("The clipboard color decision is unavailable or its target changed");
  }
  return new Promise<PhotoReply>((resolve,reject)=>{pasteContinuation={decision,request,resolve,reject};usePhotoWorkspace.setState({pasteDecision:decision,pasteDecisionBusy:false,pasteDecisionError:null});});
}
export async function resolvePasteColor(action:"convert"|"numbers"|"cancel"):Promise<void>{
  const continuation=pasteContinuation,state=usePhotoWorkspace.getState();if(!continuation||state.pasteDecision?.token!==continuation.decision.token||state.pasteDecisionBusy)return;
  if(useXDProjects.getState().activeId!==continuation.request.projectId){cancelPasteColor();return;}
  if(action!=="cancel"&&!continuation.decision.choices.includes(action))return;
  usePhotoWorkspace.setState({pasteDecisionBusy:true,pasteDecisionError:null});
  try{
    const reply=await invoke<PhotoClipboardReply>("xdesign_photo_clipboard",{...continuation.request,token:continuation.decision.token,action});if(pasteContinuation!==continuation)return;
    if("pasteDecision" in reply||!("pasteCanceled" in reply)&&reply.document?.id!==continuation.request.photoId)throw new Error("The native clipboard result is unavailable or belongs to another image");
    pasteContinuation=null;usePhotoWorkspace.setState({pasteDecision:null,pasteDecisionBusy:false,pasteDecisionError:null});
    if("pasteCanceled" in reply)continuation.reject(new Error("Image paste canceled"));else continuation.resolve(reply);
  }catch(error){if(pasteContinuation===continuation)usePhotoWorkspace.setState({pasteDecisionBusy:false,pasteDecisionError:String(error)});}
}
export function cancelPasteColor():void{
  const continuation=pasteContinuation;if(!continuation)return;pasteContinuation=null;usePhotoWorkspace.setState({pasteDecision:null,pasteDecisionBusy:false,pasteDecisionError:null});continuation.reject(new Error("Image paste canceled"));
  void invoke("xdesign_photo_clipboard",{...continuation.request,token:continuation.decision.token,action:"cancel"}).catch(()=>undefined);
}
export async function createImageFromClipboard():Promise<void>{
  await operation(async projectId=>{
    if(Object.keys(useXDesign.getState().photoDocuments).length>=1024)throw new Error("The project has reached its image-document limit");
    const reply=await clipboardCommand({projectId,photoId:ulid(),version:null,command:"file.newFromClipboard",params:{},viewKey:null});receive(reply,projectId);
    const pencil=useXDesign.getState().pencilDocument?await import("../pencil/runtime"):null;
    const shapeId=pencil?await pencil.commitPencilPhoto(reply.document):useXDesign.getState().applyPhotoDocument(reply.document);
    usePhotoWorkspace.setState({shapeId,documentId:reply.document.id,projectId,source:pencil?"pencil":"legacy",smartTrail:[]});
  });
}

export async function photoColorSettings(action:"read"|"defaults"|"update"|"profileInfo",params:Record<string,unknown>={}):Promise<unknown>{
  return operation(async projectId=>{
    const result=await invoke("xdesign_photo_color_settings",{action,params});
    if(action==="update"){
      const current=usePhotoWorkspace.getState(),doc=current.documentId?useXDesign.getState().photoDocuments[current.documentId]:null;
      if(doc&&current.projectId===projectId){
        try{const reply=await invoke<PhotoReply>("xdesign_photo_open",{projectId,photoId:doc.id,version:doc.version,sourcePath:doc.originalPath,width:null,height:null});receive(reply,projectId);}
        catch(error){usePhotoWorkspace.setState({error:`Color settings were saved. Reopen the image to refresh its view: ${String(error)}`});}
      }
    }
    return result;
  });
}

type PaintColors = Partial<Record<"foreground" | "background", string>>;
type ColorUpdate = { identity: string; pending: PaintColors | null; completion: Promise<void> };
let colorUpdate: ColorUpdate | null = null;
export async function setPhotoColors(colors: PaintColors): Promise<void> {
  if (!Object.keys(colors).length || Object.entries(colors).some(([key,value]) => !["foreground","background"].includes(key) || typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))) throw new Error("Choose a valid paint color");
  // The version is pinned below, so a color picked while a stroke commits must target what it commits.
  // A color update in flight is itself the quiet commit; waiting on it would stop rapid picks coalescing.
  while (quietCommit && !colorUpdate) await quietCommit;
  const target = usePhotoWorkspace.getState(), project = useXDProjects.getState();
  const document = target.documentId ? useXDesign.getState().photoDocuments[target.documentId] : null;
  if (!document || !target.shapeId || project.activeId !== target.projectId || target.stateVersion !== document.version || project.transitioning) throw new Error("Reopen the image before changing paint colors");
  const identity = `${project.activeId}/${document.id}/${document.version}/${target.shapeId}`;
  if (colorUpdate) {
    if (colorUpdate.identity !== identity) throw new Error("Wait for paint colors to finish updating");
    colorUpdate.pending = { ...colorUpdate.pending, ...colors };
    return colorUpdate.completion;
  }
  const update: ColorUpdate = { identity, pending: { ...colors }, completion: Promise.resolve() };
  colorUpdate = update;
  update.completion = operation(async projectId => {
    try {
      while (update.pending) {
        const params = update.pending;
        update.pending = null;
        const current = usePhotoWorkspace.getState();
        if (current.documentId !== document.id || current.shapeId !== target.shapeId || current.projectId !== projectId || useXDesign.getState().photoDocuments[document.id]?.version !== document.version) throw new Error("The image changed before paint colors finished updating");
        const reply = await invoke<PhotoReply>("xdesign_photo_command", { projectId, photoId: document.id, version: document.version, command: "tools.setColors", params });
        if (reply.document.id !== document.id || reply.document.version !== document.version || useXDesign.getState().photoDocuments[document.id]?.version !== document.version) throw new Error("The image changed while paint colors were updating");
        receive(reply, projectId);
      }
    } finally { if (colorUpdate === update) colorUpdate = null; }
  }, true).finally(() => { if (colorUpdate === update) colorUpdate = null; });
  return update.completion;
}

export function selectHistoryBrushSource(sourceId:string|null):void {
  const target=usePhotoWorkspace.getState(),project=useXDProjects.getState();
  if(target.busy||usePencilWorkspace.getState().busy||project.transitioning)throw new Error("Wait for the current operation to finish");
  if(!target.documentId||target.projectId!==project.activeId)throw new Error("Reopen the image before choosing a history source");
  const doc=useXDesign.getState().photoDocuments[target.documentId];
  if(!doc||target.stateVersion!==doc.version)throw new Error("The image changed; choose its current history source");
  if(sourceId&&!target.state?.historySources?.some(source=>source.id===sourceId&&source.available))throw new Error("Choose an available History Brush source");
  const next={...doc};if(sourceId)next.historyBrushSourceId=sourceId;else delete next.historyBrushSourceId;
  validatePhotoDocuments({[doc.id]:next});
  useXDesign.setState(state=>({photoDocuments:{...state.photoDocuments,[doc.id]:next}}));
}

function persistDraft(trail: SmartContentsFrame[], previous = usePhotoWorkspace.getState().smartTrail) {
  const target = usePhotoWorkspace.getState(), id = previous[0]?.childId ?? trail[0]?.childId;
  if (!id || !target.shapeId) return;
  useXDesign.setState(state => ({ photoDrafts: [
    ...state.photoDrafts.filter(draft => draft.id !== id),
    ...(trail.length ? [{ id, shapeId: target.shapeId!, source: target.source, updatedAt: Date.now(), trail }] : []),
  ] }));
}

export async function resumeSmartContents(draftId: string): Promise<void> {
  await operation(async projectId => {
    const { photoDrafts, photoDocuments } = useXDesign.getState();
    const draft = photoDrafts.find(item => item.id === draftId);
    if (!draft) throw new Error("This image draft is no longer available");
    validatePhotoDrafts([draft], photoDocuments);
    const child = photoDocuments[draft.trail.at(-1)!.childId]!;
    const reply = await invoke<PhotoReply>("xdesign_photo_open", { projectId, photoId: child.id, version: child.version, sourcePath: null, width: null, height: null });
    receive(reply, projectId);
    if(draft.source==="legacy") {
      const store=useXDesign.getState();
      const page=store.pages.find(page=>(page.id===store.activePageId?store.shapes:page.shapes).some(shape=>shape.id===draft.shapeId));
      if(page&&page.id!==store.activePageId)store.switchPage(page.id);
    }
    usePhotoWorkspace.setState({ shapeId: draft.shapeId, documentId: child.id, projectId, source: draft.source, smartTrail: draft.trail });
  });
}

export function removePhotoDraft(draftId: string): void {
  if (usePhotoWorkspace.getState().busy || usePencilWorkspace.getState().busy || useXDProjects.getState().transitioning) throw new Error("Wait for the current operation to finish");
  if (usePhotoWorkspace.getState().smartTrail[0]?.childId === draftId) usePhotoWorkspace.getState().close();
  // Immutable image versions stay available to project history and other placements.
  useXDesign.setState(state => ({ photoDrafts: state.photoDrafts.filter(draft => draft.id !== draftId) }));
}

export async function editImage(shapeId: string): Promise<void> {
  await operation(async projectId => {
    const shape = useXDesign.getState().shapes.find(s => s.id === shapeId);
    if (!shape || shape.kind !== "image") throw new Error("Select an image to edit");
    const document = shape.photoDocumentId ? useXDesign.getState().photoDocuments[shape.photoDocumentId] : null;
    const reply = await openPhoto({
      projectId, photoId: document?.id ?? ulid(), version: document?.version ?? null,
      sourcePath: document?.originalPath ?? shape.filePath, width: null, height: null,
    },projectId);
    receive(reply, projectId);
    if (!document) useXDesign.getState().applyPhotoDocument(reply.document, shapeId);
    usePhotoWorkspace.setState({ shapeId, documentId:reply.document.id, projectId, source:"legacy", smartTrail:[] });
  });
}

export type NewPhotoOptions={width:number;height:number;name:string;mode:"rgb"|"gray"|"cmyk"|"lab";depth:8|16|32;resolution:number;background:string};
export type RawDevelopOptions={exposure:number;orient:boolean};
export async function createImage(sourcePath?: string,options?:NewPhotoOptions,rawOptions?:RawDevelopOptions): Promise<void> {
  await operation(async projectId => {
    const reply = await openPhoto({
      projectId, photoId: ulid(), version: null, sourcePath: sourcePath ?? null, width: options?.width??1920, height: options?.height??1080,newOptions:options??null,...(rawOptions?{rawOptions}:{}),
    },projectId);
    receive(reply, projectId);
    const pencil = useXDesign.getState().pencilDocument ? await import("../pencil/runtime") : null;
    const shapeId = pencil ? await pencil.commitPencilPhoto(reply.document) : useXDesign.getState().applyPhotoDocument(reply.document);
    usePhotoWorkspace.setState({ shapeId, documentId:reply.document.id, projectId, source:pencil?"pencil":"legacy", smartTrail:[] });
  });
}

export async function refreshImage(document: PhotoDocument): Promise<void> {
  await operation(async projectId => {
    const reply = await invoke<PhotoReply>("xdesign_photo_open", {
      projectId, photoId: document.id, version: document.version, sourcePath: document.originalPath, width: null, height: null,
    });
    receive(reply, projectId);
  });
}

export async function runPhotoCommand(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
  if(command==="file.newFromClipboard"){await createImageFromClipboard();return {documentId:usePhotoWorkspace.getState().documentId};}
  if(command==="layer.smartObjects.editContents") {
    const layer=typeof params.layer==="number"?params.layer:usePhotoWorkspace.getState().state?.activeLayer;
    if(layer===null||layer===undefined)throw new Error("Choose a smart-object layer.");
    await openSmartContents(layer);return {documentId:usePhotoWorkspace.getState().documentId};
  }
  if(command==="layer.smartObjects.saveContents") {await finishSmartContents(true);return {documentId:usePhotoWorkspace.getState().documentId};}
  return operation(async projectId => {
    const shapeId = usePhotoWorkspace.getState().shapeId;
    const shape = useXDesign.getState().shapes.find(s => s.id === shapeId);
    const target=usePhotoWorkspace.getState();
    const document = target.documentId ? useXDesign.getState().photoDocuments[target.documentId] : null;
    if (!document || !shapeId || (target.source==="legacy"&&!shape&&!target.smartTrail.length)) throw new Error("Reopen the image before editing");
    const request = {
      projectId, photoId: document.id, version: document.version, command, params,
    };
    const reply = channelWorkspaceRequired(command, params) ? await (async () => {
      const registry=useXDesign.getState().photoDocuments;
      const maximumOutputs=command==="channel.split"?((target.state?.channels?.colors?.length??4)+(target.state?.channels?.alpha.length??64)):1;
      if(Object.keys(registry).length+maximumOutputs>1024)throw new Error("The project has reached its image-document limit");
      const output = await invoke<{target:PhotoReply|null;created:PhotoReply[];result:unknown}>("xdesign_photo_channel_operation", {...request,viewKey:target.state?.viewKey,preview:false});
      if(useXDProjects.getState().activeId!==projectId || useXDesign.getState().photoDocuments[document.id]?.version!==document.version)throw new Error("The image changed before the channel operation completed");
      if(output.created.length+Object.keys(useXDesign.getState().photoDocuments).length>1024)throw new Error("The project has reached its image-document limit");
      for(const created of output.created) validatePhotoDocuments({[created.document.id]:created.document});
      const editor=usePencilWorkspace.getState().editor;
      if(target.source==="pencil"&&output.created.length)editor?.undo.beginBatch("Create channel images");
      try {
        for(const created of output.created) {
          if(target.source==="pencil") {const pencil=await import("../pencil/runtime");await pencil.commitPencilPhoto(created.document);}
          else useXDesign.getState().applyPhotoDocument(created.document);
        }
        if(target.source==="pencil"&&output.created.length)editor?.undo.commitBatch();
      } catch(error) {if(target.source==="pencil"&&output.created.length)editor?.undo.rollbackBatch();useXDesign.setState({photoDocuments:registry});throw error;}
      // New outputs are placements; keep the reviewed edit target and smart draft open.
      return output.target??{document,state:target.state!,warnings:[],result:output.result};
    })() : CLIPBOARD_COMMANDS.includes(command)?await clipboardCommand({...request,viewKey:target.state?.viewKey??null}):await invoke<PhotoReply>("xdesign_photo_command", request);
    if (useXDesign.getState().photoDocuments[document.id]?.version !== document.version) throw new Error("The image changed before the operation completed");
    receive(reply, projectId);
    if(reply.document.version===document.version) return reply.result;
    if(target.smartTrail.length) {
      useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[document.id]:reply.document}}));
      usePhotoWorkspace.setState({smartTrail:target.smartTrail.map((frame,index)=>index===target.smartTrail.length-1?{...frame,past:[...frame.past,document].slice(-100),future:[]}:frame)});
      persistDraft(usePhotoWorkspace.getState().smartTrail);
    }
    else if(target.source==="pencil") { const pencil=await import("../pencil/runtime");await pencil.commitPencilPhoto(reply.document,shapeId); }
    else useXDesign.getState().applyPhotoDocument(reply.document, shapeId);
    usePhotoWorkspace.setState({documentId:reply.document.id});
    return reply.result;
  }, true);
}

// Pasted images have no source file, so they pass through a temporary asset that the embedded smart object no longer needs.
export async function placeImageBlob(image: Blob): Promise<void> {
  const name = `Pasted Image.${image.type.split("/")[1]?.replace("jpeg", "jpg") || "png"}`;
  let path: string;
  try { path = (await ipc.assetStoreBytes(Array.from(new Uint8Array(await image.arrayBuffer())), name, image.type)).filePath; }
  catch (error) { usePhotoWorkspace.setState({ error: String(error) }); throw error; }
  try { await runPhotoCommand("file.placeEmbedded", { path, name, fit: true }); }
  finally { void ipc.assetDeleteFile(path).catch(() => {}); }
}

export async function makeImageIndependent(): Promise<void> {
  await operation(async projectId => {
    if(usePhotoWorkspace.getState().smartTrail.length)throw new Error("Save or discard these smart-object contents before making an independent placement");
    const shapeId = usePhotoWorkspace.getState().shapeId;
    const shape = useXDesign.getState().shapes.find(s => s.id === shapeId);
    const target=usePhotoWorkspace.getState();
    const document = target.documentId ? useXDesign.getState().photoDocuments[target.documentId] : null;
    if (!document || !shapeId || (target.source==="legacy"&&!shape)) throw new Error("Reopen the image before making an independent copy");
    const reply = await invoke<PhotoReply>("xdesign_photo_open", {
      projectId, photoId: ulid(), version: null, sourcePath: document.bundlePath, width: null, height: null,
    });
    receive(reply, projectId);
    if(target.source==="pencil") { const pencil=await import("../pencil/runtime");await pencil.commitPencilPhoto(reply.document,shapeId); }
    else useXDesign.getState().applyPhotoDocument(reply.document, shapeId);
    usePhotoWorkspace.setState({documentId:reply.document.id});
  });
}

export async function openSmartContents(layer:number):Promise<void> {
  await operation(async projectId=>{
    const target=usePhotoWorkspace.getState();
    if(target.smartTrail.length>=8)throw new Error("Save these nested contents before opening another smart object");
    if(!target.smartTrail.length&&useXDesign.getState().photoDrafts.length>=64)throw new Error("Resume or remove an image draft before opening another");
    const document=target.documentId?useXDesign.getState().photoDocuments[target.documentId]:null;
    if(!document)throw new Error("Reopen the image before editing smart-object contents");
    if(Object.keys(useXDesign.getState().photoDocuments).length>=1024)throw new Error("The project has reached its image-document limit");
    const reply=await invoke<PhotoReply>("xdesign_photo_smart_open",{projectId,photoId:document.id,version:document.version,layer});
    if(useXDesign.getState().photoDocuments[document.id]?.version!==document.version)throw new Error("The parent changed while opening its contents");
    receive(reply,projectId);
    useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[reply.document.id]:reply.document}}));
    usePhotoWorkspace.setState({documentId:reply.document.id,smartTrail:[...target.smartTrail,{parent:document,childId:reply.document.id,layer,past:[],future:[]}]});
    persistDraft(usePhotoWorkspace.getState().smartTrail);
  });
}

export async function finishSmartContents(save:boolean):Promise<void> {
  await operation(async projectId=>{
    const target=usePhotoWorkspace.getState(),frame=target.smartTrail.at(-1);
    const child=target.documentId?useXDesign.getState().photoDocuments[target.documentId]:null;
    if(!frame||!child||child.id!==frame.childId||!target.shapeId)throw new Error("No smart-object contents are open");
    const parent=useXDesign.getState().photoDocuments[frame.parent.id];
    if(!parent||parent.version!==frame.parent.version)throw new Error("The parent changed after opening these contents. Export this draft before returning to its current version.");
    if(save&&target.smartTrail.length===1) {
      const exists=target.source==="pencil"?!!usePencilWorkspace.getState().editor?.graph.getNode(target.shapeId):useXDesign.getState().shapes.some(shape=>shape.id===target.shapeId);
      if(!exists)throw new Error("The parent image placement was removed. Export this draft to keep its contents.");
    }
    const reply=save?await invoke<PhotoReply>("xdesign_photo_smart_apply",{projectId,photoId:parent.id,version:parent.version,childId:child.id,childVersion:child.version,layer:frame.layer}):await invoke<PhotoReply>("xdesign_photo_open",{projectId,photoId:parent.id,version:parent.version,sourcePath:parent.originalPath,width:null,height:null});
    receive(reply,projectId);
    const trail=target.smartTrail.slice(0,-1);
    if(save&&reply.document.version!==parent.version) {
      if(trail.length) {
        useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[parent.id]:reply.document}}));
        const previous=trail.at(-1)!;trail[trail.length-1]={...previous,past:[...previous.past,parent].slice(-100),future:[]};
      } else if(target.source==="pencil") { const pencil=await import("../pencil/runtime");await pencil.commitPencilPhoto(reply.document,target.shapeId); }
      else useXDesign.getState().applyPhotoDocument(reply.document,target.shapeId);
    }
    usePhotoWorkspace.setState({documentId:reply.document.id,smartTrail:trail});
    persistDraft(trail,target.smartTrail);
  });
}

export async function stepSmartContentsHistory(redo:boolean):Promise<void> {
  await operation(async projectId=>{
    const target=usePhotoWorkspace.getState(),frame=target.smartTrail.at(-1);
    const current=target.documentId?useXDesign.getState().photoDocuments[target.documentId]:null;
    const next=(redo?frame?.future:frame?.past)?.at(-1);
    if(!frame||!current||!next)throw new Error("No contents history is available");
    const reply=await invoke<PhotoReply>("xdesign_photo_open",{projectId,photoId:current.id,version:next.version,sourcePath:null,width:null,height:null});
    receive(reply,projectId);
    useXDesign.setState(s=>({photoDocuments:{...s.photoDocuments,[current.id]:reply.document}}));
    usePhotoWorkspace.setState({smartTrail:target.smartTrail.map((item,index)=>index===target.smartTrail.length-1?{...frame,past:redo?[...frame.past,current]:frame.past.slice(0,-1),future:redo?frame.future.slice(0,-1):[...frame.future,current]}:item)});
    persistDraft(usePhotoWorkspace.getState().smartTrail);
  },true);
}

export async function exportImage(path: string, quality?: number): Promise<string[]> {
  return operation(async projectId => {
    const target=usePhotoWorkspace.getState();
    const document = target.documentId ? useXDesign.getState().photoDocuments[target.documentId] : null;
    if (!document) throw new Error("Reopen the image before exporting");
    return invoke<string[]>("xdesign_photo_export", { projectId, photoId: document.id, version: document.version, path, quality: quality ?? null });
  });
}

export async function openPencilPhoto(nodeId:string,documentId:string|null,sourceData?:string,sourceName?:string):Promise<void> {
  await operation(async projectId=>{
    const document=documentId?useXDesign.getState().photoDocuments[documentId]:null;
    const reply=await openPhoto({projectId,photoId:document?.id??ulid(),version:document?.version??null,sourcePath:document?.originalPath??null,width:null,height:null,sourceData:sourceData??null,sourceName:sourceName??null},projectId);
    receive(reply,projectId);
    if(!document){const pencil=await import("../pencil/runtime");await pencil.commitPencilPhoto(reply.document,nodeId);}
    usePhotoWorkspace.setState({shapeId:nodeId,documentId:reply.document.id,source:"pencil",projectId,smartTrail:[]});
  });
}

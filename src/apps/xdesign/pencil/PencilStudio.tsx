import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { toJsonSchema } from "@valibot/to-json-schema";
import { TOOL_SHORTCUTS, type Tool } from "@open-pencil/core/editor";
import { useXDesign } from "../store";
import { ipc } from "@/lib/ipc";
import { downloadFile } from "../exportXD";
import { openPencilSession, usePencilWorkspace, initializeCanvasKit, exportPencil, executeDesignToolAsync, designTools, placePencilVideo, type PencilExportFormat } from "./runtime";
import { mountPencilCanvas } from "./CanvasHost";
import { usePhotoWorkspace } from "../photo/runtime";
import "./pencil.css";
import "./figma.css";
import { VariablesPanel } from "./VariablesPanel";
import { copyPencilSelection, pastePencilData, clearPencilClipboard } from "./clipboard";
import { catchPaste } from "../pasteCatcher";
import { InspectPanel } from "./InspectPanel";
import { GuidesPanel } from "./GuidesPanel";
import { ActionFields, schemaFields } from "../ActionFields";
import { isDesignDialogOpen, useDesignDialog } from "../useDesignDialog";
import { isLibraryDefinition } from "./librarySession";
import { currentSharedPencilBinding } from "./runtime";
import { useXDProjects } from "../projectsStore";
import type { CanvasRoomSession, RoomUiState } from "./roomSession";
import { PresenceCanvas, PresenceControls } from './PresenceCanvas';
import { ChevronDown, File, PanelLeft, PanelRight, Play, Sparkle, Sparkles } from "lucide-react";
import { InspectorSection, PanelResize, useEditorPanels } from "../EditorChrome";
import { DESIGN_TOOL_GROUPS } from "../editorTools";
import { RoomImageControls } from './RoomImageControls';
import { SelectionProperties } from "./SelectionProperties";
import { PrototypePanel } from "./PrototypePanel";
import { useRailIntent } from "../railIntentStore";
import { CanvasPreviewContext } from './CanvasPreviewContext';
import { PrototypePreviewDialog } from './PrototypePreviewDialog';
import { prototypeScreens } from './prototype';
import { CommentCanvas, CommentsPanel, useCommentController } from './CommentsPanel';
import { CanvasHistoryControls, performCanvasHistory } from './CanvasHistoryControls';
import { FigmaToolbar, LayerTree, PageList, Popover, type MenuEntry } from "./FigmaChrome";
import { useCanvasView } from "./canvasView";
import { useAuth } from "@/features/auth/authStore";
import { ProjectNameInput } from "../ProjectNameInput";
const SharingDialog=lazy(()=>import("./SharingDialog").then(module=>({default:module.SharingDialog})));
const RemoteAssetsDialog=lazy(()=>import("./RemoteAssetsDialog").then(module=>({default:module.RemoteAssetsDialog})));
const ScriptDialog=lazy(()=>import("./ScriptDialog").then(module=>({default:module.ScriptDialog})));
const TOOL_GROUPS = DESIGN_TOOL_GROUPS.map(group => ({ ...group, tools: group.tools.map(tool => ({ ...tool, shortcut: Object.entries(TOOL_SHORTCUTS).find(([,value]) => value === tool.id)?.[0].replace(/^Key/, "") })) }));
function Actions({close}:{close:()=>void}) {
  const [search,setSearch]=useState("");const [name,setName]=useState(designTools[0]?.name??"");const [params,setParams]=useState("{}");const [result,setResult]=useState("");
  const tool=designTools.find(t=>t.name===name);
  const [values,setValues]=useState<Record<string,unknown>>({});
  const busy=usePencilWorkspace(s=>s.busy);
  const dialog=useDesignDialog<HTMLDivElement>(close,busy);
  const tools=designTools.filter(t=>`${t.name} ${t.description}`.toLowerCase().includes(search.toLowerCase()));
  return <div ref={dialog} className="xd-pencil-dialog" role="dialog" aria-modal="true" aria-label="Design actions"><form onSubmit={e=>{e.preventDefault();try{const input=JSON.parse(params);if(!input||Array.isArray(input)||typeof input!=="object")throw new Error("Enter a parameter object");const fields=Object.fromEntries(Object.entries(values).filter(([,value])=>value!==undefined));void executeDesignToolAsync(name,{...input,...fields}).then(result=>setResult(JSON.stringify(result,null,2).slice(0,60000))).catch(error=>setResult(String(error)));}catch(error){setResult(String(error));}}}>
    <header><strong>Design actions</strong><button type="button" onClick={close}>Close</button></header>
    <input autoFocus aria-label="Search design actions" placeholder="Search components, variables, vectors…" value={search} onChange={e=>setSearch(e.target.value)}/>
    <select aria-label="Design action" value={name} onChange={e=>{setName(e.target.value);setResult("");setParams("{}");setValues({});}}>{tools.map(t=><option key={t.name} value={t.name}>{t.name.replaceAll("_"," ")}</option>)}</select>
    <p>{tool?.description}</p>
    {tool&&<ActionFields fields={schemaFields(toJsonSchema(tool.input,{errorMode:"ignore"}))} values={values} disabled={busy} change={(key,value)=>setValues(previous=>({...previous,[key]:value}))}/>}<details><summary>Advanced parameters</summary><pre>{tool&&JSON.stringify(toJsonSchema(tool.input,{errorMode:"ignore"}),null,2)}</pre><label>Additional values<textarea aria-label="Action values" value={params} onChange={e=>setParams(e.target.value)} spellCheck={false}/></label></details><button type="submit" disabled={busy}>{busy?"Running…":"Run action"}</button><pre role="status">{result}</pre>
  </form></div>;
}
const NAV_WIDTH = 52;
export function PencilStudio() {
  const element=useRef<HTMLDivElement>(null);const [loading,setLoading]=useState(true);const [actions,setActions]=useState(false);const [scripts,setScripts]=useState(false);const [resources,setResources]=useState(false);
  const [sharing,setSharing]=useState(false),[roomSession,setRoomSession]=useState<CanvasRoomSession|null>(null),[roomState,setRoomState]=useState<RoomUiState|null>(null);
  const readOnly=usePencilWorkspace(s=>s.readOnly);
  const editor=usePencilWorkspace(s=>s.editor);usePencilWorkspace(s=>s.version);const error=usePencilWorkspace(s=>s.error);const busy=usePencilWorkspace(s=>s.busy);
  const initial=useRef(useXDesign.getState().pencilDocument!);
  const panels=useEditorPanels();
  const view=useCanvasView();
  const [exportFormat,setExportFormat]=useState<PencilExportFormat>("PNG");const [exportScale,setExportScale]=useState(1);
  const [rightTab,setRightTab]=useState<"design"|"prototype"|"comments">("design");
  const [devMode,setDevMode]=useState(false),[devTab,setDevTab]=useState<"code"|"lint">("code");
  const [renamingFile,setRenamingFile]=useState(false);
  const projectId=useXDProjects(s=>s.activeId),projectName=useXDProjects(s=>s.registry.find(item=>item.id===s.activeId)?.name);
  const user=useAuth(s=>s.displayName||s.username);
  const comments=useCommentController(editor,()=>{setRightTab('comments');setDevMode(false);if(!panels.right)panels.toggle('right');},()=>({width:element.current?.clientWidth??0,height:element.current?.clientHeight??0}),!!initial.current.shared,roomState,roomSession);
  const [present,setPresent]=useState(false);
  const videoInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    const el=element.current;if(!el)return;
    let cancelled=false;let unmount:(()=>void)|undefined;let session:Awaited<ReturnType<typeof openPencilSession>>|undefined;let room:CanvasRoomSession|undefined;let unsubscribe:(()=>void)|undefined;
    const project=useXDProjects.getState().activeId;
    initializeCanvasKit().then(async()=>{
      if(cancelled)return;
      const roomModule=initial.current.shared?await import('./roomSession'):null;
      const saved=initial.current.shared?await (await import('./roomPreferences')).loadRoomPreference(initial.current.shared.documentId):null;
      const grants=initial.current.shared&&project?await (await import('./roomGrants')).loadRoomGrants(project):[];
      const creation=grants.find(grant=>grant.kind==='create');
      if(cancelled)return;
      const opened=await openPencilSession(el,initial.current,()=>{},{isCurrent:()=>!cancelled});if(cancelled){opened.dispose();return;}session=opened;
      const shared=currentSharedPencilBinding();
      if(shared&&roomModule&&project){room=new roomModule.CanvasRoomSession(opened.editor,shared.binding,shared.documentId,project,saved,creation?.kind==='create'?creation:null,el);setRoomSession(room);unsubscribe=room.subscribe(setRoomState);if(roomModule.consumeRoomCreationIntent(project))setSharing(true);}
      unmount=mountPencilCanvas(el,session.editor,()=>setLoading(false),error=>usePencilWorkspace.setState({error:String(error)}));
      if(room&&saved&&roomModule?.consumeRoomJoinIntent(project!))void room.connect(saved.serverUrl).catch(error=>{if(!cancelled)usePencilWorkspace.setState({error:String(error)});});
    }).catch(error=>{unsubscribe?.();room?.dispose();unmount?.();session?.dispose();if(!cancelled){setRoomSession(null);setRoomState(null);setLoading(false);usePencilWorkspace.setState({error:String(error)});}});
    return()=>{cancelled=true;unsubscribe?.();room?.dispose();unmount?.();session?.dispose();clearPencilClipboard();};
  },[]);
  const selected=editor?.getSelectedNodes()[0];
  const report=(error:unknown)=>usePencilWorkspace.setState({error:String(error)});
  const exportFile=async(format:PencilExportFormat)=>{try{const bytes=await exportPencil(format,exportScale);const extension=format==="REACT"?"tsx":format.toLowerCase();const name=`${editor?.state.documentName||"design"}.${extension}`;if(isTauri()){const path=await save({defaultPath:name,filters:[{name:format,extensions:[extension]}]});if(path)await ipc.xdesignSaveBytes(path,Array.from(bytes));}else downloadFile(name,new Blob([new Uint8Array(bytes).buffer]));}catch(error){report(error);}};
  const zoom=Math.round((editor?.state.zoom??1)*100);
  const zoomBy=(factor:number)=>editor?.zoomToLevel(editor.state.zoom*factor);
  const zoomItems=():MenuEntry[]=>[
    {label:"Zoom in",hint:"⌘+",onSelect:()=>zoomBy(2)},{label:"Zoom out",hint:"⌘−",onSelect:()=>zoomBy(.5)},
    {label:"Zoom to fit",hint:"⇧1",onSelect:()=>editor?.zoomToFit()},{label:"Zoom to selection",hint:"⇧2",disabled:!editor?.state.selectedIds.size,onSelect:()=>editor?.zoomToSelection()},
    {label:"Zoom to 50%",onSelect:()=>editor?.zoomToLevel(.5)},{label:"Zoom to 100%",hint:"⇧0",onSelect:()=>editor?.zoomTo100()},{label:"Zoom to 200%",onSelect:()=>editor?.zoomToLevel(2)},
    "separator",
    {label:"Rulers",hint:"⇧R",checked:view.rulers,onSelect:()=>view.toggle("rulers")},{label:"Canvas grid",checked:view.grid,onSelect:()=>view.toggle("grid")},
  ];
  const shareLabel=roomState?.creation?'Publish room':roomState?.connection?.phase==='online'?'Shared':readOnly?'Viewer':'Share';
  const share=()=>{if(!readOnly)editor?.commitTextEdit();setSharing(true);};
  const canPresent=!!editor&&!busy&&prototypeScreens(editor.graph,editor.state.currentPageId).length>0;
  const fileName=projectName??(editor?.state.documentName||"Untitled");
  const openComments=()=>{if(rightTab==='comments'&&panels.right){setRightTab('design');comments.cancel();return;}setRightTab('comments');setDevMode(false);if(!panels.right)panels.toggle('right');};
  const fileMenu=():MenuEntry[]=>[
    {label:"Back to files",onSelect:()=>void useXDProjects.getState().goHome().catch(()=>{})},
    {label:"Rename",disabled:!projectId,onSelect:()=>setRenamingFile(true)},
    "separator",
    {label:"Present",disabled:!canPresent,onSelect:()=>setPresent(true)},
    {label:"Share",disabled:!editor||busy,onSelect:share},
    {label:`Export ${editor?.state.selectedIds.size?"selection":"page"} as ${exportFormat}`,disabled:!editor||busy,onSelect:()=>void exportFile(exportFormat)},
    "separator",
    {label:"Design actions…",disabled:!editor||readOnly,onSelect:()=>setActions(true)},
    {label:"Scripts…",disabled:!editor||busy||readOnly,onSelect:()=>setScripts(true)},
    {label:"Resources…",disabled:!editor||busy||readOnly,onSelect:()=>setResources(true)},
    {label:"Import video…",disabled:!editor||busy||readOnly,onSelect:()=>videoInput.current?.click()},
    "separator",
    {label:panels.left&&panels.right?"Hide UI":"Show UI",hint:"⌘\\",onSelect:()=>toggleUi()},
  ];
  const toggleUi=()=>{const show=!(panels.left&&panels.right);if(panels.left!==show)panels.toggle('left');if(panels.right!==show)panels.toggle('right');};
  const avatar=<span className="xd-figma-avatar" title={user??"You"} aria-hidden>{(user??"You").trim().charAt(0).toUpperCase()}</span>;
  const shareButton=<button type="button" className="xd-figma-share" disabled={!editor||busy} onClick={share}>{shareLabel}</button>;
  const zoomMenu=<Popover className="xd-figma-zoom" label="Zoom and view options" title="Zoom/view options" text={<>{zoom}%<ChevronDown size={11}/></>} align="end" disabled={!editor} items={zoomItems}/>;
  return <CanvasPreviewContext.Provider value={element.current?.parentElement??null}><section className="xd-pencil xd-figma" aria-label="Design workspace" aria-busy={busy} onPaste={e=>{if(isDesignDialogOpen()||(e.target as HTMLElement).closest("input,textarea,select")||!editor||busy||readOnly)return;e.preventDefault();void pastePencilData(editor,{html:e.clipboardData.getData("text/html"),text:e.clipboardData.getData("text/plain"),files:Array.from(e.clipboardData.files)}).catch(report);}} onKeyDown={e=>{
    if(isDesignDialogOpen())return;
    if(e.nativeEvent.isComposing||(e.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]")||!editor||busy||usePhotoWorkspace.getState().shapeId)return;
    if((e.metaKey||e.ctrlKey)&&e.key==='\\'){e.preventDefault();e.stopPropagation();toggleUi();return;}
    if((e.metaKey||e.ctrlKey)&&!e.altKey&&['=','+','-','0'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='0')editor.zoomTo100();else zoomBy(e.key==='-'?.5:2);return;}
    if(e.shiftKey&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&['KeyR','Digit0','Digit1','Digit2'].includes(e.code)){e.preventDefault();e.stopPropagation();if(e.code==='KeyR')view.toggle('rulers');else if(e.code==='Digit0')editor.zoomTo100();else if(e.code==='Digit1')editor.zoomToFit();else editor.zoomToSelection();return;}
    if(!e.metaKey&&!e.ctrlKey&&e.code==='KeyC'){e.preventDefault();e.stopPropagation();comments.toggle();return;}
    if(e.key==='Escape'&&comments.mode){e.preventDefault();e.stopPropagation();comments.cancel();return;}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();performCanvasHistory(editor,roomSession,e.shiftKey?'redo':'undo');return;}
    if(readOnly){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="c"){e.preventDefault();void copyPencilSelection(editor).catch(report);}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="a"){e.preventDefault();editor.selectAll();}return;}
    if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.key.toLowerCase()==="v"){e.stopPropagation();if(!e.repeat)catchPaste(e.currentTarget,data=>{if(data)void pastePencilData(editor,{html:data.getData("text/html"),text:data.getData("text/plain"),files:Array.from(data.files)}).catch(report);},()=>{});return;}
    if(e.metaKey||e.ctrlKey){if(["c","x"].includes(e.key.toLowerCase())){e.preventDefault();void copyPencilSelection(editor,e.key.toLowerCase()==="x").catch(report);}if(e.key.toLowerCase()==="g"){e.preventDefault();if(e.shiftKey)editor.ungroupSelected();else editor.groupSelected();}if(e.key.toLowerCase()==="d"){e.preventDefault();editor.duplicateSelected();}if(e.key.toLowerCase()==="a"){e.preventDefault();editor.selectAll();}return;}
    const tool=TOOL_SHORTCUTS[e.code];if(tool){comments.cancel();editor.setTool(tool);e.preventDefault();}if((e.key==="Delete"||e.key==="Backspace")&&!comments.mode){e.preventDefault();editor.deleteSelected();}
  }}>
    <div ref={panels.body} className="xd-pencil-body xd-editor-body xd-figma-body" data-overlay={panels.overlay} inert={busy}>
      <aside id={panels.leftId} className="xd-pencil-layers xd-editor-panel xd-editor-panel-left xd-figma-left" aria-label="Layers and assets" hidden={!panels.left} style={{width:panels.leftWidth+NAV_WIDTH}}>
        <nav className="xd-figma-nav" aria-label="Sidebar">
          <button type="button" className="xd-figma-nav-item" aria-pressed title="File"><File size={17}/><span>File</span></button>
          <button type="button" className="xd-figma-nav-item" aria-label="Open design partner" title="Design partner (⌘L)" onClick={()=>useRailIntent.getState().request("open")}><Sparkles size={17}/><span>Agent</span></button>
        </nav>
        <div className="xd-figma-sidebar">
          <header className="xd-figma-file">
            <div className="xd-figma-file-name">
              {renamingFile&&projectId?<ProjectNameInput id={projectId} name={fileName} className="xd-figma-rename" onFinish={()=>setRenamingFile(false)}/>:
                <Popover label="Main menu" title={fileName} text={<><strong>{fileName}</strong><ChevronDown size={11}/></>} items={fileMenu}/>}
              <small>{readOnly?"View only":roomSession?"Shared room":"Local file"}</small>
            </div>
            <button type="button" className="xd-figma-icon" aria-label="Hide layers panel" title="Hide sidebar" aria-expanded aria-controls={panels.leftId} onClick={()=>panels.toggle('left')}><PanelLeft size={15}/></button>
          </header>
          <div className="xd-editor-panel-scroll xd-figma-sidebar-scroll">
            {editor&&<PageList editor={editor} readOnly={readOnly} report={report}/>}
               <section className="xd-figma-section xd-figma-layers-section"><header><span className="xd-figma-section-title">Layers</span></header>
                 {editor&&(editor.getLayerTree().length?<LayerTree editor={editor} readOnly={readOnly}/>:<div className="xd-editor-empty"><strong>Your canvas is ready</strong><p>Add a frame, draw a shape, or drop an image to begin.</p></div>)}
               </section>
          </div>
        </div>
        <PanelResize side="left" panels={panels}/>
      </aside>
      <div className="xd-pencil-canvas-wrap xd-figma-canvas"><div ref={element} className="xd-pencil-canvas"/>{editor&&<><PresenceCanvas editor={editor} presence={roomState?.presence??null}/><CommentCanvas editor={editor} control={comments} visible={rightTab==='comments'&&panels.right}/></>} {loading&&<div className="xd-pencil-loading" role="status">Loading design canvas…</div>}
        {!panels.left&&<div className="xd-figma-mini xd-figma-mini-left"><strong title={fileName}>{fileName}</strong><button type="button" className="xd-figma-icon" aria-label="Show layers panel" title="Show sidebar" aria-expanded={false} aria-controls={panels.leftId} onClick={()=>panels.toggle('left')}><PanelLeft size={15}/></button></div>}
        {!panels.right&&<div className="xd-figma-mini xd-figma-mini-right">{avatar}{shareButton}{zoomMenu}<button type="button" className="xd-figma-icon" aria-label="Show properties panel" title="Show properties" aria-expanded={false} aria-controls={panels.rightId} onClick={()=>panels.toggle('right')}><PanelRight size={15}/></button></div>}
        <FigmaToolbar groups={TOOL_GROUPS} active={editor?.state.activeTool??"SELECT"} disabled={!editor||readOnly} select={tool=>{comments.cancel();editor?.setTool(tool as Tool);}}
          comments={{pressed:rightTab==='comments'&&panels.right,disabled:!editor||busy,toggle:openComments}}
          extra={<button type="button" className="xd-figma-tool" aria-label="Actions" title="Actions — design partner (⌘L)" onClick={()=>useRailIntent.getState().request("open")}><Sparkle size={18}/></button>}
          devMode={{pressed:devMode,toggle:()=>{setDevMode(value=>!value);if(!panels.right)panels.toggle('right');}}}/>
        {error&&<div className="xd-figma-toast" role="status">{error}</div>}
      </div>
      <aside id={panels.rightId} className="xd-pencil-properties xd-editor-panel xd-editor-panel-right xd-figma-right" aria-label="Design properties" hidden={!panels.right} style={{width:panels.rightWidth}}>
        <header className="xd-figma-right-head">
          {avatar}
          {editor&&roomSession&&roomState?.presence&&<PresenceControls editor={editor} room={roomSession} presence={roomState.presence} busy={busy} report={error=>usePencilWorkspace.setState({error})}/>}
          <CanvasHistoryControls editor={editor} room={roomSession} state={roomState} readOnly={readOnly}/>
          <span className="xd-figma-spacer"/>
          <button type="button" className="xd-figma-icon" aria-label="Present" title="Present prototype" disabled={!canPresent} onClick={()=>setPresent(true)}><Play size={15}/></button>
          {shareButton}
        </header>
        <div className="xd-figma-tabs" role="tablist" aria-label="Properties">
          {devMode?(["code","lint"] as const).map(tab=><button key={tab} type="button" role="tab" aria-selected={devTab===tab} onClick={()=>setDevTab(tab)}>{tab==="code"?"Code":"Lint"}</button>):
           (["design","prototype",...(rightTab==="comments"?["comments" as const]:[])] as const).map(tab=><button key={tab} type="button" role="tab" aria-selected={rightTab===tab} onClick={()=>{setRightTab(tab);if(tab!=='comments')comments.cancel();}}>{tab==="design"?"Design":tab==="prototype"?"Prototype":"Comments"}</button>)}
          <span className="xd-figma-spacer"/>{zoomMenu}
          <button type="button" className="xd-figma-icon" aria-label="Hide properties panel" title="Hide properties" aria-expanded aria-controls={panels.rightId} onClick={()=>panels.toggle('right')}><PanelRight size={15}/></button>
        </div>
        <div className="xd-editor-panel-scroll">{devMode?<div className="xd-pencil-inspect-content"><InspectPanel tab={devTab}/></div>:
          rightTab==='comments'?editor&&<CommentsPanel editor={editor} control={comments}/>:
          rightTab==='prototype'?<div className="xd-figma-prototype"><fieldset className="xd-pencil-edit-fields" disabled={readOnly}>{selected&&editor&&!isLibraryDefinition(editor.graph,selected)?<PrototypePanel key={selected.id} node={selected}/>:<div className="xd-editor-empty"><strong>Prototype</strong><p>Select a frame or layer to add interactions.</p></div>}</fieldset>
            <InspectorSection title="Flows" defaultOpen>{editor&&prototypeScreens(editor.graph,editor.state.currentPageId).length?<button type="button" className="xd-figma-flow" disabled={!canPresent} onClick={()=>setPresent(true)}><Play size={13}/>{prototypeScreens(editor.graph,editor.state.currentPageId)[0]!.name}</button>:<p>No screens on this page yet.</p>}</InspectorSection></div>:<>
          <fieldset className="xd-pencil-edit-fields" disabled={readOnly}>{selected&&<SelectionProperties key={selected.id} node={selected}/>}
          {editor&&!selected&&<div className="xd-pencil-document-controls"><GuidesPanel/></div>}
          {editor&&<div className="xd-pencil-document-controls"><VariablesPanel node={selected&&!isLibraryDefinition(editor.graph,selected)?selected:undefined}/></div>}</fieldset>
          {roomSession&&roomState&&<RoomImageControls room={roomSession} state={roomState} node={selected}/>}
          <InspectorSection title="Export" defaultOpen={!!selected}><select aria-label="Export format" value={exportFormat} onChange={event=>setExportFormat(event.target.value as PencilExportFormat)}>{(["FIG","SVG","PNG","JPG","WEBP","PDF","PPTX","JSX","REACT"] as const).map(format=><option key={format}>{format}</option>)}</select><label>Scale<select aria-label="Export scale" value={exportScale} onChange={event=>setExportScale(Number(event.target.value))}>{[.5,1,2,3,4].map(value=><option key={value} value={value}>{value}×</option>)}</select></label><button disabled={!editor||busy} onClick={()=>void exportFile(exportFormat)}>Export {editor?.state.selectedIds.size?"selection":"page"}</button></InspectorSection>
        </>}</div><PanelResize side="right" panels={panels}/>
      </aside>
    </div>
    <input ref={videoInput} hidden type="file" accept="video/mp4,video/webm,video/ogg,.mp4,.webm,.ogv" aria-label="Video file" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void placePencilVideo(file).catch(report);}}/>
    {actions&&<Actions close={()=>setActions(false)}/>} {resources&&<Suspense fallback={<div className="xd-pencil-dialog" role="status">Loading resources…</div>}><RemoteAssetsDialog close={()=>setResources(false)}/></Suspense>} {scripts&&<Suspense fallback={<div className="xd-pencil-dialog" role="status">Loading scripts…</div>}><ScriptDialog close={()=>setScripts(false)}/></Suspense>} {sharing&&<Suspense fallback={<div className="xd-pencil-dialog" role="status">Loading sharing…</div>}><SharingDialog session={roomSession} close={()=>setSharing(false)}/></Suspense>} {present&&<PrototypePreviewDialog close={()=>setPresent(false)}/>}
  </section></CanvasPreviewContext.Provider>;
}

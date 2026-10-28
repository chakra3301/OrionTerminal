import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { PhotoStudio } from "./photo/PhotoStudio";
import { NewImageDialog } from "./photo/NewImageDialog";
import { RawDevelopDialog } from "./photo/RawDevelopDialog";
import { ColorSettingsDialog } from "./photo/ColorSettingsDialog";
import { ColorImportDialog } from "./photo/ColorImportDialog";
import { cancelColorImport, cancelPasteColor, createImageFromClipboard } from "./photo/runtime";
import { PasteColorDialog } from "./photo/PasteColorDialog";
import { createImage, editImage, runPhotoCommand, usePhotoWorkspace } from "./photo/runtime";
import { Paintbrush, FolderOpen, Frame, Image as ImageIcon } from "lucide-react";
import { MenuButton } from "./EditorMenus";
import { LegacyWorkspace } from "./LegacyWorkspace";
import { XDesignClaudeRail } from "@/apps/xdesign/XDesignClaudeRail";
import { HtmlArtifactPreview } from "@/apps/xdesign/HtmlArtifactPreview";
import { usePresentMode } from "@/apps/xdesign/presentStore";
import { initialScreen, topLevelFrames } from "@/apps/xdesign/prototype";
import { useFileDropZone } from "@/lib/fileDrop";
import { useAssetsStore } from "@/store/assetsStore";
import { useXDesign } from "@/apps/xdesign/store";
import { useXDProjects, projectKind } from "@/apps/xdesign/projectsStore";
import { FxEditor } from "@/apps/xdesign/fx/FxEditor";
import { ModelStudio } from "@/apps/xdesign/model3d/ModelStudio";
import { XDesignHome } from "@/apps/xdesign/XDesignHome";
import { XDesignTabs } from "@/apps/xdesign/XDesignTabs";
import { log } from "@/lib/log";
import { toast } from "@/store/toastStore";
import { placePencilAsset, editPencilImage, pencilCanvasPoint, usePencilWorkspace } from "./pencil/runtime";
import { trackXDesignActivity } from "./runtimeActivity";
import { openProjectFile, saveProjectFile } from "./projectFiles";
import { DraftRecoveryDialog } from "./photo/DraftRecoveryDialog";
import { resumeImageEditor, startOpenImageTracking } from "./photo/resume";
import { staleTabProject } from "./photo/tabs";
import { startPreviewTracking } from "./projectPreview";
import { ProjectHistoryDialog } from "./ProjectHistoryDialog";
import { ProjectChangeStatus } from "./ProjectChangeStatus";

const PencilStudio = lazy(() => import("./pencil/PencilStudio").then(m=>({default:m.PencilStudio})));

/** Enter present mode on the selected top-level frame, else the first screen. */
export function startPresent(): void {
  const { shapes, selection } = useXDesign.getState();
  const selFrame = [...selection]
    .map((id) => shapes.find((s) => s.id === id))
    .find((s) => s && s.kind === "frame" && !s.parentId);
  usePresentMode.getState().enter(selFrame?.id ?? initialScreen(shapes));
}

const LAYERED_EXT = new Set(["psd","psb","tif","tiff","pcraft","exr","hdr","qoi","tga","pnm","dng","cr2","cr3","nef","nrw","arw","srf","sr2","pef","orf","rw2","raf"]);
const RAW_EXT = new Set(["dng","cr2","cr3","nef","nrw","arw","srf","sr2","pef","orf","rw2","raf"]);
const IMG_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "heif", "bmp", "avif",
]);

function isImagePath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return IMG_EXT.has(ext);
}

async function loadImageDims(url: string): Promise<{ w: number; h: number }> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = (e) => reject(e);
    img.src = url;
  });
  return { w: img.naturalWidth, h: img.naturalHeight };
}

/** Ingest dropped image files into the Archives asset library (so they live
 * under the asset:// protocol scope and survive the original being moved/
 * deleted), then add them to the active XDesign page as image shapes near
 * the documented default-zoom viewport center (≈500, 350). Non-image paths
 * are ignored — XDesign is image-focused, and dropping a `.tsx` here would
 * be confusing. */
async function handleImageDrop(paths: string[], point?: { x: number; y: number }): Promise<void> {
  for (const path of paths.filter(p => LAYERED_EXT.has(p.split(".").pop()?.toLowerCase() ?? ""))) await createImage(path);
  const imgs = paths.filter(isImagePath);
  if (imgs.length === 0) return;
  let assets;
  try {
    assets = await useAssetsStore.getState().ingestPaths(imgs);
  } catch (e) {
    log.warn("xdesign drop: ingest failed", e);
    toast.error("Images could not be imported", { body: String(e) });
    return;
  }
  const at = pencilCanvasPoint(point) ?? { x: 500, y: 350 };
  let stagger = 0;
  for (const a of assets) {
    if (a.kind !== "image") continue;
    let w = 480;
    let h = 360;
    try {
      const dims = await loadImageDims(convertFileSrc(a.filePath));
      const MAX = 600;
      const ratio = dims.h > 0 ? dims.w / dims.h : 1;
      if (dims.w > MAX || dims.h > MAX) {
        if (ratio >= 1) {
          w = MAX;
          h = Math.round(MAX / ratio);
        } else {
          h = MAX;
          w = Math.round(MAX * ratio);
        }
      } else {
        w = dims.w;
        h = dims.h;
      }
    } catch {
      /* keep defaults — broken image still places, user can resize */
    }
    if(useXDesign.getState().pencilDocument)await placePencilAsset(a.filePath,a.filePath.split("/").pop()??"image.png",at.x-w/2+stagger,at.y-h/2+stagger,w,h);else useXDesign.getState().addShape({
      kind: "image",
      x: 500 - w / 2 + stagger,
      y: 350 - h / 2 + stagger,
      w,
      h,
      filePath: a.filePath,
      assetId: a.id,
      fill: "transparent",
      stroke: "transparent",
      strokeWidth: 0,
    });
    stagger += 30;
  }
}

// The status sits outside .xd-root so the inert, dimmed workspace doesn't dim or hide it.
export function XDesignApp() {
  return <><XDesignWorkspace/><ProjectChangeStatus/></>;
}

function XDesignWorkspace() {
  const stageRef = useRef<HTMLDivElement>(null);
  // Captured via callback ref → state so the docked Design Partner can portal
  // up to the shell and live as a real flex column (see XDesignClaudeRail).
  const [shellEl, setShellEl] = useState<HTMLDivElement | null>(null);
  const [dropOver, setDropOver] = useState(false);
  const [newImageOpen,setNewImageOpen]=useState(false);
  const [rawImport,setRawImport]=useState<{path:string;projectId:string}|null>(null);
  const [colorSettingsOpen,setColorSettingsOpen]=useState(false);
  const [draftsOpen,setDraftsOpen]=useState(false);
  const [historyOpen,setHistoryOpen]=useState(false);
  const draftCount=useXDesign(s=>s.photoDrafts.length);
  const pencilDocument=useXDesign(s=>s.pencilDocument);
  const importDesignRef=useRef<HTMLInputElement>(null);
  const photoProject=usePhotoWorkspace(s=>s.projectId);
  const tabProject=usePhotoWorkspace(s=>s.tabProject);
  const photoShapeId = usePhotoWorkspace(s => s.shapeId);
  const photoBusy = usePhotoWorkspace(s => s.busy);
  const pencilImageId=usePencilWorkspace(s=>s.editor?.getSelectedNodes().find(n=>n.fills.some(f=>f.type==="IMAGE"))?.id);
  const pencilReady=usePencilWorkspace(s=>!!s.editor);
  const selectedImageId = useXDesign(s => s.shapes.find(shape => shape.kind === "image" && s.selection.has(shape.id))?.id);
  const pencilBusy=usePencilWorkspace(s=>s.busy);
  const imageReady=!photoBusy&&!pencilBusy&&(!pencilDocument||pencilReady);
  const hasFrames = useXDesign((s) => topLevelFrames(s.shapes).length > 0);
  const activeId = useXDProjects((s) => s.activeId);
  const transitioning = useXDProjects((s) => s.transitioning);
  useEffect(()=>{if(staleTabProject(activeId))usePhotoWorkspace.getState().close();},[activeId,photoProject,tabProject]);
  useEffect(()=>startOpenImageTracking(),[]);
  useEffect(()=>startPreviewTracking(),[]);
  const pencilEditor=usePencilWorkspace(s=>s.editor);
  const resumedFor=useRef<string|null>(null);
  useEffect(()=>{
    if(!activeId){resumedFor.current=null;return;}
    if(transitioning||!imageReady||resumedFor.current===activeId)return;
    resumedFor.current=activeId;
    void resumeImageEditor(activeId).then(done=>{if(!done&&resumedFor.current===activeId)resumedFor.current=null;});
  },[activeId,transitioning,imageReady,pencilEditor]);
  useEffect(()=>{if(rawImport&&rawImport.projectId!==activeId)setRawImport(null);},[activeId,rawImport]);
  useEffect(()=>()=>{cancelColorImport();cancelPasteColor();},[]);
  const decisionProject=usePhotoWorkspace(state=>state.pasteDecision?.projectId??state.colorDecision?.projectId);
  useEffect(()=>{if(decisionProject&&decisionProject!==activeId){cancelColorImport();cancelPasteColor();}},[decisionProject,activeId]);
  const transitionProps = { inert: transitioning, "aria-busy": transitioning, style: { opacity: transitioning ? 0.65 : undefined } };
  const activeKind = useXDProjects((s) =>
    projectKind(s.registry.find((m) => m.id === s.activeId)),
  );
  const openImage = async () => {
    const path=await open({multiple:false,filters:[{name:"Images and layered documents",extensions:[...IMG_EXT,...LAYERED_EXT]}]});
    if(typeof path!=="string")return;
    const extension=path.split(/[\\/.]/).pop()?.toLowerCase()??"";
    if(RAW_EXT.has(extension)){const projectId=useXDProjects.getState().activeId;if(projectId)setRawImport({path,projectId});}
    else await createImage(path);
  };

  useFileDropZone(stageRef, "xdesign-canvas", (e) => {
    if (e.type === "enter") setDropOver(true);
    else if (e.type === "leave") setDropOver(false);
    else {
      setDropOver(false);
      const projects=e.paths.filter(path=>path.toLowerCase().endsWith(".xdesign"));
      if(projects.length&&!useXDProjects.getState().transitioning) {
        void (async()=>{for(const path of projects)await openProjectFile(path);})().catch(error=>toast.error("Project import failed",{body:String(error)}));
        return;
      }
      if (useXDProjects.getState().transitioning||!useXDProjects.getState().activeId||activeKind!=="design") return;
      const photo=usePhotoWorkspace.getState();
      if(photo.shapeId&&photo.projectId===useXDProjects.getState().activeId) {
        // runPhotoCommand reports failures in the Image editor itself.
        const images=e.paths.filter(path=>isImagePath(path)||LAYERED_EXT.has(path.split(".").pop()?.toLowerCase()??""));
        void (async()=>{for(const path of images)await runPhotoCommand("file.placeEmbedded",{path,fit:true});})().catch(()=>{});
        return;
      }
      void trackXDesignActivity("canvas-image-import", "Wait for image import to finish before changing projects.", () => handleImageDrop(e.paths, e.point))
        .catch((error) => toast.error("Image import failed", { body: String(error) }));
    }
  });

  if (activeId === null) {
    return (
      <div ref={stageRef} className="xd-root xd-root-home" {...transitionProps}>
        <XDesignHome />
      </div>
    );
  }

  if (activeKind === "fx") {
    return (
      <div ref={stageRef} className="xd-root" {...transitionProps}>
        <XDesignTabs />
        <FxEditor />
      </div>
    );
  }

  if (activeKind === "model") {
    return (
      <div ref={stageRef} className="xd-root" {...transitionProps}>
        <XDesignTabs />
        <ModelStudio />
      </div>
    );
  }

  return (
    <div ref={stageRef} className="xd-root" {...transitionProps}>
      <XDesignTabs actions={<>
        <span className="xd-workspace-kind">{photoShapeId?<ImageIcon size={13}/>:<Frame size={13}/>} {photoShapeId?"Image":"Design"}</span>
        {!photoShapeId&&(pencilDocument?pencilImageId:selectedImageId)&&<button className="xd-edit-image" disabled={!imageReady} onClick={() => { const id=pencilDocument?pencilImageId:selectedImageId;if(id) void (pencilDocument?editPencilImage(id):editImage(id)).catch(error => toast.error("Image could not be opened", {body:String(error)})); }} title="Edit selected image"><Paintbrush size={13}/><span>Edit image</span></button>}
        <MenuButton label="File" icon={FolderOpen} align="end" items={[
          {label:"Open XDesign project…",disabled:photoBusy||pencilBusy,run:()=>{void openProjectFile().catch(error=>toast.error("Project could not be opened",{body:String(error)}));}},
          {label:"Save project file…",disabled:photoBusy||pencilBusy,run:()=>{void saveProjectFile().catch(error=>toast.error("Project file was not saved",{body:String(error)}));}},
          {label:`Image drafts${draftCount?` (${draftCount})`:""}…`,disabled:photoBusy||pencilBusy||!draftCount,run:()=>setDraftsOpen(true)},
          {label:"Project history…",disabled:photoBusy||pencilBusy,run:()=>setHistoryOpen(true)},
          "-",
          {label:"New design",disabled:photoBusy||pencilBusy,run:()=>{void import("./pencil/runtime").then(m=>m.newPencilProject()).catch(error=>toast.error("Design could not be created",{body:String(error)}));}},
          {label:"Open Figma / Pencil",disabled:photoBusy||pencilBusy,run:()=>importDesignRef.current?.click()},
          "-",
          {label:"New image from clipboard",disabled:!imageReady,run:()=>{void createImageFromClipboard().catch(error=>toast.error("Clipboard image could not be created",{body:String(error)}));}},
          {label:"New image",disabled:!imageReady,run:()=>setNewImageOpen(true)},
          {label:"Color settings…",disabled:photoBusy||pencilBusy,run:()=>setColorSettingsOpen(true)},
          {label:"Open image / PSD",disabled:!imageReady,run:()=>{void openImage().catch(error=>toast.error("Image import failed",{body:String(error)}));}},
        ]}/>
      </>}/>
      <input hidden ref={importDesignRef} type="file" accept=".fig,.pen" onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void import("./pencil/runtime").then(m=>m.newPencilProject(file)).catch(error=>toast.error("Design import failed",{body:String(error)}));}}/>
      {/* These Photoshop dialogs are styled under the image editor's .xd-photo scope; outside it they would render unstyled. */}
      <div className="xd-photo" style={{display:"contents"}}>
        {newImageOpen&&<NewImageDialog close={()=>setNewImageOpen(false)}/>}
        {rawImport&&rawImport.projectId===activeId&&<RawDevelopDialog key={`${rawImport.projectId}:${rawImport.path}`} path={rawImport.path} close={()=>setRawImport(null)} develop={(path,options)=>{if(useXDProjects.getState().activeId!==rawImport.projectId)return Promise.reject(new Error("The active project changed before RAW import."));return createImage(path,undefined,options);}}/>}
        {colorSettingsOpen&&<ColorSettingsDialog close={()=>setColorSettingsOpen(false)}/>}
        <ColorImportDialog/>
        <PasteColorDialog/>
      </div>
      {draftsOpen&&<DraftRecoveryDialog close={()=>setDraftsOpen(false)}/>}
      {historyOpen&&<ProjectHistoryDialog close={()=>setHistoryOpen(false)}/>}
      {pencilDocument&&<div className="xd-editor-shell" ref={setShellEl} style={{display:photoShapeId?"none":"flex"}} aria-hidden={!!photoShapeId}><Suspense fallback={<div role="status">Loading design workspace…</div>}><PencilStudio key={activeId}/></Suspense><XDesignClaudeRail dockTarget={shellEl} launcher="hidden"/><HtmlArtifactPreview/></div>}
      {photoShapeId&&photoProject===activeId ? <PhotoStudio /> : !pencilDocument&&<LegacyWorkspace dropOver={dropOver} hasFrames={hasFrames} present={startPresent} shellEl={shellEl} captureShell={setShellEl}/> }
    </div>
  );
}

import { log } from "@/lib/log";
import { projectKind, useXDProjects } from "../projectsStore";
import { useXDesign } from "../store";
import { editPencilImage, pencilEditorProject, pencilPhotoDocumentId } from "../pencil/runtime";
import { editImage, usePhotoWorkspace } from "./runtime";
import { sameTab, tabDocumentId, tabKey } from "./tabs";
import { PHOTO_TAB_LIMIT, type PhotoResume, type PhotoTab } from "./types";
export { closeImageEditor } from "./tabs";

export function startOpenImageTracking(): () => void {
  return usePhotoWorkspace.subscribe(workspace => {
    const { activeId, transitioning } = useXDProjects.getState();
    const { shapeId, documentId, source } = workspace;
    // While smart object contents are open, the image to come back to is still their parent.
    if (!shapeId || !documentId || workspace.projectId !== activeId || transitioning || workspace.smartTrail.length) return;
    const tabs = workspace.tabs.length > 1 ? workspace.tabs.slice(0, PHOTO_TAB_LIMIT).map(tab => ({ source: tab.source, placementId: tab.placementId })) : undefined;
    const current = useXDesign.getState().photoResume;
    if (current?.source === source && current.placementId === shapeId && current.documentId === documentId &&
      (current.tabs ?? []).map(tabKey).join() === (tabs ?? []).map(tabKey).join()) return;
    useXDesign.setState({ photoResume: { source, placementId: shapeId, documentId, ...(tabs ? { tabs } : {}) } });
  });
}

export function resumableImage(): PhotoResume | null {
  const { photoResume, shapes, photoDocuments } = useXDesign.getState();
  if (!photoResume || !photoDocuments[photoResume.documentId]) return null;
  if (photoResume.source === "pencil")
    return pencilEditorProject() === useXDProjects.getState().activeId && pencilPhotoDocumentId(photoResume.placementId) === photoResume.documentId ? photoResume : null;
  const shape = shapes.find(s => s.id === photoResume.placementId);
  return shape?.kind === "image" && shape.photoDocumentId === photoResume.documentId ? photoResume : null;
}

/** Resolves false when the Pencil canvas hasn't loaded yet, so the caller tries again once it has. */
export async function resumeImageEditor(projectId: string): Promise<boolean> {
  const active = () => useXDProjects.getState().activeId === projectId && !useXDProjects.getState().transitioning;
  const { registry } = useXDProjects.getState();
  const resume = useXDesign.getState().photoResume;
  // FX and 3D projects leave the design store as the last design project had it.
  if (!active() || !resume || projectKind(registry.find(m => m.id === projectId)) !== "design" || usePhotoWorkspace.getState().projectId === projectId) return true;
  if (resume.source === "pencil" && pencilEditorProject() !== projectId) return false;
  const forget = () => {
    if (!active()) return;
    useXDesign.setState({ photoResume: null });
    usePhotoWorkspace.setState({ error: null });
  };
  const image = resumableImage();
  if (!image) { forget(); return true; }
  try {
    await (image.source === "pencil" ? editPencilImage(image.placementId) : editImage(image.placementId));
    const shown = usePhotoWorkspace.getState();
    // The other tabs load when they're clicked.
    if (active() && image.tabs && shown.shapeId === image.placementId && shown.source === image.source) {
      const tabs: PhotoTab[] = [];
      for (const tab of image.tabs) if (!tabs.some(item => sameTab(item, tab)) && (sameTab(tab, image) || tabDocumentId(tab))) tabs.push({ source: tab.source, placementId: tab.placementId });
      if (!tabs.some(tab => sameTab(tab, image))) tabs.push({ source: image.source, placementId: image.placementId });
      usePhotoWorkspace.setState({ tabs, tabProject: projectId });
    }
  } catch (error) {
    log.warn("xdesign: the remembered image didn't reopen", error);
    forget();
  }
  return true;
}

import { log } from "@/lib/log";
import { projectKind, useXDProjects } from "../projectsStore";
import { useXDesign } from "../store";
import { editPencilImage, pencilEditorProject, pencilPhotoDocumentId } from "../pencil/runtime";
import { editImage, usePhotoWorkspace } from "./runtime";
import type { PhotoResume } from "./types";

export function startOpenImageTracking(): () => void {
  return usePhotoWorkspace.subscribe(workspace => {
    const { activeId, transitioning } = useXDProjects.getState();
    const { shapeId, documentId, source } = workspace;
    // While smart object contents are open, the image to come back to is still their parent.
    if (!shapeId || !documentId || workspace.projectId !== activeId || transitioning || workspace.smartTrail.length) return;
    const current = useXDesign.getState().photoResume;
    if (current?.source === source && current.placementId === shapeId && current.documentId === documentId) return;
    useXDesign.setState({ photoResume: { source, placementId: shapeId, documentId } });
  });
}

/** Closing the editor yourself means the project reopens on the board. Automatic closes keep it. */
export function closeImageEditor(): void {
  if (usePhotoWorkspace.getState().busy) return;
  usePhotoWorkspace.getState().close();
  useXDesign.setState({ photoResume: null });
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
  } catch (error) {
    log.warn("xdesign: the remembered image didn't reopen", error);
    forget();
  }
  return true;
}

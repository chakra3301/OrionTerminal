import { computeExportBounds, renderPngBytes } from "./exportXD";
import { renderFxSnapshot } from "./fx/fxExport";
import { useFxStore } from "./fx/fxStore";
import { useHtmlArtifact } from "./htmlArtifactStore";
import { getModelRenderBridge } from "./model3d/modelRenderBridge";
import { capturePencilPreview } from "./pencil/runtime";
import { resumableImage } from "./photo/resume";
import { loadImageBitmap, scaleToPng } from "./previewImage";
import { projectKind, useXDProjects } from "./projectsStore";
import { useXDesign } from "./store";

/** Bytes are stored; "clear" removes the stored preview so the card falls back; null means it can't be drawn right now. */
export type PreviewPicture = Uint8Array | "clear" | null;

export async function captureProjectPicture(projectId: string, maxEdge: number): Promise<PreviewPicture> {
  const { activeId, registry } = useXDProjects.getState();
  if (activeId !== projectId) return null;
  const artifact = useHtmlArtifact.getState();
  if (artifact.projectId === projectId && artifact.open) return "clear";
  const kind = projectKind(registry.find((m) => m.id === projectId));
  if (kind === "fx") {
    const { scene } = useFxStore.getState();
    const scale = Math.min(1, maxEdge / Math.max(scene.width, scene.height));
    const blob = await renderFxSnapshot(scene, 0, Math.max(1, Math.round(scene.width * scale)), Math.max(1, Math.round(scene.height * scale)));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }
  if (kind === "model") {
    const canvas = await getModelRenderBridge()?.captureReviewShot();
    return canvas ? scaleToPng(canvas, canvas.width, canvas.height, maxEdge) : null;
  }
  const image = resumableImage();
  if (image) {
    const bitmap = await loadImageBitmap(useXDesign.getState().photoDocuments[image.documentId]!.previewPath);
    try { return await scaleToPng(bitmap, bitmap.width, bitmap.height, maxEdge); }
    finally { bitmap.close(); }
  }
  if (useXDesign.getState().pencilDocument) {
    const picture = await capturePencilPreview(maxEdge);
    return picture === "empty" ? "clear" : picture;
  }
  const bounds = computeExportBounds(useXDesign.getState().shapes, new Set());
  if (!bounds) return "clear";
  // The board's own photo previews are plenty at card size; full-resolution photos
  // would be read and base64-encoded on the main thread on every capture.
  const bytes = await renderPngBytes(bounds, maxEdge, false);
  return bytes ? new Uint8Array(bytes) : null;
}

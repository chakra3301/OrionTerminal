import { useRef } from "react";
import { createPortal } from "react-dom";
import { usePhotoCommandPreview } from "./commandPreview";
import { usePhotoWorkspace } from "./runtime";
import type { PhotoDocument } from "./types";

/** A control's in-progress value; `committing` once it is let go and the real command runs. */
export type CanvasDraft = { command: string; params: Record<string, unknown>; committing?: boolean };

export type LayerPropsDraft = { layer: number; opacity?: number; fill?: number; committing?: boolean };
export const layerPropsDraft = (draft: LayerPropsDraft | null): CanvasDraft | null => draft && {
  command: "layer.setProps", committing: draft.committing,
  params: { layer: draft.layer, ...(draft.opacity === undefined ? {} : { opacity: draft.opacity / 100 }), ...(draft.fill === undefined ? {} : { fill: draft.fill / 100 }) },
};

/** Shows a drag on the canvas before it commits, so a scrub is one history step that still updates as it moves. */
export function CanvasDraftPreview({ document, draft, canvas }: { document: PhotoDocument; draft: CanvasDraft | null; canvas: HTMLElement | null }) {
  const projectId = usePhotoWorkspace(state => state.projectId), viewKey = usePhotoWorkspace(state => state.state?.viewKey);
  const preview = usePhotoCommandPreview(document, projectId, draft?.command ?? "", draft?.params ?? {}, { automatic: true, enabled: !!draft && !draft.committing, delay: 0, viewKey });
  // The last frame stays until the committed image is shown, so the old pixels never flash back.
  const last = useRef<string | null>(null);
  if (preview.url) last.current = preview.url; else if (!draft) last.current = null;
  const url = draft ? preview.url ?? last.current : null;
  return canvas && url ? createPortal(<img className="xd-photo-canvas-preview" src={url} alt="" draggable={false}/>, canvas) : null;
}

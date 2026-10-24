import { useEffect, useState, type RefObject } from "react";
import type { PhotoDocument } from "./types";
import { usePhotoWorkspace } from "./runtime";
import { usePhotoCommandPreview } from "./commandPreview";

/** Returns whether the pixels are already showing, so the caller can drop its outline. */
export type MoveDragUpdate = (offset: [number, number] | "hold" | null) => boolean;

/** The Move tool's drag shows the layer's pixels at the new place, as in Photoshop, instead of only its outline. */
export function MoveDragPreview({ document, layer, bind, redraw }: { document: PhotoDocument; layer: number; bind: RefObject<MoveDragUpdate | null>; redraw: () => void }) {
  const projectId = usePhotoWorkspace(workspace => workspace.projectId), viewKey = usePhotoWorkspace(workspace => workspace.state?.viewKey);
  const [offset, setOffset] = useState<[number, number] | null>(null), [held, setHeld] = useState<string | null>(null);
  const moved = !!offset && (offset[0] !== 0 || offset[1] !== 0);
  const preview = usePhotoCommandPreview(document, projectId, "edit.transform", { layer, matrix: [1, 0, 0, 1, offset?.[0] ?? 0, offset?.[1] ?? 0], interpolation: "nearest" }, { automatic: true, enabled: moved && document.width * document.height <= 16_777_216, viewKey, delay: 0 });
  const url = moved ? preview.url : null, fresh = !!url && preview.current;
  // Previews trail the drag by a render, so the outline marks the cursor's place until the pixels catch up.
  useEffect(() => { if (fresh) redraw(); }, [fresh]);
  useEffect(() => {
    // The released drag keeps its last frame until the committed image is shown, so the old pixels never flash back.
    bind.current = next => {
      if (next === "hold") { setHeld(fresh ? url : null); setOffset(null); return fresh; }
      setHeld(null);
      const same = !!next && !!offset && next[0] === offset[0] && next[1] === offset[1];
      if (!same) setOffset(next);
      return same && fresh;
    };
    return () => { bind.current = null; };
  }, [bind, url, offset, fresh]);
  const shown = held ?? url;
  return shown ? <img className="xd-photo-main-transform-preview" src={shown} alt="Moved layer preview"/> : null;
}

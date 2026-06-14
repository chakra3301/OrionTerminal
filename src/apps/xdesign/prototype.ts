// Prototyping lite — hotspot links + present-mode flow.
//
// A "screen" is a top-level frame. A shape with a `prototype` link becomes a
// hotspot: clicking it in present mode navigates to a target screen (or back).
// Pure + framework-free for cheap unit testing; the present overlay renders the
// active screen via the existing SVG export (buildExportSVG) and overlays
// clickable hotspot regions computed from the shapes' boxes.

import type { Shape } from "./store";

export type ProtoTransition = "instant" | "dissolve" | "slide";

export type ProtoLink = {
  trigger: "click";
  /** navigate → go to `target` frame; back → pop the present history. */
  action: "navigate" | "back";
  /** Destination top-level frame id (for action === "navigate"). */
  target?: string;
  transition?: ProtoTransition;
};

/** Top-level frames = the prototype's screens, in document order. */
export function topLevelFrames(shapes: Shape[]): Shape[] {
  return shapes.filter((s) => s.kind === "frame" && !s.parentId);
}

/** The top-level frame a shape sits inside (the screen it belongs to). Returns
 * the shape itself when it's already a top-level frame, or null when the root
 * ancestor isn't a frame. */
export function topLevelFrameAncestor(
  shapes: Shape[],
  id: string,
): Shape | null {
  const byId = new Map<string, Shape>(shapes.map((s) => [s.id, s]));
  let node: Shape | undefined = byId.get(id);
  if (!node) return null;
  while (node.parentId) {
    const parent: Shape | undefined = byId.get(node.parentId);
    if (!parent) break;
    node = parent;
  }
  return node && node.kind === "frame" && !node.parentId ? node : null;
}

/** Prototyped shapes whose screen is `frameId`. */
export function hotspotsForScreen(shapes: Shape[], frameId: string): Shape[] {
  return shapes.filter(
    (s) => s.prototype && topLevelFrameAncestor(shapes, s.id)?.id === frameId,
  );
}

/** The screen present mode opens on — the first top-level frame. */
export function initialScreen(shapes: Shape[]): string | null {
  return topLevelFrames(shapes)[0]?.id ?? null;
}

export type Fit = { scale: number; offsetX: number; offsetY: number };

/** Contain-fit a frame (fw×fh) into a viewport (vw×vh): scale to the limiting
 * axis and center the letterbox. */
export function computeFit(
  fw: number,
  fh: number,
  vw: number,
  vh: number,
): Fit {
  const scale = Math.min(vw / fw, vh / fh);
  return {
    scale,
    offsetX: (vw - fw * scale) / 2,
    offsetY: (vh - fh * scale) / 2,
  };
}

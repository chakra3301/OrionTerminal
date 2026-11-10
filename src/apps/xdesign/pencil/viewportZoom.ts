import type { Editor } from "@open-pencil/core/editor";
import { computeAbsoluteBounds, computeBounds } from "@open-pencil/scene-graph/geometry";

type Size = { width: number; height: number };
type Rect = { x: number; y: number; width: number; height: number };
const PADDING = 80;

// Upstream zoomToLevel does not scale the pan by the new zoom, so the centre drifts.
export function zoomAroundCenter(editor: Editor, level: number, size: Size) {
  editor.setZoomAroundPoint(level, size.width / 2, size.height / 2);
}

// Upstream zoomToBounds caps at 100%, so ⇧1/⇧2 could never zoom in on small content.
export function fitBounds(editor: Editor, bounds: Rect, size: Size) {
  const zoom = Math.max(.02, Math.min(256, size.width / (bounds.width + PADDING * 2), size.height / (bounds.height + PADDING * 2)));
  editor.setZoomAroundPoint(zoom, 0, 0);
  editor.pan(size.width / 2 - (bounds.x + bounds.width / 2) * zoom - editor.state.panX, size.height / 2 - (bounds.y + bounds.height / 2) * zoom - editor.state.panY);
}

export function zoomToFitPage(editor: Editor, size: Size) {
  const nodes = editor.graph.getChildren(editor.state.currentPageId);
  if (nodes.length) fitBounds(editor, computeBounds(nodes), size);
}

export function zoomToFitSelection(editor: Editor, size: Size) {
  const nodes = [...editor.state.selectedIds].map(id => editor.graph.getNode(id)).filter(node => node != null);
  if (nodes.length) fitBounds(editor, computeAbsoluteBounds(nodes, id => editor.graph.getAbsolutePosition(id)), size);
}

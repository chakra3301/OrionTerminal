import type { Editor } from "@open-pencil/core/editor";
import { isLibraryDefinition } from "./librarySession";

/** Capture image activation before upstream double-click drills into containers.
 * Leave text editing, vector editing and normal selection to OpenPencil. */
export function installImageDoubleClick(element: HTMLElement, editor: Editor, enabled: () => boolean,
  openImage: (id: string) => Promise<void>, onError: (error: unknown) => void) {
  let opening = false;
  const onDoubleClick = (event: MouseEvent) => {
    if (event.button !== 0 || !(event.target instanceof HTMLCanvasElement)) return;
    if (!enabled() || opening) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (editor.state.activeTool !== "SELECT" || editor.state.editingTextId || editor.state.nodeEditState) return;
    const rect = event.target.getBoundingClientRect();
    const point = editor.screenToCanvas(event.clientX - rect.left, event.clientY - rect.top);
    const entered = editor.state.enteredContainerId && editor.graph.getNode(editor.state.enteredContainerId);
    const scope = entered && entered.visible && !entered.locked ? entered.id : editor.state.currentPageId;
    const node = editor.graph.hitTestDeep(point.x, point.y, scope);
    if (!node || node.locked || !node.visible || isLibraryDefinition(editor.graph, node) ||
      !node.fills.some(fill => fill.type === "IMAGE" && fill.visible && fill.imageHash)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    editor.select([node.id]);
    editor.requestRender();
    opening = true;
    void openImage(node.id).catch(onError).finally(() => { opening = false; });
  };
  element.addEventListener("dblclick", onDoubleClick, true);
  return () => element.removeEventListener("dblclick", onDoubleClick, true);
}

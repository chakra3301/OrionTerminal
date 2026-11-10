import type { Editor } from "@open-pencil/core/editor";
import { claimSlotContent, containingSlot, installSlotSupport, nearestSlotInstance, slotPropertyId } from "./slots";
import { editPencilGraph } from "./toolExecution";

/** Claim inherited contents and include that ownership change in clipboard undo. */
export function installSlotEditing(editor: Editor) {
  installSlotSupport(editor.graph);
  const deleteSelected = editor.deleteSelected, duplicateSelected = editor.duplicateSelected, pasteFromHTML = editor.pasteFromHTML, pasteSnapshot = editor.pasteSnapshot, switchVariant = editor.switchInstanceVariant;
  const selectedSlots = (paste: boolean) => {
    const ids = paste && editor.state.enteredContainerId ? [editor.state.enteredContainerId] : [...editor.state.selectedIds];
    return [...new Set(ids.flatMap(id => {
      const node = editor.graph.getNode(id); if (!node) return [];
      const frame = paste && slotPropertyId(node) && nearestSlotInstance(editor.graph, node) ? node : containingSlot(editor.graph, node);
      return frame ? [frame.id] : [];
    }))];
  };
  const claim = (ids: string[]) => { if (ids.length) editPencilGraph(editor, "Edit slot content", () => { for (const id of ids) claimSlotContent(editor.graph, editor.graph.getNode(id)!); }); };
  const sync = (label: string, work: () => void) => {
    const ids = selectedSlots(false); if (!ids.length) return work();
    editor.undo.beginBatch(label);
    try { claim(ids); work(); editor.undo.commitBatch(); }
    catch (error) { editor.undo.rollbackBatch(); throw error; }
  };
  const asyncEdit = async <T>(work: () => Promise<T>): Promise<T> => {
    const ids = selectedSlots(true); if (!ids.length) return work();
    editor.undo.beginBatch("Paste into slot");
    try { claim(ids); const result = await work(); editor.undo.commitBatch(); return result; }
    catch (error) { editor.undo.rollbackBatch(); throw error; }
  };
  editor.deleteSelected = () => sync("Delete slot content", deleteSelected);
  editor.duplicateSelected = () => sync("Duplicate slot content", duplicateSelected);
  editor.pasteFromHTML = (...args) => asyncEdit(() => pasteFromHTML(...args));
  editor.pasteSnapshot = (...args) => asyncEdit(() => pasteSnapshot(...args));
  editor.switchInstanceVariant = (...args) => {
    const node = editor.graph.getNode(args[0]);
    const main=node?.componentId?editor.graph.getNode(node.componentId):undefined;
    if (!node || main?.componentPropertyValues[args[1]]===args[2] || !editor.getVariantOptionAvailability(args[0],args[1]).some(option=>option.value===args[2]&&option.available) || ![...editor.graph.nodes.values()].some(frame => editor.graph.isDescendant(frame.id, node.id) && slotPropertyId(frame))) return switchVariant(...args);
    // Native variant undo rebuilds children and cannot restore contents of a
    // removed slot. Capture the complete edit once, including those contents.
    return editPencilGraph(editor, "Change component variant", () => {
      const push = editor.undo.push;
      editor.undo.push = () => undefined;
      try { return switchVariant(...args); } finally { editor.undo.push = push; }
    });
  };
  return () => {
    editor.deleteSelected = deleteSelected; editor.duplicateSelected = duplicateSelected;
    editor.pasteFromHTML = pasteFromHTML; editor.pasteSnapshot = pasteSnapshot; editor.switchInstanceVariant = switchVariant;
  };
}

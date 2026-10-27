import type { Editor } from '@open-pencil/core/editor';
import { zoomToFitPage, zoomToFitSelection } from './viewportZoom';

export function installViewerInput(element: HTMLElement, editor: Editor, enabled: () => boolean): () => void {
  let space = false, pointer: { id: number; x: number; y: number } | null = null;
  const stop = () => { const captured = pointer; pointer = null; space = false; if (captured) { try { element.releasePointerCapture(captured.id); } catch {} } };
  const editableTarget = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable=true]');
  const down = (event: PointerEvent) => {
    if (!enabled() || editableTarget(event.target) || pointer || !event.isPrimary || ![0, 1].includes(event.button)) return;
    event.preventDefault(); event.stopImmediatePropagation(); (element.querySelector('canvas') ?? element).focus();
    if (event.button === 1 || space || editor.state.activeTool === 'HAND') {
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }; try { element.setPointerCapture(event.pointerId); } catch {}
    } else {
      const rect = element.getBoundingClientRect(), point = editor.screenToCanvas(event.clientX - rect.left, event.clientY - rect.top), node = editor.hitTestAtPoint(point.x, point.y, event.metaKey || event.ctrlKey);
      if (node) editor.select([node.id], event.shiftKey); else if (!event.shiftKey) editor.clearSelection();
    }
  };
  const move = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (!enabled()) { stop(); return; } event.preventDefault(); event.stopImmediatePropagation(); editor.pan(event.clientX - pointer.x, event.clientY - pointer.y); pointer = { id: pointer.id, x: event.clientX, y: event.clientY };
  };
  const up = (event: PointerEvent) => { if (pointer?.id === event.pointerId) { event.preventDefault(); event.stopImmediatePropagation(); stop(); } };
  const wheel = (event: WheelEvent) => {
    if (!enabled() || editableTarget(event.target)) return; event.preventDefault(); event.stopImmediatePropagation();
    const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, element.clientHeight) : 1, dx = event.deltaX * factor, dy = event.deltaY * factor;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (event.ctrlKey || event.metaKey) { const rect = element.getBoundingClientRect(); editor.applyZoom(dy, event.clientX - rect.left, event.clientY - rect.top); } else editor.pan(-dx, -dy);
  };
  const key = (event: KeyboardEvent) => {
    if (!enabled() || editableTarget(event.target) || event.isComposing) return;
    if (event.code === 'Space') { space = true; event.preventDefault(); event.stopImmediatePropagation(); }
    else if (event.key === 'Escape') { stop(); editor.clearSelection(); }
    else if (!event.metaKey && !event.ctrlKey) {
      if (event.key === '1') zoomToFitPage(editor, { width: element.clientWidth, height: element.clientHeight }); else if (event.key === '2') zoomToFitSelection(editor, { width: element.clientWidth, height: element.clientHeight });
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) editor.pan(event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0, event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0);
      else return; event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') space = false; };
  element.addEventListener('pointerdown', down, true); element.addEventListener('pointermove', move, true); element.addEventListener('pointerup', up, true); element.addEventListener('pointercancel', up, true); element.addEventListener('lostpointercapture', up, true);
  element.addEventListener('wheel', wheel, { capture: true, passive: false }); element.addEventListener('keydown', key, true); element.addEventListener('keyup', keyup, true); element.addEventListener('blur', stop, true);
  return () => { stop(); element.removeEventListener('pointerdown', down, true); element.removeEventListener('pointermove', move, true); element.removeEventListener('pointerup', up, true); element.removeEventListener('pointercancel', up, true); element.removeEventListener('lostpointercapture', up, true); element.removeEventListener('wheel', wheel, true); element.removeEventListener('keydown', key, true); element.removeEventListener('keyup', keyup, true); element.removeEventListener('blur', stop, true); };
}

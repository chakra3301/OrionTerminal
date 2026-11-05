import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { installViewerInput } from './viewerInput';
let editor: Editor, element: HTMLDivElement, dispose: () => void, enabled: boolean;
function pointer(type: string, properties: Record<string, unknown> = {}) { const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { isPrimary: true, pointerId: 1, clientX: 0, clientY: 0, button: 0, ...properties }); element.dispatchEvent(event); return event; }
beforeEach(() => {
  editor = createEditor(); element = document.createElement('div'); element.tabIndex = 0; document.body.append(element); enabled = true;
  element.setPointerCapture = vi.fn(); element.releasePointerCapture = vi.fn(); dispose = installViewerInput(element, editor, () => enabled);
});
afterEach(() => { dispose(); editor.dispose(); element.remove(); });
it('selects and adds peer-visible layers without changing artwork or history', () => {
  const page = editor.state.currentPageId, a = editor.graph.createNode('RECTANGLE', page), b = editor.graph.createNode('RECTANGLE', page);
  const hit = vi.spyOn(editor, 'hitTestAtPoint').mockReturnValueOnce(a).mockReturnValueOnce(b).mockReturnValueOnce(null);
  pointer('pointerdown'); pointer('pointerdown', { shiftKey: true, metaKey: true }); expect([...editor.state.selectedIds]).toEqual([a.id, b.id]); expect(hit.mock.calls[1]![2]).toBe(true);
  pointer('pointerdown'); expect(editor.state.selectedIds.size).toBe(0); expect(editor.undo.canUndo).toBe(false);
});
it('pans with captured input and safely handles synchronous capture loss', () => {
  element.releasePointerCapture = vi.fn(() => { pointer('lostpointercapture'); });
  pointer('pointerdown', { button: 1, clientX: 10, clientY: 20 }); pointer('pointermove', { clientX: 40, clientY: 70 }); pointer('pointerup');
  expect(editor.state.panX).toBe(30); expect(editor.state.panY).toBe(50); expect(element.releasePointerCapture).toHaveBeenCalledOnce();
  pointer('pointermove', { clientX: 100 }); expect(editor.state.panX).toBe(30);
});
it('normalizes wheel panning and delegates anchored zoom to the actual editor', () => {
  element.dispatchEvent(new WheelEvent('wheel', { deltaX: 2, deltaY: 3, deltaMode: 1, cancelable: true })); expect(editor.state.panX).toBe(-32); expect(editor.state.panY).toBe(-48);
  const previous = editor.state.zoom; element.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, clientX: 20, clientY: 30, cancelable: true })); expect(editor.state.zoom).toBeGreaterThan(previous); expect(editor.undo.canUndo).toBe(false);
});
it('preserves IME and form events and cancels gestures when access changes', () => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', isComposing: true, bubbles: true })); expect(editor.state.panX).toBe(0);
  const input = document.createElement('input'); element.append(input); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); expect(editor.state.panX).toBe(0);
  pointer('pointerdown', { button: 1 }); enabled = false; pointer('pointermove', { clientX: 500 }); expect(editor.state.panX).toBe(0); expect(element.releasePointerCapture).toHaveBeenCalledOnce();
  enabled = true; pointer('pointermove', { clientX: 800 }); expect(editor.state.panX).toBe(0);
});
it('keeps keyboard navigation separate from destructive authoring keys and releases listeners', () => {
  const selected = editor.graph.createNode('RECTANGLE', editor.state.currentPageId); editor.select([selected.id]);
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); expect(editor.graph.getNode(selected.id)).toBeDefined();
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); expect(editor.state.panY).toBe(-40);
  dispose(); element.dispatchEvent(new WheelEvent('wheel', { deltaY: 99 })); expect(editor.state.panY).toBe(-40);
});

import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesignView, type DesignDragJob, type DesignNode, type DesignProps } from './reactExportRuntime';
let host: HTMLDivElement, root: Root;
const node: DesignNode = { id: 'drag', name: 'Drag', visible: true, style: { width: 100, height: 100 }, children: [], interactions: [{ id: 'drag', trigger: { type: 'drag' }, navigation: { action: 'back', transition: 'smart', duration: 300 } }] };
const render = (props: DesignProps = {}) => act(() => root.render(<DesignView nodes={[node]} width={320} height={480} {...props} />));
const element = () => host.querySelector<HTMLElement>('[data-name=Drag]')!;
function pointer(target: EventTarget, type: string, x = 50, y = 50, id = 1, time = 0, pointerType = 'mouse', button = 0) { return act(() => { const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button }); Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: pointerType }, timeStamp: { value: time } }); target.dispatchEvent(event); }); }
function lease() { let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; }), cancel = vi.fn(finish), update = vi.fn(), release = vi.fn(); return { job: Object.assign(cancel, { finished, update, release }) as DesignDragJob, cancel, update, release, finish }; }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(['mouse', 'touch', 'pen'])('tracks only the primary %s pointer after movement and ignores jitter and other pointers', async type => {
  const held = lease(), start = vi.fn(() => held.job); render({ onDrag: start }); expect(element().style.touchAction).toBe('none'); pointer(element(), 'pointerdown', 50, 50, 1, 0, type); pointer(document, 'pointermove', 52, 51, 1, 10, type); expect(start).not.toHaveBeenCalled(); pointer(document, 'pointermove', 100, 50, 2, 20, type); expect(start).not.toHaveBeenCalled();
  pointer(document, 'pointermove', 70, 60, 1, 20, type); expect(start).toHaveBeenCalledOnce(); expect(start.mock.calls[0]).toEqual([node.interactions![0]!.navigation, 'drag', { x: 0, y: 0 }]); expect(held.update).toHaveBeenLastCalledWith({ offset: { x: 20, y: 10 }, velocity: { x: 1800, y: 900 } }); pointer(document, 'pointerup', 80, 60, 2, 40, type); expect(held.release).not.toHaveBeenCalled(); pointer(document, 'pointerup', 80, 60, 1, 40, type); expect(held.release).toHaveBeenCalledWith({ offset: { x: 30, y: 10 }, velocity: { x: 500, y: 0 } }); await act(async () => held.finish());
});
it('keeps a gesture alive when its host synchronously replaces the source view', async () => {
  const held = lease(); render({ onDrag: () => { flushSync(() => root.render(<div>Destination</div>)); return held.job; } }); pointer(element(), 'pointerdown'); pointer(document, 'pointermove', 70, 50, 1, 20); expect(host.textContent).toBe('Destination'); pointer(document, 'pointermove', 100, 50, 1, 40); expect(held.update).toHaveBeenLastCalledWith({ offset: { x: 50, y: 0 }, velocity: { x: 1500, y: 0 } }); pointer(document, 'pointerup', 100, 50, 1, 140); expect(held.release).toHaveBeenCalledWith({ offset: { x: 50, y: 0 }, velocity: { x: 0, y: 0 } }); await act(async () => held.finish());
});
it.each(['cancel', 'blur', 'resize', 'hidden', 'escape'])('cancels an active drag and disposes global monitors on %s', async mode => {
  const held = lease(); render({ onDrag: () => held.job }); pointer(element(), 'pointerdown'); pointer(document, 'pointermove', 70, 50, 1, 20);
  if (mode === 'cancel') pointer(document, 'pointercancel', 70, 50); if (mode === 'blur' || mode === 'resize') act(() => window.dispatchEvent(new Event(mode))); if (mode === 'hidden') { vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); act(() => document.dispatchEvent(new Event('visibilitychange'))); } if (mode === 'escape') act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await act(async () => {}); expect(held.cancel).toHaveBeenCalledOnce(); pointer(document, 'pointermove', 90, 50); pointer(document, 'pointerup', 90, 50); expect(held.update).toHaveBeenCalledOnce(); expect(held.release).not.toHaveBeenCalled();
});
it('allows a tap, suppresses the generated drag click and cancels pending tracking on source unmount', async () => {
  const held = lease(), start = vi.fn(() => held.job), click = vi.fn(); render({ onDrag: start }); element().addEventListener('click', click); pointer(element(), 'pointerdown'); pointer(document, 'pointerup'); act(() => element().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 50, clientY: 50 }))); expect(click).toHaveBeenCalledOnce(); expect(start).not.toHaveBeenCalled();
  pointer(element(), 'pointerdown'); pointer(document, 'pointermove', 70, 50, 1, 20); pointer(document, 'pointerup', 70, 50, 1, 40); act(() => element().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 70, clientY: 50 }))); expect(click).toHaveBeenCalledOnce(); await act(async () => held.finish());
  render({ onDrag: start }); pointer(element(), 'pointerdown'); act(() => root.render(null)); pointer(document, 'pointermove', 100, 50); expect(start).toHaveBeenCalledOnce();
});
it('reports a missing drag host and leaves ordinary controls and secondary buttons untouched', () => {
  const error = vi.fn(), navigate = vi.fn(); render({ onNavigate: navigate, onPrototypeError: error }); pointer(element(), 'pointerdown', 50, 50, 1, 0, 'mouse', 2); pointer(document, 'pointermove', 70, 50); expect(error).not.toHaveBeenCalled(); const input = document.createElement('input'); element().append(input); pointer(input, 'pointerdown'); pointer(document, 'pointermove', 70, 50); expect(error).not.toHaveBeenCalled(); pointer(element(), 'pointerdown'); pointer(document, 'pointermove', 70, 50); expect(error).toHaveBeenCalledWith(expect.stringContaining('drag presentation host')); expect(navigate).not.toHaveBeenCalled();
});

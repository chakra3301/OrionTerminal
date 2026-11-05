import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesignView, type DesignNavigation, type DesignNode, type DesignProps } from './reactExportRuntime';
let host: HTMLDivElement, root: Root;
const action = (action: DesignNavigation['action'], target?: string): DesignNavigation => ({ action, ...(target ? { target } : {}), transition: 'instant', duration: 0 });
const sequence = (...actions: DesignNavigation[]): DesignNavigation => ({ action: 'sequence', transition: 'instant', duration: 0, actions });
const layer = (id: string, children: DesignNode[] = []): DesignNode => ({ id, name: id, visible: true, children, style: { position: 'absolute', width: 100, height: 100 } });
const trigger = (navigation = sequence(action('navigate', 'details'), action('overlay', 'modal'))): DesignNode => ({ ...layer('trigger'), text: 'Run', navigation });
const render = (nodes: DesignNode[], props: DesignProps = {}) => act(() => root.render(<DesignView nodes={nodes} width={320} height={480} {...props} />));
const element = (id: string) => host.querySelector<HTMLElement>(`[data-xdesign-layer="${id}"]`)!;
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('matchMedia', () => ({ matches: false })); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('waits for asynchronous hosts and keeps the trigger and scaled origin for every ordered step', async () => {
  const first = deferred<boolean>(), nodes = [trigger()], navigate = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(true);
  render(nodes, { onNavigate: navigate }); const view = host.querySelector<HTMLElement>('[data-xdesign-view]')!;
  vi.spyOn(view, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 200, width: 160 } as DOMRect); vi.spyOn(element('trigger'), 'getBoundingClientRect').mockReturnValue({ left: 115, top: 220 } as DOMRect);
  await act(async () => element('trigger').click()); expect(navigate).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve(true)); expect(navigate.mock.calls.map(call => call[0].action)).toEqual(['navigate', 'overlay']); expect(navigate.mock.calls.every(call => call[1] === 'trigger' && call[2].type === 'click' && call[3].x === 30 && call[3].y === 40)).toBe(true);
});
it.each(['false', 'rejection'] as const)('stops after host %s and reports errors without executing the remainder', async mode => {
  const first = deferred<boolean>(), navigate = vi.fn(() => first.promise), error = vi.fn(); render([trigger()], { onNavigate: navigate, onPrototypeError: error }); await act(async () => element('trigger').click());
  await act(async () => mode === 'false' ? first.resolve(false) : first.reject(new Error('Destination failed'))); expect(navigate).toHaveBeenCalledOnce(); if (mode === 'rejection') expect(error).toHaveBeenCalledWith('Error: Destination failed'); else expect(error).not.toHaveBeenCalled();
});
it.each(['wheel', 'pointer', 'pointercancel', 'touch', 'key', 'hidden', 'disabled', 'revision', 'replace', 'unmount'] as const)('cancels a pending host sequence on %s', async mode => {
  const first = deferred<boolean>(), navigate = vi.fn(() => first.promise), cancel = vi.fn(), nodes = [trigger()], props = { onNavigate: navigate, onSequenceCancel: cancel };
  render(nodes, props); await act(async () => element('trigger').click()); const view = host.querySelector('[data-xdesign-view]')!;
  if (mode === 'wheel') act(() => view.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
  if (mode === 'pointer') act(() => view.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  if (mode === 'pointercancel') act(() => view.dispatchEvent(new Event('pointercancel', { bubbles: true })));
  if (mode === 'touch') act(() => view.dispatchEvent(new Event('touchstart', { bubbles: true })));
  if (mode === 'key') act(() => view.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })));
  if (mode === 'hidden') { vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); act(() => document.dispatchEvent(new Event('visibilitychange'))); }
  if (mode === 'disabled') render(nodes, { ...props, disabled: true });
  if (mode === 'revision') render(nodes, { ...props, scrollRevision: 2 });
  if (mode === 'replace') render([trigger()], props);
  if (mode === 'unmount') act(() => root.render(null));
  await act(async () => first.resolve(true)); expect(navigate).toHaveBeenCalledOnce();
});
it('runs local scroll steps without a host and waits for the first animation before aligning the next', async () => {
  const t = trigger(sequence({ ...action('scroll', 'first-source'), transition: 'scroll', duration: 200, easing: 'linear' }, action('scroll', 'second'))), first = layer('first'), second = layer('second'); first.sourceId = 'first-source'; const frame = layer('frame', [t, first, second]); frame.scroll = { axis: 'vertical' };
  render([frame]); const viewport = host.querySelector<HTMLElement>('[data-xdesign-scroll]')!; Object.defineProperties(viewport, { clientHeight: { value: 100 }, scrollHeight: { value: 1000 } });
  const alignFirst = vi.fn(() => { viewport.scrollTop = 200; }), alignSecond = vi.fn(() => { viewport.scrollTop = 400; }); Object.assign(element('first'), { scrollIntoView: alignFirst }); Object.assign(element('second'), { scrollIntoView: alignSecond });
  let callback!: FrameRequestCallback; vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { callback = next; return 1; }); vi.stubGlobal('cancelAnimationFrame', vi.fn()); vi.spyOn(performance, 'now').mockReturnValue(0);
  await act(async () => element('trigger').click()); expect(alignFirst).toHaveBeenCalledOnce(); expect(alignSecond).not.toHaveBeenCalled(); expect(viewport.scrollTop).toBe(0);
  await act(async () => callback(100)); expect(viewport.scrollTop).toBe(100); expect(alignSecond).not.toHaveBeenCalled();
  await act(async () => callback(200)); expect(alignSecond).toHaveBeenCalledOnce(); expect(viewport.scrollTop).toBe(400);
});
it('leaves later scroll actions untouched when an earlier destination is missing, and exposes the failure', async () => {
  const t = trigger(sequence(action('scroll', 'missing'), action('scroll', 'second'))), frame = layer('frame', [t, layer('second')]); frame.scroll = { axis: 'vertical' }; render([frame]);
  const align = vi.fn(); Object.assign(element('second'), { scrollIntoView: align }); await act(async () => element('trigger').click()); expect(align).not.toHaveBeenCalled(); expect(host.querySelector('[role=alert]')?.textContent).toContain('hidden');
});
it('suppresses automatic reactions during an active sequence without replaying a spent timer', async () => {
  vi.useFakeTimers(); const first = deferred<boolean>(), t = trigger(); t.interactions = [{ id: 'click', trigger: { type: 'click' }, navigation: t.navigation! }, { id: 'delay', trigger: { type: 'delay', delay: 100 }, navigation: action('back') }]; const nodes = [t], navigate = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(true);
  render(nodes, { onNavigate: navigate }); await act(async () => element('trigger').click()); await act(async () => vi.advanceTimersByTime(200)); expect(navigate).toHaveBeenCalledOnce(); await act(async () => first.resolve(true)); expect(navigate).toHaveBeenCalledTimes(2); await act(async () => vi.advanceTimersByTime(1000)); expect(navigate).toHaveBeenCalledTimes(2);
});
it('delegates whole-page sequences once and reports asynchronous single-action host failures', async () => {
  const onSequence = vi.fn(), navigate = vi.fn(() => Promise.reject(new Error('Host unavailable'))), error = vi.fn(); render([trigger()], { onSequence, onNavigate: navigate, onPrototypeError: error }); await act(async () => element('trigger').click()); expect(onSequence).toHaveBeenCalledOnce(); expect(navigate).not.toHaveBeenCalled();
  render([trigger(action('back'))], { onNavigate: navigate, onPrototypeError: error }); await act(async () => element('trigger').click()); expect(error).toHaveBeenCalledWith('Error: Host unavailable');
});

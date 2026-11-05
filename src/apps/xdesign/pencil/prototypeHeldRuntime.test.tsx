import { flushSync } from 'react-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesignView, type DesignNavigation, type DesignNode, type DesignProps, type DesignReversibleJob, type DesignTrigger } from './reactExportRuntime';
let host: HTMLDivElement, root: Root;
const back: DesignNavigation = { action: 'back', transition: 'instant', duration: 0 };
const node = (trigger: DesignTrigger, navigation = back): DesignNode => ({ id: 'hotspot', name: 'hotspot', visible: true, style: { width: 100, height: 100 }, children: [], interactions: [{ id: 'action', trigger, navigation }] });
const render = (nodes: DesignNode[], props: DesignProps = {}) => act(() => root.render(<DesignView nodes={nodes} width={320} height={480} {...props} />));
const element = () => host.querySelector<HTMLElement>('[data-name=hotspot]')!;
const media = () => host.querySelector<HTMLVideoElement>('video')!;
function pointer(target: EventTarget, type: string, init: { pointerId?: number; pointerType?: string; button?: number; clientX?: number; clientY?: number } = {}) {
  return act(() => { const event = new MouseEvent(type, { bubbles: true, button: init.button ?? 0, clientX: init.clientX ?? 50, clientY: init.clientY ?? 50 }); Object.defineProperties(event, { pointerId: { value: init.pointerId ?? 1 }, pointerType: { value: init.pointerType ?? 'mouse' } }); target.dispatchEvent(event); });
}
function lease() { let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; }); const close = vi.fn(finish); return { job: Object.assign(close, { finished }) as DesignReversibleJob, close, finish }; }
function bounds() { vi.spyOn(element(), 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 110, bottom: 110, width: 100, height: 100 } as DOMRect); }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('matchMedia', () => ({ matches: true })); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('restores hover after the source is replaced, filtering touch and other pointers', async () => {
  const held = lease(), reversible = vi.fn(() => held.job); render([node({ type: 'hover' })], { onReversible: reversible }); bounds();
  pointer(element(), 'pointerover', { pointerType: 'touch' }); expect(reversible).not.toHaveBeenCalled();
  pointer(element(), 'pointerover', { pointerId: 8 }); expect(reversible).toHaveBeenCalledWith(back, 'hotspot', { type: 'hover' }, { x: 10, y: 10 });
  render([], { onReversible: reversible }); pointer(document, 'pointermove', { pointerId: 9, clientX: 500 }); expect(held.close).not.toHaveBeenCalled();
  await pointer(document, 'pointermove', { pointerId: 8, clientX: 500 }); expect(held.close).toHaveBeenCalledOnce(); pointer(document, 'pointermove', { pointerId: 8, clientX: 500 }); expect(held.close).toHaveBeenCalledOnce();
});
it.each(['release', 'cancel', 'leave', 'blur', 'resize', 'hidden'] as const)('releases a press on %s even after the original view unmounts', async mode => {
  const held = lease(); render([node({ type: 'press' })], { onReversible: () => held.job }); bounds(); pointer(element(), 'pointerdown', { pointerId: 4, pointerType: 'touch' }); render([]);
  pointer(document, 'pointerup', { pointerId: 5 }); expect(held.close).not.toHaveBeenCalled();
  if (mode === 'release' || mode === 'cancel') await pointer(document, mode === 'release' ? 'pointerup' : 'pointercancel', { pointerId: 4 });
  if (mode === 'leave') await pointer(document, 'pointermove', { pointerId: 4, clientX: 200 });
  if (mode === 'blur' || mode === 'resize') await act(async () => window.dispatchEvent(new Event(mode)));
  if (mode === 'hidden') { vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); await act(async () => document.dispatchEvent(new Event('visibilitychange'))); }
  expect(held.close).toHaveBeenCalledOnce();
});
it('removes global monitors when the host discards a temporary interaction', async () => {
  const held = lease(); render([node({ type: 'press' })], { onReversible: () => held.job }); bounds(); pointer(element(), 'pointerdown');
  await act(async () => held.finish()); pointer(document, 'pointerup'); pointer(document, 'pointermove', { clientX: 500 }); expect(held.close).not.toHaveBeenCalled();
});
it('cancels delayed presses on outside release and allows a later full press', async () => {
  vi.useFakeTimers(); const held = lease(), reversible = vi.fn(() => held.job); render([node({ type: 'press', delay: 100 })], { onReversible: reversible }); bounds();
  pointer(element(), 'pointerdown'); await act(async () => vi.advanceTimersByTime(50)); pointer(document, 'pointerup'); await act(async () => vi.advanceTimersByTime(100)); expect(reversible).not.toHaveBeenCalled();
  pointer(element(), 'pointerdown'); await act(async () => vi.advanceTimersByTime(100)); expect(reversible).toHaveBeenCalledOnce(); await pointer(document, 'pointerup'); expect(held.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('plays one-way down and up independently on mouse and touch without hover gating', () => {
  const next = node({ type: 'pointer-down' }); next.interactions!.push({ id: 'up', trigger: { type: 'pointer-up' }, navigation: back }); const navigate = vi.fn(); render([next], { onNavigate: navigate });
  pointer(element(), 'pointerdown', { button: 2 }); expect(navigate).not.toHaveBeenCalled();
  for (const pointerType of ['mouse', 'touch']) { pointer(element(), 'pointerdown', { pointerType }); pointer(element(), 'pointerup', { pointerType }); }
  expect(navigate.mock.calls.map(call => call[2].type)).toEqual(['pointer-down', 'pointer-up', 'pointer-down', 'pointer-up']);
  const input = document.createElement('input'); element().append(input); pointer(input, 'pointerdown'); pointer(input, 'pointerup'); expect(navigate).toHaveBeenCalledTimes(4);
});
it('requires a reversible host for screen navigation rather than issuing a permanent hover', () => {
  const error = vi.fn(), navigate = vi.fn(); render([node({ type: 'hover' })], { onNavigate: navigate, onPrototypeError: error }); pointer(element(), 'pointerover'); expect(navigate).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledWith(expect.stringContaining('reversible presentation host'));
});
it.each(['release', 'same-source', 'same-key', 'other-source', 'other-variable', 'wheel', 'disabled', 'revision'] as const)('handles local temporary scrolling on %s without undoing unrelated state', async mode => {
  const scroll: DesignNavigation = { action: 'scroll', target: 'destination', transition: 'instant', duration: 0 }, t = node({ type: 'press' }, scroll), destination: DesignNode = { id: 'destination', name: 'destination', visible: true, style: {}, children: [] }, other: DesignNode = { ...node({ type: 'click' }, scroll), id: 'other', name: 'other' }, frame: DesignNode = { id: 'frame', name: 'frame', visible: true, style: { width: 100, height: 100 }, scroll: { axis: 'vertical' }, children: [t, destination, other] };
  const secondScroll = { ...scroll, target: 'second' }; t.interactions!.push({ id: 'same', trigger: { type: 'click' }, navigation: secondScroll }); frame.children.push({ id: 'second', name: 'second', visible: true, style: {}, children: [] });
  if (mode === 'other-source') other.interactions![0]!.navigation = secondScroll;
  if (mode === 'other-variable') other.interactions![0]!.navigation = { action: 'set-variable', variable: 'count', value: { type: 'literal', value: 1 }, transition: 'instant', duration: 0 };
  if (mode === 'same-key') t.interactions!.push({ id: 'key', trigger: { type: 'key', keyCodes: [13] }, navigation: { action: 'set-variable', variable: 'count', value: { type: 'literal', value: 1 }, transition: 'instant', duration: 0 } });
  const variables: DesignProps['prototypeVariables'] = ['other-variable', 'same-key'].includes(mode) ? { variables: [{ id: 'count', name: 'Count', type: 'FLOAT', collectionId: 'collection', valuesByMode: { mode: 20 } }], collections: [{ id: 'collection', name: 'Collection', defaultModeId: 'mode', modes: [{ modeId: 'mode', name: 'Default' }] }], modes: { collection: 'mode' } } : undefined;
  if (mode === 'other-variable') { other.style.width = 20; other.bindings = { style: { width: 'count' }, modes: {} }; }
  if (mode === 'same-key') { t.style.width = 20; t.bindings = { style: { width: 'count' }, modes: {} }; }
  render([frame], variables ? { prototypeVariables: variables } : {}); bounds(); const viewport = host.querySelector<HTMLElement>('[data-xdesign-scroll]')!; Object.defineProperties(viewport, { clientHeight: { value: 100 }, scrollHeight: { value: 1000 } }); viewport.scrollTop = 40; Object.assign(host.querySelector('[data-name=destination]')!, { scrollIntoView: () => { viewport.scrollTop = 200; } });
  Object.assign(host.querySelector('[data-name=second]')!, { scrollIntoView: () => { viewport.scrollTop = 300; } });
  await pointer(element(), 'pointerdown'); expect(viewport.scrollTop).toBe(200);
  if (mode === 'same-source') await act(async () => element().click());
  if (mode === 'same-key') await act(async () => host.querySelector('[data-xdesign-view]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })));
  if (mode === 'other-source') { await act(async () => host.querySelector<HTMLElement>('[data-name=other]')!.click()); expect(viewport.scrollTop).toBe(300); }
  if (mode === 'other-variable') { await act(async () => host.querySelector<HTMLElement>('[data-name=other]')!.click()); expect(host.querySelector<HTMLElement>('[data-name=other]')!.style.width).toBe('1px'); expect(viewport.scrollTop).toBe(200); }
  if (mode === 'same-key') { expect(host.querySelector<HTMLElement>('[data-name=hotspot]')!.style.width).toBe('1px'); expect(viewport.scrollTop).toBe(200); }
  if (mode === 'wheel') { act(() => viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true }))); viewport.scrollTop = 300; }
  if (mode === 'disabled') render([frame], { disabled: true });
  if (mode === 'revision') { render([frame], { scrollRevision: 2 }); expect(viewport.scrollTop).toBe(0); viewport.scrollTop = 250; }
  await pointer(document, 'pointerup'); expect(viewport.scrollTop).toBe(mode === 'release' ? 40 : mode === 'same-source' || mode === 'other-source' || mode === 'wheel' ? 300 : mode === 'revision' ? 250 : 200);
  if (mode === 'other-variable') expect(host.querySelector<HTMLElement>('[data-name=other]')!.style.width).toBe('1px');
  if (mode === 'same-key') expect(host.querySelector<HTMLElement>('[data-name=hotspot]')!.style.width).toBe('1px');
});

it.each(['delay', 'media-hit', 'media-end'] as const)('keeps a same-source automatic %s scroll inside a local press/hover lease', async kind => {
  vi.useFakeTimers();
  const first: DesignNavigation = { action: 'scroll', target: 'first-destination', transition: 'instant', duration: 0 }, second: DesignNavigation = { action: 'scroll', target: 'second-destination', transition: 'instant', duration: 0 };
  const held = node({ type: kind === 'delay' ? 'press' : 'hover' }, first);
  if (kind !== 'delay') { vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {}); held.video = { src: 'data:video/webm;base64,AQID', poster: '', autoplay: false, loop: false, muted: true, controls: true, style: { width: 40, height: 40 } }; }
  const trigger: DesignTrigger = kind === 'delay' ? { type: 'delay', delay: 100 } : kind === 'media-hit' ? { type: 'media-hit', time: 1 } : { type: 'media-end' };
  held.interactions!.push({ id: 'automatic', trigger, navigation: second });
  const destination = (id: string): DesignNode => ({ id, name: id, visible: true, style: {}, children: [] });
  const frame: DesignNode = { id: 'frame', name: 'frame', visible: true, style: { width: 100, height: 100 }, scroll: { axis: 'vertical' }, children: [held, destination('first-destination'), destination('second-destination')] };
  render([frame]); bounds(); const viewport = host.querySelector<HTMLElement>('[data-xdesign-scroll]')!; Object.defineProperties(viewport, { clientHeight: { value: 100 }, scrollHeight: { value: 1000 } }); viewport.scrollTop = 40;
  Object.assign(host.querySelector('[data-name=first-destination]')!, { scrollIntoView: () => { viewport.scrollTop = 200; } }); Object.assign(host.querySelector('[data-name=second-destination]')!, { scrollIntoView: () => { viewport.scrollTop = 300; } });
  if (kind === 'delay') await pointer(element(), 'pointerdown'); else await pointer(element(), 'pointerover'); await act(async () => { await Promise.resolve(); await Promise.resolve(); }); expect(viewport.scrollTop).toBe(200);
  if (kind === 'delay') await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  else { Object.defineProperties(media(), { currentTime: { configurable: true, value: kind === 'media-end' ? 3 : 1.1 }, duration: { configurable: true, value: 3 } }); await act(async () => media().dispatchEvent(new Event(kind === 'media-end' ? 'ended' : 'timeupdate'))); await act(async () => { await vi.advanceTimersByTimeAsync(32); }); }
  expect(viewport.scrollTop).toBe(300);
  if (kind === 'delay') await pointer(document, 'pointerup'); else await pointer(document, 'pointermove', { clientX: 500 });
  expect(viewport.scrollTop).toBe(40);
});

it('restores exported local variable and mode session after automatic same-source actions release', async () => {
  vi.useFakeTimers();
  const variables: DesignProps['prototypeVariables'] = { variables: [{ id: 'width', name: 'Width', type: 'FLOAT', collectionId: 'theme', valuesByMode: { light: 320, dark: 400 } }], collections: [{ id: 'theme', name: 'Theme', defaultModeId: 'light', modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }] }], modes: { theme: 'light' } };
  const held = node({ type: 'hover' }, { action: 'sequence', transition: 'instant', duration: 0, actions: [ { action: 'set-mode', collection: 'theme', mode: 'dark', transition: 'instant', duration: 0 }, { action: 'set-variable', variable: 'width', value: { type: 'literal', value: 360 }, transition: 'instant', duration: 0 } ] });
  held.bindings = { style: { width: 'width' }, modes: {} };
  held.interactions!.push({ id: 'automatic', trigger: { type: 'delay', delay: 100 }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'set-variable', variable: 'width', value: { type: 'literal', value: 420 }, transition: 'instant', duration: 0 }] } });
  render([held], { prototypeVariables: variables }); expect(element().style.width).toBe('320px');
  await pointer(element(), 'pointerover'); await act(async () => { await Promise.resolve(); await Promise.resolve(); }); expect(element().style.width).toBe('360px');
  await act(async () => { await vi.advanceTimersByTimeAsync(100); }); expect(element().style.width).toBe('420px');
  await pointer(document, 'pointermove', { clientX: 500 }); expect(element().style.width).toBe('320px');
});

it.each(['blur', 'resize'] as const)('cancels an unactivated delayed hover on window %s', async type => {
  vi.useFakeTimers(); const held = lease(), reversible = vi.fn(() => held.job); render([node({ type: 'hover', delay: 100 })], { onReversible: reversible }); pointer(element(), 'pointerover'); act(() => window.dispatchEvent(new Event(type))); await act(async () => vi.advanceTimersByTime(200)); expect(reversible).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('captures the hotspot before a host synchronously replaces the source view', async () => {
  const held = lease(), reversible = vi.fn(() => { flushSync(() => root.render(null)); return held.job; }); render([node({ type: 'press' })], { onReversible: reversible }); bounds(); await pointer(element(), 'pointerdown'); expect(host.childElementCount).toBe(0); await pointer(document, 'pointerup'); expect(held.close).toHaveBeenCalledOnce();
});

it('cleans up a rejected host completion promise and reports it without a stale release', async () => {
  let reject!: (error: Error) => void; const finished = new Promise<void>((_, no) => { reject = no; }), release = vi.fn(), error = vi.fn(); render([node({ type: 'press' })], { onReversible: () => Object.assign(release, { finished }), onPrototypeError: error }); bounds(); await pointer(element(), 'pointerdown'); await act(async () => reject(new Error('Host closed unsuccessfully'))); expect(error).toHaveBeenCalledWith('Error: Host closed unsuccessfully'); pointer(document, 'pointerup'); expect(release).not.toHaveBeenCalled();
});

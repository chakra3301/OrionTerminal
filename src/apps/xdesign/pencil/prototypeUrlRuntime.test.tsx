import * as React from 'react';
import { act } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot, type Root } from 'react-dom/client';
import { transform } from 'sucrase';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { selectionToReact } from './reactExport';
import { serializeGraph } from './document';
import { setNavigation, setPrototypeInteractions, type DesignNavigation } from './prototype';
import { setPrototypeScroll } from './prototypeScroll';
import { placePreparedVideo } from './videoPaints';
import type { DesignProps, DesignTrigger } from './reactExportRuntime';

let host: HTMLDivElement, root: Root;
const address = 'https://example.com/docs?q=a%20b&next=%2Fhelp#part';
const url = (newTab?: boolean, value = address): DesignNavigation => ({ action: 'open-url', url: value, ...(newTab === undefined ? {} : { newTab }), transition: 'instant', duration: 0 });
const sequence = (...actions: DesignNavigation[]): DesignNavigation => ({ action: 'sequence', actions, transition: 'instant', duration: 0 });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('(hover: hover)') }));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function generated(navigation: DesignNavigation | ((scrollTarget: string) => DesignNavigation), trigger?: DesignTrigger, independentScroll = false) {
  const editor = createEditor(), graph = editor.graph, page = editor.state.currentPageId;
  const screen = graph.createNode('FRAME', page, { name: 'Portable URL source', width: 320, height: 240, fills: [] });
  const button = graph.createNode('TEXT', screen.id, { name: 'Open documentation', text: 'Open documentation', width: 160, height: 24 });
  const scroll = graph.createNode('FRAME', screen.id, { name: 'Retained scroll', x: 0, y: 40, width: 100, height: 70, fills: [] });
  const target = graph.createNode('RECTANGLE', scroll.id, { name: 'Tall content', width: 20, height: 500, fills: [] });
  setPrototypeScroll(editor, scroll, { axis: 'both', initial: { x: 7, y: 19 } });
  const another = graph.createNode('TEXT', screen.id, { name: 'Open another link', text: 'Another link', x: 170, width: 140, height: 24 });
  setNavigation(editor, another, url(true, 'https://example.com/new-intent'));
  if (independentScroll) {
    const advance = graph.createNode('TEXT', screen.id, { name: 'Independent scroll', text: 'Scroll', y: 120, width: 100, height: 24 });
    setNavigation(editor, advance, { action: 'scroll', target: target.id, transition: 'scroll', duration: 200, easing: 'linear' });
  }
  const video = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Retained URL video', width: 80, height: 45, duration: 3 }, 140, 60);
  graph.reparentNode(video, screen.id);
  const action = typeof navigation === 'function' ? navigation(target.id) : navigation;
  if (trigger) setPrototypeInteractions(editor, button, [{ id: 'portable-url-trigger', trigger, navigation: action }]);
  else setNavigation(editor, button, action);
  const before = serializeGraph(graph), undo = editor.undo.canUndo, redo = editor.undo.canRedo;
  const delivered: { default?: React.ComponentType<DesignProps>; openDesignUrl?: typeof import('./reactExportRuntime').openDesignUrl } = {};
  const exported = selectionToReact(graph, [screen.id]);
  const code = transform(exported.code, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'automatic', production: true }).code;
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'react') return React;
    if (id === 'react/jsx-runtime') return jsxRuntime;
    throw new Error(`Unexpected generated URL import ${id}`);
  }, delivered);
  expect(delivered.default).toBeTypeOf('function');
  const mount = (props: DesignProps = {}) => act(() => root.render(React.createElement(delivered.default!, props)));
  const element = () => host.querySelector<HTMLElement>('[data-name="Open documentation"]')!;
  const unchanged = () => { expect(serializeGraph(graph)).toBe(before); expect(editor.undo.canUndo).toBe(undo); expect(editor.undo.canRedo).toBe(redo); };
  return { editor, mount, element, unchanged, openDesignUrl: delivered.openDesignUrl! };
}

function retained() {
  const view = host.querySelector<HTMLElement>('[data-xdesign-view]')!, scroll = host.querySelector<HTMLElement>('[data-xdesign-scroll]')!, video = host.querySelector<HTMLVideoElement>('video')!;
  scroll.scrollLeft = 23; scroll.scrollTop = 67;
  Object.defineProperties(video, { currentTime: { configurable: true, value: 1.5 }, paused: { configurable: true, value: false } });
  const identity = [video.getAttribute('src'), video.getAttribute('poster')];
  return () => {
    expect(host.querySelector('[data-xdesign-view]')).toBe(view);
    expect(host.querySelector('[data-xdesign-scroll]')).toBe(scroll);
    expect([scroll.scrollLeft, scroll.scrollTop]).toEqual([23, 67]);
    expect(host.querySelector('video')).toBe(video);
    expect([video.currentTime, video.paused]).toEqual([1.5, false]);
    expect([video.getAttribute('src'), video.getAttribute('poster')]).toEqual(identity);
  };
}

it.each([undefined, false, true])('actual emitted module opens newTab=%s once for each click and Enter without a navigation host or presentation mutation', async flag => {
  const fixture = generated(url(flag)), open = vi.fn();
  try {
    fixture.mount({ onOpenUrl: open }); const assertRetained = retained();
    expect(fixture.element().getAttribute('role')).toBe('link');
    await act(async () => fixture.element().click());
    expect(open.mock.calls).toEqual([[address, flag ?? true]]); assertRetained();
    fixture.element().focus(); await act(async () => fixture.element().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(open.mock.calls).toEqual([[address, flag ?? true], [address, flag ?? true]]);
    assertRetained(); fixture.unchanged();
  } finally { fixture.editor.dispose(); }
});

it.each(['https://user:password@example.com/a?x=1#fragment', 'http://localhost:8080/help', 'mailto:designer@example.com?subject=Review%20prototype', 'tel:+15551234567'])('preserves the accepted original URL %s in the emitted callback', async value => {
  const fixture = generated(url(false, value)), open = vi.fn();
  try { fixture.mount({ onOpenUrl: open }); await act(async () => fixture.element().click()); expect(open.mock.calls).toEqual([[value, false]]); fixture.unchanged(); }
  finally { fixture.editor.dispose(); }
});

it('awaits URL completion before the next URL in an actual emitted sequence', async () => {
  const first = deferred<boolean>(), fixture = generated(sequence(url(false, 'https://example.com/first'), url(true, 'https://example.com/second')));
  const open = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(true);
  try {
    fixture.mount({ onOpenUrl: open }); const assertRetained = retained(); await act(async () => fixture.element().click());
    expect(open.mock.calls).toEqual([['https://example.com/first', false]]); assertRetained();
    await act(async () => first.resolve(true)); expect(open.mock.calls).toEqual([['https://example.com/first', false], ['https://example.com/second', true]]);
    assertRetained(); fixture.unchanged();
  } finally { fixture.editor.dispose(); }
});

it('executes only the selected conditional URL branch in the actual emitted module', async () => {
  const navigation: DesignNavigation = { action: 'conditional', transition: 'instant', duration: 0, branches: [{ condition: { type: 'literal', value: false }, actions: [url(true, 'https://example.com/wrong')] }, { actions: [url(false, 'mailto:review@example.com'), url(undefined, 'https://example.com/after')] }] };
  const fixture = generated(navigation), open = vi.fn();
  try { fixture.mount({ onOpenUrl: open }); const assertRetained = retained(); await act(async () => fixture.element().click()); expect(open.mock.calls).toEqual([['mailto:review@example.com', false], ['https://example.com/after', true]]); assertRetained(); fixture.unchanged(); }
  finally { fixture.editor.dispose(); }
});

it.each(['false', 'throw', 'reject'] as const)('stops a URL sequence on callback %s and leaves mounted presentation state intact', async mode => {
  const fixture = generated(sequence(url(), url(true, 'https://example.com/must-not-open'))), failure = new Error('URL host unavailable');
  const open = vi.fn(() => { if (mode === 'throw') throw failure; return mode === 'reject' ? Promise.reject(failure) : false; }), error = vi.fn();
  try {
    fixture.mount({ onOpenUrl: open, onPrototypeError: error }); const assertRetained = retained(); await act(async () => fixture.element().click());
    expect(open.mock.calls).toEqual([[address, true]]); if (mode === 'false') expect(error).toHaveBeenCalledOnce(); else expect(error).toHaveBeenCalledWith('Error: URL host unavailable');
    assertRetained(); fixture.unchanged();
  } finally { fixture.editor.dispose(); }
});

it.each(['wheel', 'disabled', 'unmount'] as const)('does not continue an emitted pending URL sequence after %s cancellation', async mode => {
  const first = deferred<boolean>(), fixture = generated(sequence(url(), url(true, 'https://example.com/stale'))), open = vi.fn(() => first.promise);
  try {
    const props = { onOpenUrl: open }; fixture.mount(props); await act(async () => fixture.element().click()); expect(open).toHaveBeenCalledOnce();
    if (mode === 'wheel') act(() => host.querySelector('[data-xdesign-view]')!.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
    else if (mode === 'disabled') fixture.mount({ ...props, disabled: true });
    else act(() => root.render(null));
    await act(async () => first.resolve(true)); expect(open).toHaveBeenCalledOnce(); fixture.unchanged();
  } finally { fixture.editor.dispose(); }
});

it.each(['hover', 'press', 'drag'] as const)('delivers an emitted URL %s gesture once without preparing or rolling back media', async type => {
  const fixture = generated(url(), { type }), open = vi.fn();
  const pointer = (target: EventTarget, event: string, x = 20) => { const value = new MouseEvent(event, { bubbles: true, clientX: x, clientY: 10 }); Object.defineProperty(value, 'pointerId', { value: 4 }); target.dispatchEvent(value); };
  try {
    fixture.mount({ onOpenUrl: open }); const assertRetained = retained();
    await act(async () => pointer(fixture.element(), type === 'hover' ? 'pointerover' : 'pointerdown'));
    if (type === 'drag') { expect(open).not.toHaveBeenCalled(); await act(async () => pointer(document, 'pointermove', 40)); }
    expect(open.mock.calls).toEqual([[address, true]]);
    await act(async () => { pointer(document, 'pointermove'); pointer(type === 'hover' ? fixture.element() : document, type === 'hover' ? 'pointerout' : 'pointerup'); });
    expect(open).toHaveBeenCalledOnce(); assertRetained(); fixture.unchanged();
  } finally { fixture.editor.dispose(); }
});

it.each(['resolve', 'reject'] as const)('a newer direct emitted URL supersedes a pending URL sequence before its late %s', async mode => {
  const pending = deferred<boolean>(), fixture = generated(sequence(url(), url(true, 'https://example.com/obsolete-next')));
  const open = vi.fn().mockImplementationOnce(() => pending.promise), error = vi.fn();
  try {
    fixture.mount({ onOpenUrl: open, onPrototypeError: error }); const assertRetained = retained(); await act(async () => fixture.element().click());
    await act(async () => host.querySelector<HTMLElement>('[data-name="Open another link"]')!.click());
    expect(open.mock.calls).toEqual([[address, true], ['https://example.com/new-intent', true]]);
    await act(async () => { if (mode === 'resolve') pending.resolve(true); else pending.reject(new Error('Obsolete URL failure')); }); expect(open).toHaveBeenCalledTimes(2); expect(error).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')).toBeNull(); assertRetained(); fixture.unchanged();
  } finally { fixture.editor.dispose(); }
});

it.each(['refusal', 'leave-pending'] as const)('an emitted mixed held URL prefix %s leaves an independent scroll animation and media running', async mode => {
  const pending = deferred<boolean>(), fixture = generated(target => sequence(url(), { action: 'scroll', target, transition: 'instant', duration: 0 }), { type: 'hover' }, true), open = vi.fn(() => pending.promise);
  let frame!: FrameRequestCallback; const cancelFrame = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => { frame = next; return 1; }); vi.stubGlobal('cancelAnimationFrame', cancelFrame); vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    fixture.mount({ onOpenUrl: open }); const video = host.querySelector<HTMLVideoElement>('video')!, viewport = host.querySelector<HTMLElement>('[data-xdesign-scroll]')!;
    Object.defineProperties(video, { currentTime: { configurable: true, value: 1.5 }, paused: { configurable: true, value: false } });
    Object.defineProperties(viewport, { clientHeight: { configurable: true, value: 70 }, scrollHeight: { configurable: true, value: 500 } });
    viewport.scrollTop = 0; const align = vi.fn(() => { viewport.scrollTop = 400; }); Object.assign(host.querySelector('[data-name="Tall content"]')!, { scrollIntoView: align });
    await act(async () => host.querySelector<HTMLElement>('[data-name="Independent scroll"]')!.click()); expect(align).toHaveBeenCalledOnce();
    await act(async () => frame(100)); expect(viewport.scrollTop).toBe(200); const cancellations = cancelFrame.mock.calls.length;
    await act(async () => fixture.element().dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))); expect(open).toHaveBeenCalledOnce();
    await act(async () => frame(150)); expect(viewport.scrollTop).toBe(300);
    if (mode === 'refusal') await act(async () => pending.resolve(false));
    await act(async () => fixture.element().dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })));
    if (mode === 'leave-pending') await act(async () => pending.resolve(true));
    expect(viewport.scrollTop).toBe(300); expect(align).toHaveBeenCalledOnce(); expect(cancelFrame).toHaveBeenCalledTimes(cancellations);
    await act(async () => frame(200)); expect(viewport.scrollTop).toBe(400); expect(align).toHaveBeenCalledOnce();
    expect(host.querySelector('video')).toBe(video); expect([video.currentTime, video.paused]).toEqual([1.5, false]); fixture.unchanged();
  } finally { fixture.editor.dispose(); }
});

it('uses a synchronous blank window and removes opener before directing the default portable new-tab link', async () => {
  const fixture = generated(url()), calls: string[] = [], replace = vi.fn(() => { expect(remote.opener).toBeNull(); calls.push('replace'); });
  const remote = { opener: {} as unknown, location: { replace }, close: vi.fn() };
  const open = vi.spyOn(window, 'open').mockImplementation((...args) => { expect(args[0]).toBe(''); calls.push('open'); return remote as unknown as Window; });
  try {
    fixture.mount(); act(() => fixture.element().click()); expect(calls).toEqual(['open', 'replace']);
    expect(open).toHaveBeenCalledOnce(); expect(replace).toHaveBeenCalledExactlyOnceWith(address); fixture.unchanged();
  } finally { fixture.editor.dispose(); }
});

it('reports a blocked default portable window without performing any later URL action', async () => {
  const fixture = generated(sequence(url(), url(true, 'https://example.com/no-second'))), open = vi.spyOn(window, 'open').mockReturnValue(null), error = vi.fn();
  try { fixture.mount({ onPrototypeError: error }); const assertRetained = retained(); await act(async () => fixture.element().click()); expect(open).toHaveBeenCalledOnce(); expect(error).toHaveBeenCalledOnce(); assertRetained(); fixture.unchanged(); }
  finally { fixture.editor.dispose(); }
});

it('uses the emitted default current-tab location adapter only for explicit false without opening another window', async () => {
  const fixture = generated(url(false)), original = window, assign = vi.fn(), open = vi.fn();
  try {
    vi.stubGlobal('window', new Proxy(original, { get(target, key) { if (key === 'location') return { assign }; if (key === 'open') return open; return Reflect.get(target, key); } }));
    await expect(fixture.openDesignUrl(url(false))).resolves.toBe(true);
    expect(assign.mock.calls).toEqual([[address]]); expect(open).not.toHaveBeenCalled(); fixture.unchanged();
  } finally { vi.stubGlobal('window', original); fixture.editor.dispose(); }
});

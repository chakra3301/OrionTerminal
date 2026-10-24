import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesignView, designScrollTo, designSpringAt, designSpringDuration, transferDesignScroll, type DesignNavigation, type DesignNode, type DesignProps } from './reactExportRuntime';
let host: HTMLDivElement, root: Root;
const layer = (id: string, children: DesignNode[] = []): DesignNode => ({ id, name: id, visible: true, children, style: { position: 'absolute', width: 100, height: 100 } });
const action: DesignNavigation = { action: 'scroll', target: 'destination', transition: 'instant', duration: 0 };
const render = (nodes: DesignNode[], props: DesignProps = {}) => act(() => root.render(<DesignView nodes={nodes} width={320} height={480} {...props} />));
const element = (id: string) => host.querySelector<HTMLElement>(`[data-xdesign-layer="${id}"]`)!;
const viewport = (id: string) => host.querySelector<HTMLElement>(`[data-xdesign-scroll="${id}"]`)!;
function dimensions(node: HTMLElement, values = { clientWidth: 100, clientHeight: 100, scrollWidth: 800, scrollHeight: 800 }) { Object.entries(values).forEach(([key, value]) => Object.defineProperty(node, key, { configurable: true, value })); }
function scene() { const target = layer('destination'), inner = layer('inner', [target]), outer = layer('outer', [inner]); inner.scroll = { axis: 'both' }; outer.scroll = { axis: 'both' }; render([outer]); const view = host.querySelector<HTMLElement>('[data-xdesign-view]')!; dimensions(viewport('inner')); dimensions(viewport('outer')); return { view, target: element('destination'), inner: viewport('inner'), outer: viewport('outer') }; }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('matchMedia', () => ({ matches: false })); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('resolves nested browser layout and offsets while restoring every surrounding host scroll position', () => {
  const { view, target, inner, outer } = scene(); inner.scrollLeft = 10; inner.scrollTop = 15; outer.scrollLeft = 20; outer.scrollTop = 30; host.scrollTop = 55; document.documentElement.scrollTop = 65;
  const scroll = vi.fn(() => { inner.scrollLeft = 70; inner.scrollTop = 80; outer.scrollLeft = 170; outer.scrollTop = 180; host.scrollTop = 500; document.documentElement.scrollTop = 600; }); Object.assign(target, { scrollIntoView: scroll });
  act(() => designScrollTo(view, { ...action, offset: { x: 4, y: 8 } })());
  expect(scroll).toHaveBeenCalledWith({ behavior: 'instant', block: 'start', inline: 'start' }); expect([inner.scrollLeft, inner.scrollTop, outer.scrollLeft, outer.scrollTop]).toEqual([74, 88, 174, 188]); expect(host.scrollTop).toBe(55); expect(document.documentElement.scrollTop).toBe(65); document.documentElement.scrollTop = 0;
});
it('restores host positions and sticky transforms even when the browser refuses measurement', () => {
  const { view, target, inner } = scene(); target.dataset.xdesignStickyTransform = 'rotate(10deg)'; target.style.transform = 'translateY(30px) rotate(10deg)'; inner.scrollTop = 20; host.scrollTop = 40;
  Object.assign(target, { scrollIntoView: () => { expect(target.style.transform).toBe('rotate(10deg)'); inner.scrollTop = 400; host.scrollTop = 800; throw new Error('Layout unavailable'); } });
  expect(() => designScrollTo(view, action)).toThrow('Layout unavailable'); expect(inner.scrollTop).toBe(20); expect(host.scrollTop).toBe(40); expect(target.style.transform).toBe('translateY(30px) rotate(10deg)');
});
it('clamps axis bounds including RTL, and falls back to scaled geometry when native alignment is unavailable', () => {
  const { view, target, inner, outer } = scene(); outer.dataset.xdesignScrollAxis = 'vertical'; inner.style.direction = 'rtl'; inner.dataset.xdesignScrollAxis = 'horizontal'; inner.scrollTop = 10; outer.scrollLeft = 20;
  Object.assign(target, { scrollIntoView: () => { inner.scrollLeft = -2000; inner.scrollTop = 2000; outer.scrollLeft = 2000; outer.scrollTop = 2000; } }); act(() => designScrollTo(view, action)()); expect([inner.scrollLeft, inner.scrollTop, outer.scrollLeft, outer.scrollTop]).toEqual([-700, 10, 20, 700]);
  inner.style.direction = 'ltr'; inner.dataset.xdesignScrollAxis = 'both'; inner.scrollLeft = inner.scrollTop = 0; outer.scrollTop = 0; Reflect.deleteProperty(target, 'scrollIntoView');
  vi.spyOn(view, 'getBoundingClientRect').mockReturnValue({ width: 160 } as DOMRect); vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue({ left: 20, top: 30 } as DOMRect); vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10 } as DOMRect); vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: 70, top: 80 } as DOMRect);
  act(() => designScrollTo(view, action)()); expect(inner.scrollLeft).toBe(100); expect(inner.scrollTop).toBe(100); expect(outer.scrollTop).toBe(140);
});
it('reports hidden, unresolved and nonscrolling destinations, and leaves fixed targets in place', () => {
  const { view, target, inner } = scene(); target.hidden = true; expect(() => designScrollTo(view, action)).toThrow('hidden'); target.hidden = false; expect(() => designScrollTo(view, { ...action, unresolved: true })).toThrow('outside');
  inner.setAttribute('data-xdesign-fixed', ''); const scroll = vi.fn(); Object.assign(target, { scrollIntoView: scroll }); designScrollTo(view, action)(); expect(scroll).not.toHaveBeenCalled(); inner.removeAttribute('data-xdesign-fixed'); view.querySelectorAll('[data-xdesign-scroll]').forEach(node => node.removeAttribute('data-xdesign-scroll')); expect(() => designScrollTo(view, action)).toThrow('Enable scrolling');
});
it('animates using authored timing, cancels on user input, and honors reduced motion', () => {
  const destination = layer('destination'), trigger = layer('trigger'); trigger.text = 'Scroll'; trigger.navigation = { ...action, transition: 'scroll', duration: 200, easing: 'linear' }; const frame = layer('frame', [trigger, destination]); frame.scroll = { axis: 'vertical' }; render([frame]); dimensions(viewport('frame')); Object.assign(element('destination'), { scrollIntoView: () => { viewport('frame').scrollTop = 200; } });
  const callbacks = new Map<number, FrameRequestCallback>(); let id = 0; vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; }); vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id)); vi.spyOn(performance, 'now').mockReturnValue(0);
  act(() => element('trigger').click()); expect(viewport('frame').scrollTop).toBe(0); const next = callbacks.entries().next().value!; callbacks.delete(next[0]); act(() => next[1](100)); expect(viewport('frame').scrollTop).toBe(100);
  act(() => viewport('frame').dispatchEvent(new WheelEvent('wheel', { bubbles: true }))); expect(callbacks.size).toBe(0); expect(viewport('frame').scrollTop).toBe(100);
  vi.stubGlobal('matchMedia', () => ({ matches: true })); act(() => element('trigger').click()); expect(viewport('frame').scrollTop).toBe(200); expect(callbacks.size).toBe(0);
});
it('uses physical spring time for local scrolling, overshoots and settles independently of a stale duration', async () => {
  const { view, target, inner } = scene(), easing = { type: 'spring' as const, mass: 1, stiffness: 100, damping: 10, initialVelocity: 0 }, duration = designSpringDuration(easing), callbacks = new Map<number, FrameRequestCallback>(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; }); vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id)); vi.spyOn(performance, 'now').mockReturnValue(0);
  Object.assign(target, { scrollIntoView: () => { inner.scrollTop = 200; } }); const job = designScrollTo(view, { ...action, transition: 'scroll', duration: 1, easing });
  const tick = (time: number) => { const [id, callback] = callbacks.entries().next().value!; callbacks.delete(id); callback(time); };
  tick(400); expect(inner.scrollTop).toBeCloseTo(200 * designSpringAt(easing, 0.4), 5); expect(inner.scrollTop).toBeGreaterThan(200); tick(duration); expect(await job.finished).toBe(true); expect(inner.scrollTop).toBe(200); expect(callbacks.size).toBe(0);
  const before = inner.scrollTop, measure = vi.fn(); Object.assign(target, { scrollIntoView: measure }); expect(() => designScrollTo(view, { ...action, transition: 'scroll', duration: 1, easing: { ...easing, damping: 0.01 } })).toThrow('ten seconds'); expect(measure).not.toHaveBeenCalled(); expect(inner.scrollTop).toBe(before);
});
it('plays local Scroll To without a page host and delivers runtime failures visibly', () => {
  const target = layer('destination'), trigger = layer('trigger'); trigger.text = 'Scroll'; trigger.navigation = action; const frame = layer('frame', [trigger, target]); frame.scroll = { axis: 'vertical', initial: { x: 7, y: 10 } }; render([frame]); dimensions(viewport('frame')); const targetElement = element('destination'); Object.assign(targetElement, { scrollIntoView: () => { viewport('frame').scrollTop = 300; } });
  act(() => element('trigger').click()); expect(viewport('frame').scrollTop).toBe(300); targetElement.hidden = true; act(() => element('trigger').click()); expect(host.querySelector('[role=alert]')?.textContent).toContain('hidden');
});
it('keeps fixed controls interactive, forwards wheel movement, and updates only direct sticky children', () => {
  const sticky = layer('sticky'), innerSticky = layer('innerSticky'), nested = layer('nested', [innerSticky]), fixed = layer('fixed'); sticky.scrollBehaviour = innerSticky.scrollBehaviour = 'sticky'; sticky.style.transform = 'rotate(10deg)'; nested.scroll = { axis: 'none' }; fixed.scrollBehaviour = 'fixed'; fixed.fixedStyle = { position: 'absolute', left: 5, top: 10, width: 30, height: 30 };
  fixed.control = { kind: 'button', defaults: {}, booleans: {}, numbers: {}, properties: {}, variants: [{ properties: {}, tree: layer('art') }] }; const frame = layer('frame', [sticky, nested, fixed]); frame.scroll = { axis: 'vertical' }; const change = vi.fn(), activate = vi.fn(); render([frame], { onScrollPositionChange: change, onAction: activate }); dimensions(viewport('frame')); Object.defineProperty(element('sticky'), 'offsetTop', { value: 50 });
  viewport('frame').scrollTop = 100; act(() => viewport('frame').dispatchEvent(new Event('scroll'))); expect(element('sticky').style.transform).toBe('translate(0px,50px) rotate(10deg)'); expect(element('innerSticky').style.transform).toBe('');
  const button = host.querySelector<HTMLButtonElement>('[data-xdesign-fixed] button')!; expect(button.style.pointerEvents).toBe('auto'); act(() => button.click()); expect(activate).toHaveBeenCalledWith('fixed'); act(() => button.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 20 }))); expect(viewport('frame').scrollTop).toBe(120); expect(change).toHaveBeenLastCalledWith('frame', { x: 0, y: 120 });
});
it('preserves authored native fixed overrides while resolving live constrained fixed controls once', () => {
  const native = layer('native-fixed'), control = layer('responsive-fixed');
  native.scrollBehaviour = control.scrollBehaviour = 'fixed';
  native.fixedStyle = { position: 'absolute', left: 5, top: 10, width: 30, height: 24 };
  control.fixedStyle = { position: 'absolute', left: 10, top: 8, width: 20, height: 12 };
  control.responsive = { x: 10, y: 8, width: 20, height: 12, parentWidth: 100, parentHeight: 80, horizontal: 'MAX', vertical: 'STRETCH', groupScale: false, explicit: {} };
  control.control = { kind: 'button', defaults: {}, booleans: {}, numbers: {}, properties: {}, variants: [{ properties: {}, tree: layer('responsive-art') }] };
  const frame = layer('frame', [native, control]); frame.style.width = 100; frame.style.height = 80; frame.scroll = { axis: 'vertical' };
  const before = JSON.stringify(frame), activate = vi.fn(); render([frame], { onAction: activate });
  viewport('frame').scrollTop = 35; act(() => viewport('frame').dispatchEvent(new Event('scroll')));
  render([{ ...frame, style: { ...frame.style, width: 180, height: 120 } }], { onAction: activate });
  expect([element('native-fixed').style.left, element('native-fixed').style.top, element('native-fixed').style.width, element('native-fixed').style.height]).toEqual(['5px', '10px', '30px', '24px']);
  const button = host.querySelector<HTMLButtonElement>('[data-xdesign-layer="responsive-fixed"]')!;
  expect([button.style.left, button.style.top, button.style.width, button.style.height]).toEqual(['90px', '8px', '20px', '52px']);
  expect([element('responsive-art').style.left, element('responsive-art').style.top, element('responsive-art').style.width, element('responsive-art').style.height]).toEqual(['0px', '0px', '20px', '52px']);
  act(() => button.click()); expect(activate).toHaveBeenCalledExactlyOnceWith('responsive-fixed'); expect(viewport('frame').scrollTop).toBe(35); expect(JSON.stringify(frame)).toBe(before);
});

it('resolves fixed control tabs and transformed panels into one outer placement with local content', () => {
  const tab = layer('fixed-tab'), second = layer('second-tab'), panel = layer('fixed-panel'), secondPanel = layer('second-panel');
  const responsive = (x: number, y: number, width: number, height: number, parentWidth: number, parentHeight: number, horizontal: 'MIN' | 'MAX' | 'STRETCH'): NonNullable<DesignNode['responsive']> => ({ x, y, width, height, parentWidth, parentHeight, horizontal, vertical: 'MIN', groupScale: false, explicit: {} });
  tab.scrollBehaviour = panel.scrollBehaviour = 'fixed';
  Object.assign(tab.style, { left: 5, top: 2, width: 25, height: 12 }); tab.fixedStyle = { position: 'absolute', left: 5, top: 2, width: 25, height: 12 }; tab.responsive = responsive(5, 2, 25, 12, 100, 30, 'MAX');
  tab.control = { kind: 'button', defaults: {}, booleans: {}, numbers: {}, properties: {}, variants: [{ properties: {}, tree: layer('tab-art') }] };
  second.text = 'Second'; Object.assign(second.style, { left: 35, top: 2, width: 25, height: 12 });
  Object.assign(panel.style, { left: 7, top: 3, width: 70, height: 24, transform: 'rotate(10deg)', transformOrigin: '0 0' }); panel.fixedStyle = { position: 'absolute', left: 7, top: 3, width: 70, height: 24 }; panel.responsive = responsive(7, 3, 70, 24, 100, 40, 'STRETCH');
  panel.control = { kind: 'button', defaults: {}, booleans: {}, numbers: {}, properties: {}, variants: [{ properties: {}, tree: layer('panel-art') }] };
  const list = layer('list', [tab, second]), panels = layer('panels', [panel, secondPanel]);
  Object.assign(list.style, { width: 100, height: 30 }); list.part = 'list'; list.scroll = { axis: 'horizontal' }; list.responsive = responsive(0, 0, 100, 30, 200, 100, 'STRETCH');
  Object.assign(panels.style, { top: 35, width: 100, height: 40 }); panels.part = 'panels'; panels.scroll = { axis: 'vertical' }; panels.responsive = responsive(0, 35, 100, 40, 200, 100, 'STRETCH');
  const tree = layer('tabs-art', [list, panels]), tabs = layer('tabs'); Object.assign(tabs.style, { width: 200, height: 100 });
  tabs.control = { kind: 'tabs', defaults: {}, booleans: {}, numbers: {}, properties: {}, variants: [{ properties: {}, tree }] };
  const before = JSON.stringify(tabs); render([tabs]); viewport('list').scrollLeft = 14; viewport('panels').scrollTop = 17;
  render([{ ...tabs, style: { ...tabs.style, width: 280 } }]);
  const tabElement = element('fixed-tab'), panelElement = element('fixed-panel').closest<HTMLElement>('[role="tabpanel"]')!;
  expect([tabElement.style.left, tabElement.style.top, tabElement.style.width, tabElement.style.height]).toEqual(['85px', '2px', '25px', '12px']);
  expect([element('tab-art').style.left, element('tab-art').style.top, element('tab-art').style.width, element('tab-art').style.height]).toEqual(['0px', '0px', '25px', '12px']);
  expect([panelElement.style.left, panelElement.style.top, panelElement.style.width, panelElement.style.height]).toEqual(['7px', '3px', '150px', '24px']);
  expect(panelElement.style.transform).toBe('rotate(10deg)'); expect(element('fixed-panel').style.transform).toBe('');
  expect([element('fixed-panel').style.left, element('fixed-panel').style.top, element('fixed-panel').style.width, element('fixed-panel').style.height]).toEqual(['0px', '0px', '150px', '24px']);
  act(() => element('second-tab').click()); expect(panelElement.hidden).toBe(true); expect(element('second-panel').closest<HTMLElement>('[role="tabpanel"]')!.hidden).toBe(false);
  expect([viewport('list').scrollLeft, viewport('panels').scrollTop]).toEqual([14, 17]); expect(JSON.stringify(tabs)).toBe(before);
});
it.each([
  ['vertical', 'ltr', [[0, 0], [0, 35], [0, 700]]],
  ['horizontal', 'ltr', [[0, 0], [35, 0], [700, 0]]],
  ['both', 'ltr', [[0, 0], [35, 45], [700, 700]]],
  ['both', 'rtl', [[0, 0], [-35, 45], [-700, 700]]],
] as const)('counter-scrolls each authored fixed clip on %s/%s without changing child transforms or extending its viewport', (axis, direction, points) => {
  const before = layer('before'), fixed = layer('fixed'), middle = layer('middle'), outside = layer('outside'), after = layer('after');
  fixed.scrollBehaviour = outside.scrollBehaviour = 'fixed';
  fixed.fixedStyle = { position: 'absolute', left: 12, top: 9, width: 30, height: 24 };
  Object.assign(fixed.style, { transform: 'matrix(0,1,-1,0,24,0)', transformOrigin: '7px 3px' });
  outside.fixedStyle = { position: 'absolute', left: 200, top: -80, width: 500, height: 300 };
  const frame = layer('frame', [before, fixed, middle, outside, after]); frame.scroll = { axis }; frame.style.direction = direction; frame.style.borderRadius = 8;
  const source = JSON.stringify(frame); render([frame]); const scroll = viewport('frame'); dimensions(scroll);
  const content = scroll.firstElementChild!, clips = [...content.children].filter(child => child.hasAttribute('data-xdesign-fixed')) as HTMLElement[];
  expect([...content.children].map(child => child.getAttribute('data-xdesign-fixed') ?? child.getAttribute('data-xdesign-layer'))).toEqual(['before', 'fixed', 'middle', 'outside', 'after']);
  expect(clips).toHaveLength(2);
  for (const clip of clips) {
    expect([clip.style.position, clip.style.width, clip.style.height, clip.style.overflow, clip.style.borderRadius, clip.style.pointerEvents]).toEqual(['absolute', '100%', '100%', 'hidden', '8px', 'none']);
    expect(Number.parseFloat(clip.style.inset)).toBe(0);
  }
  for (const [x, y] of points) {
    scroll.scrollLeft = x; scroll.scrollTop = y; act(() => scroll.dispatchEvent(new Event('scroll')));
    for (const clip of clips) {
      expect(clip.style.transform).toBe(`translate(${x}px,${y}px)`);
      const [counterX, counterY] = [...clip.style.transform.matchAll(/(-?\d+)px/g)].map(match => Number(match[1]));
      expect([counterX! - x, counterY! - y, counterX! + scroll.clientWidth - x, counterY! + scroll.clientHeight - y]).toEqual([0, 0, 100, 100]);
    }
    expect([element('fixed').style.left, element('fixed').style.top, element('fixed').style.transform, element('fixed').style.transformOrigin]).toEqual(['12px', '9px', 'matrix(0,1,-1,0,24,0)', '7px 3px']);
    expect([element('outside').style.left, element('outside').style.top, element('outside').style.width, element('outside').style.height]).toEqual(['200px', '-80px', '500px', '300px']);
  }
  if (axis !== 'both') {
    scroll.scrollLeft = 13; scroll.scrollTop = 19; act(() => scroll.dispatchEvent(new Event('scroll')));
    expect(clips[0]!.style.transform).toBe(axis === 'vertical' ? 'translate(0px,19px)' : 'translate(13px,0px)');
  }
  const removed = clips[0]!, oldTransform = removed.style.transform;
  render([{ ...frame, children: [before, middle, outside, after] }]); scroll.scrollTop = axis === 'horizontal' ? 0 : 17; scroll.scrollLeft = axis === 'vertical' ? 0 : direction === 'rtl' ? -19 : 19; act(() => scroll.dispatchEvent(new Event('scroll')));
  expect(removed.isConnected).toBe(false); expect(removed.style.transform).toBe(oldTransform); expect(JSON.stringify(frame)).toBe(source);
});

it('keeps fixed clips outside flex flow and releases registrations across hidden, reordered and removed children', () => {
  const first = layer('fixed-first'), second = layer('fixed-second'), flow = layer('flow');
  first.scrollBehaviour = second.scrollBehaviour = 'fixed'; first.fixedStyle = second.fixedStyle = { left: 3, top: 4, width: 20, height: 12 };
  flow.style.position = 'relative'; const frame = layer('frame', [flow, first, second]); frame.style.display = 'flex'; frame.style.flexDirection = 'row'; frame.style.padding = '8px'; frame.scroll = { axis: 'vertical' };
  const source = JSON.stringify(frame); render([frame]); const scroll = viewport('frame'), oldFirst = host.querySelector<HTMLElement>('[data-xdesign-fixed="fixed-first"]')!, oldSecond = host.querySelector<HTMLElement>('[data-xdesign-fixed="fixed-second"]')!;
  expect((scroll.firstElementChild as HTMLElement).style.display).toBe('flex'); expect(element('flow').style.position).toBe('relative'); expect([oldFirst.style.position, oldSecond.style.position]).toEqual(['absolute', 'absolute']);
  scroll.scrollTop = 21; act(() => scroll.dispatchEvent(new Event('scroll')));
  render([{ ...frame, children: [flow, { ...first, visible: false }, second] }]);
  expect(host.querySelector('[data-xdesign-fixed="fixed-first"]')).toBeNull(); scroll.scrollTop = 34; act(() => scroll.dispatchEvent(new Event('scroll'))); expect(oldFirst.style.transform).toBe('translate(0px,21px)');
  const detachedWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 }); act(() => oldFirst.dispatchEvent(detachedWheel)); expect(scroll.scrollTop).toBe(34); expect(detachedWheel.defaultPrevented).toBe(false);
  render([{ ...frame, children: [second, flow, first] }]);
  const current = host.querySelector<HTMLElement>('[data-xdesign-fixed="fixed-first"]')!;
  expect([...scroll.firstElementChild!.children].map(child => child.getAttribute('data-xdesign-fixed') ?? child.getAttribute('data-xdesign-layer'))).toEqual(['fixed-second', 'flow', 'fixed-first']);
  scroll.scrollTop = 55; act(() => scroll.dispatchEvent(new Event('scroll'))); expect(current.style.transform).toBe('translate(0px,55px)'); expect(oldSecond.isConnected).toBe(false); expect(oldSecond.style.transform).toBe('translate(0px,34px)');
  render([{ ...frame, children: [] }]); scroll.scrollTop = 70; act(() => scroll.dispatchEvent(new Event('scroll'))); expect(current.isConnected).toBe(false); expect(current.style.transform).toBe('translate(0px,55px)'); expect(JSON.stringify(frame)).toBe(source);
});

it('retains nested fixed ownership, Scroll To restoration and inner wheel ownership in authored order', () => {
  const target = layer('destination'), innerFixed = layer('inner-fixed'), inner = layer('inner', [innerFixed, target]), outerFixed = layer('outer-fixed');
  innerFixed.scrollBehaviour = inner.scrollBehaviour = outerFixed.scrollBehaviour = 'fixed';
  inner.scroll = { axis: 'vertical' }; inner.fixedStyle = { position: 'absolute', left: 10, top: 15, width: 80, height: 70 };
  innerFixed.fixedStyle = { position: 'absolute', left: 4, top: 5, width: 20, height: 15 }; outerFixed.fixedStyle = { position: 'absolute', left: 0, top: 0, width: 15, height: 15 };
  const outer = layer('outer', [outerFixed, inner, layer('outer-last')]); outer.scroll = { axis: 'vertical' };
  const source = JSON.stringify(outer); render([outer]); dimensions(viewport('outer')); dimensions(viewport('inner'));
  viewport('outer').scrollTop = 50; viewport('inner').scrollTop = 20; act(() => { viewport('outer').dispatchEvent(new Event('scroll')); viewport('inner').dispatchEvent(new Event('scroll')); });
  const outerClip = host.querySelector<HTMLElement>('[data-xdesign-fixed="inner"]')!, innerClip = host.querySelector<HTMLElement>('[data-xdesign-fixed="inner-fixed"]')!;
  expect(outerClip.style.transform).toBe('translate(0px,50px)'); expect(innerClip.style.transform).toBe('translate(0px,20px)');
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 30 }); act(() => element('destination').dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false); expect(viewport('outer').scrollTop).toBe(50);
  const fixedWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 }); act(() => element('inner-fixed').dispatchEvent(fixedWheel));
  expect(fixedWheel.defaultPrevented).toBe(true); expect([viewport('inner').scrollTop, viewport('outer').scrollTop]).toEqual([30, 50]);
  const view = host.querySelector<HTMLElement>('[data-xdesign-view]')!;
  Object.assign(element('destination'), { scrollIntoView: () => { viewport('inner').scrollTop = 200; viewport('outer').scrollTop = 400; host.scrollTop = 600; } });
  act(() => designScrollTo(view, action)());
  expect([viewport('inner').scrollTop, viewport('outer').scrollTop, host.scrollTop]).toEqual([200, 50, 0]);
  expect(outerClip.style.transform).toBe('translate(0px,50px)'); expect(innerClip.style.transform).toBe('translate(0px,200px)');
  const measure = vi.fn(); Object.assign(element('inner-fixed'), { scrollIntoView: measure });
  act(() => designScrollTo(view, { ...action, target: 'inner-fixed' })()); expect(measure).not.toHaveBeenCalled(); expect(viewport('inner').scrollTop).toBe(200); expect(JSON.stringify(outer)).toBe(source);
});

it('leaves a clamped fixed-wheel gesture available to browser scroll chaining at either edge', () => {
  const fixed = layer('fixed'), frame = layer('frame', [fixed]); fixed.scrollBehaviour = 'fixed'; frame.scroll = { axis: 'vertical' }; render([frame]);
  let top = 0;
  Object.defineProperty(viewport('frame'), 'scrollTop', { configurable: true, get: () => top, set: value => { top = Math.max(0, Math.min(100, Number(value))); } });
  for (const [position, delta] of [[0, -20], [100, 20]] as const) {
    top = position;
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: delta }); act(() => element('fixed').dispatchEvent(wheel));
    expect(top).toBe(position); expect(wheel.defaultPrevented).toBe(false);
  }
  top = 50; const handled = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 10 }); act(() => element('fixed').dispatchEvent(handled)); expect(top).toBe(60); expect(handled.defaultPrevented).toBe(true);
});

it('keeps a fixed video element resident across scroll and prop refreshes and cleans up after removal', () => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const clip = layer('video'); clip.scrollBehaviour = 'fixed'; clip.fixedStyle = { position: 'absolute', left: 10, top: 8, width: 40, height: 30 }; clip.style.transform = 'rotate(12deg)';
  clip.video = { src: 'data:video/webm;base64,AQID', poster: 'data:image/png;base64,AQID', autoplay: false, loop: true, muted: true, controls: true, style: { objectFit: 'cover' } };
  const frame = layer('frame', [layer('before-video'), clip, layer('after-video')]); frame.scroll = { axis: 'vertical' }; const source = JSON.stringify(frame); render([frame]);
  const video = host.querySelector<HTMLVideoElement>('video')!; video.currentTime = 3; viewport('frame').scrollTop = 60; act(() => viewport('frame').dispatchEvent(new Event('scroll')));
  render([frame], { values: { unrelated: true } });
  expect(host.querySelector('video')).toBe(video); expect(video.currentTime).toBe(3); expect(video.getAttribute('src')).toBe(clip.video.src); expect(element('video').style.transform).toBe('rotate(12deg)'); expect(pause).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  expect([...viewport('frame').firstElementChild!.children].map(child => child.getAttribute('data-xdesign-fixed') ?? child.getAttribute('data-xdesign-layer'))).toEqual(['before-video', 'video', 'after-video']);
  render([frame], { disabled: true }); expect(pause).toHaveBeenCalledOnce(); expect(video.controls).toBe(false); expect(viewport('frame').hasAttribute('inert')).toBe(true);
  const disabledWheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 20 }); act(() => video.dispatchEvent(disabledWheel)); expect(viewport('frame').scrollTop).toBe(60); expect(disabledWheel.defaultPrevented).toBe(false);
  render([{ ...frame, children: [] }]); expect(pause).toHaveBeenCalledTimes(2); expect(load).toHaveBeenCalledOnce(); expect(video.hasAttribute('src')).toBe(false); expect(JSON.stringify(frame)).toBe(source);
});
it('retains positions on callback/value changes and restores explicit positions only on revision', () => {
  const frame = layer('frame'); frame.scroll = { axis: 'both', initial: { x: 5, y: 10 } }; const callback = vi.fn(); render([frame], { onScrollPositionChange: callback }); expect([viewport('frame').scrollLeft, viewport('frame').scrollTop]).toEqual([5, 10]); viewport('frame').scrollTop = 80; act(() => viewport('frame').dispatchEvent(new Event('scroll')));
  render([frame], { values: { text: 'typing' }, onScrollPositionChange: callback, scrollPositions: { frame: { x: 20, y: 30 } } }); expect(viewport('frame').scrollTop).toBe(80); render([frame], { scrollRevision: 1, scrollPositions: { frame: { x: 20, y: 30 } } }); expect([viewport('frame').scrollLeft, viewport('frame').scrollTop]).toEqual([20, 30]);
});
it('preserves positions only for identical layout geometry and resets all variant identities', () => {
  const source = layer('source', [layer('row')]), target = layer('target', [layer('other')]); source.scroll = target.scroll = { axis: 'vertical' }; const positions = { source: { x: 0, y: 80 }, target: { x: 0, y: 10 } };
  transferDesignScroll([source], [target], positions, { preserveScroll: true }); expect(positions.target.y).toBe(80); target.children[0]!.style.top = 20; positions.target.y = 10; transferDesignScroll([source], [target], positions, { preserveScroll: true }); expect(positions.target.y).toBe(10);
  target.control = { kind: 'button', defaults: {}, booleans: {}, numbers: {}, properties: {}, variants: [{ properties: {}, tree: { ...layer('target'), scroll: { axis: 'horizontal' } } }] }; transferDesignScroll([source], [target], positions, { resetScroll: true }); expect(positions.target).toBeUndefined(); expect(positions.source.y).toBe(80);
});

it('scrolls inside a fixed nested frame while leaving its outer page position unchanged', () => {
  const target = layer('destination'), inner = layer('inner', [target]), outer = layer('outer', [inner]); inner.scroll = { axis: 'vertical' }; inner.scrollBehaviour = 'fixed'; inner.fixedStyle = { width: 100, height: 100 }; outer.scroll = { axis: 'vertical' }; render([outer]); const view = host.querySelector<HTMLElement>('[data-xdesign-view]')!; dimensions(viewport('inner')); dimensions(viewport('outer')); viewport('outer').scrollTop = 50;
  Object.assign(element('destination'), { scrollIntoView: () => { viewport('inner').scrollTop = 200; host.scrollTop = 600; } }); act(() => designScrollTo(view, action)()); expect(viewport('inner').scrollTop).toBe(200); expect(viewport('outer').scrollTop).toBe(50); expect(host.scrollTop).toBe(0);
});
it('lands exactly at the destination after custom easing and cancels pending animation on disable, hide and unmount', () => {
  const destination = layer('destination'), trigger = layer('trigger'); trigger.text = 'Scroll'; trigger.navigation = { ...action, transition: 'scroll', duration: 200, easing: [0.25, -1, 0.75, 2] }; const frame = layer('frame', [trigger, destination]); frame.scroll = { axis: 'vertical' }; render([frame]); dimensions(viewport('frame')); Object.assign(element('destination'), { scrollIntoView: () => { viewport('frame').scrollTop = 200; } }); const callbacks = new Map<number, FrameRequestCallback>(); let id = 0; vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; }); vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id)); vi.spyOn(performance, 'now').mockReturnValue(0);
  const start = () => act(() => element('trigger').click()), step = (time: number) => { const entry = callbacks.entries().next().value!; callbacks.delete(entry[0]); act(() => entry[1](time)); }; start(); step(100); step(200); expect(viewport('frame').scrollTop).toBe(200); expect(callbacks.size).toBe(0);
  start(); render([frame], { disabled: true }); expect(callbacks.size).toBe(0); render([frame]); start(); const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); act(() => document.dispatchEvent(new Event('visibilitychange'))); expect(callbacks.size).toBe(0); hidden.mockReturnValue(false); start(); act(() => root.render(null)); expect(callbacks.size).toBe(0);
});

it('restores and animates with explicit instant writes rather than inheriting host CSS smooth scrolling', () => {
  const { view, target, inner, outer } = scene(); const writes: ScrollToOptions[] = []; Object.assign(host, { scrollTo: (point: ScrollToOptions) => { writes.push(point); host.scrollLeft = point.left!; host.scrollTop = point.top!; } }); Object.assign(inner, { scrollTo: (point: ScrollToOptions) => { writes.push(point); inner.scrollLeft = point.left!; inner.scrollTop = point.top!; } }); Object.assign(target, { scrollIntoView: () => { inner.scrollTop = 300; outer.scrollTop = 100; host.scrollTop = 500; } }); act(() => designScrollTo(view, action)()); expect(host.scrollTop).toBe(0); expect(inner.scrollTop).toBe(300); expect(writes.every(point => point.behavior === 'instant')).toBe(true); expect(writes.length).toBeGreaterThan(1);
});

it.each([0, 1] as const)('scrubs every nested scroller and resolves a gesture release to endpoint %s', async endpoint => {
  const { view, target, inner, outer } = scene(), callbacks = new Map<number, FrameRequestCallback>(); let next = 0; vi.spyOn(performance, 'now').mockReturnValue(0); vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; }); vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  Object.assign(target, { scrollIntoView: () => { inner.scrollLeft = 100; inner.scrollTop = 200; outer.scrollLeft = 200; outer.scrollTop = 300; } }); const job = designScrollTo(view, { ...action, transition: 'scroll', duration: 200, easing: 'linear' }, true); expect(callbacks.size).toBe(0); job.scrub!(0.25); expect([inner.scrollLeft, inner.scrollTop, outer.scrollLeft, outer.scrollTop]).toEqual([25, 50, 50, 75]); expect(job.movement!()).toEqual({ x: -200, y: -300 }); const released = job.settle!(endpoint); const callback = [...callbacks.values()][0]!; act(() => callback(endpoint ? 150 : 50)); expect(await released).toBe(true); expect(await job.finished).toBe(endpoint === 1); expect([inner.scrollLeft, inner.scrollTop, outer.scrollLeft, outer.scrollTop]).toEqual(endpoint ? [100, 200, 200, 300] : [0, 0, 0, 0]);
});

it('resolves interactive scrolling inside a host-inert drag surface while ordinary input still refuses it', () => {
  const { view, target, inner } = scene(); view.parentElement!.setAttribute('inert', ''); Object.assign(target, { scrollIntoView: () => { inner.scrollTop = 200; } }); expect(() => designScrollTo(view, action)).toThrow('hidden'); const job = designScrollTo(view, action, true); job.scrub!(0.5); expect(inner.scrollTop).toBe(100); job();
});

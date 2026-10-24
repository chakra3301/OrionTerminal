import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DesignView, type DesignInteraction, type DesignNode, type DesignProps, type DesignTrigger } from './reactExportRuntime';
let host: HTMLDivElement, root: Root;
const route = { action: 'back' as const, transition: 'instant' as const, duration: 0 };
const node = (trigger: DesignTrigger, id = 'hotspot'): DesignNode => ({ id, name: id, visible: true, style: {}, text: id, children: [], interactions: [{ id: 'action', trigger, navigation: route }] });
const render = (nodes: DesignNode[], props: DesignProps) => act(() => root.render(<DesignView nodes={nodes} width={320} height={480} {...props} />));
const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const key = (target: Element | Window, init: KeyboardEventInit) => act(() => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
function pointer(target: Element, type: string, pointerType = 'mouse') { act(() => { const event = new Event(type, { bubbles: true }); Object.defineProperty(event, 'pointerType', { value: pointerType }); target.dispatchEvent(event); }); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

it('includes a trigger origin in design coordinates for overlay hosts, including a scaled view', () => {
  const next = node({ type: 'click' }), navigate = vi.fn(); next.interactions![0]!.navigation = { action: 'overlay', target: 'dialog', transition: 'instant', duration: 0, offset: { x: 4, y: 8 } };
  render([next], { onNavigate: navigate });
  const view = host.querySelector<HTMLElement>('[data-xdesign-view]')!, layer = host.querySelector<HTMLElement>('[data-name=hotspot]')!;
  vi.spyOn(view, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 200, width: 160, height: 240 } as DOMRect); vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({ left: 115, top: 220 } as DOMRect);
  act(() => layer.click()); expect(navigate).toHaveBeenCalledWith(next.interactions![0]!.navigation, 'hotspot', { type: 'click' }, { x: 30, y: 40 });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('fires authored delays once and uses the latest callback without restarting on value changes', () => {
  const nodes = [node({ type: 'delay', delay: 100 })], first = vi.fn(), latest = vi.fn();
  render(nodes, { onNavigate: first }); tick(50); render(nodes, { onNavigate: latest, values: { field: 'typing' } }); tick(50);
  expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledWith(route, 'hotspot', { type: 'delay', delay: 100 }); tick(1000); expect(latest).toHaveBeenCalledOnce();
});
it('cancels delays for disabled and removed layers and restarts only when enabled', () => {
  const nodes = [node({ type: 'delay', delay: 100 })], navigate = vi.fn();
  render(nodes, { onNavigate: navigate }); tick(50); render(nodes, { onNavigate: navigate, disabled: true }); tick(1000); expect(navigate).not.toHaveBeenCalled();
  render(nodes, { onNavigate: navigate }); tick(99); expect(navigate).not.toHaveBeenCalled(); tick(1); expect(navigate).toHaveBeenCalledOnce();
  render([node({ type: 'delay', delay: 100 }, 'next')], { onNavigate: navigate }); render([], { onNavigate: navigate }); tick(1000); expect(navigate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('keeps hidden layers and hidden ancestors from firing timers or shortcuts', () => {
  const hidden = node({ type: 'delay', delay: 100 }); hidden.visible = false;
  const navigate = vi.fn(); render([hidden, node({ type: 'key', keyCodes: [65] })], { onNavigate: navigate });
  host.querySelector('[data-name=hotspot]')!.setAttribute('hidden', ''); tick(200); key(host.querySelector('[data-xdesign-view]')!, { key: 'a', code: 'KeyA' }); expect(navigate).not.toHaveBeenCalled();
});
it('pauses and resumes timers while preserving manual interactions', () => {
  const next = node({ type: 'delay', delay: 100 }); next.interactions!.push({ id: 'click', trigger: { type: 'click' }, navigation: route });
  const navigate = vi.fn(); render([next], { onNavigate: navigate, automatic: false }); tick(200); expect(navigate).not.toHaveBeenCalled();
  act(() => (host.querySelector('[role=link]') as HTMLElement).click()); expect(navigate).toHaveBeenCalledWith(route, 'hotspot');
  render([next], { onNavigate: navigate, automatic: true }); tick(100); expect(navigate).toHaveBeenCalledTimes(2);
});
it('suspends timing while the document is hidden and gives it a fresh delay on return', () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false), navigate = vi.fn(); render([node({ type: 'delay', delay: 100 })], { onNavigate: navigate }); tick(50);
  hidden.mockReturnValue(true); act(() => document.dispatchEvent(new Event('visibilitychange'))); tick(200); expect(navigate).not.toHaveBeenCalled();
  hidden.mockReturnValue(false); act(() => document.dispatchEvent(new Event('visibilitychange'))); tick(99); expect(navigate).not.toHaveBeenCalled(); tick(1); expect(navigate).toHaveBeenCalledOnce();
});
it('keeps an already fired delay spent across timer suspension and disabled underlays, while new metadata rearms it', () => {
  const nodes = [node({ type: 'delay', delay: 100 })], navigate = vi.fn(); render(nodes, { onNavigate: navigate }); tick(100); expect(navigate).toHaveBeenCalledOnce();
  render(nodes, { onNavigate: navigate, automatic: false }); render(nodes, { onNavigate: navigate }); tick(200); expect(navigate).toHaveBeenCalledOnce();
  render(nodes, { onNavigate: navigate, disabled: true }); render(nodes, { onNavigate: navigate }); tick(200); expect(navigate).toHaveBeenCalledOnce();
  nodes[0]!.interactions![0]!.trigger = { type: 'delay', delay: 150 }; render(nodes, { onNavigate: navigate }); tick(150); expect(navigate).toHaveBeenCalledTimes(2);
});
it('handles mouse enter and leave with held delays, cancellation and fine-pointer gating', () => {
  const next = node({ type: 'pointer-enter', delay: 100 }); next.interactions!.push({ id: 'leave', trigger: { type: 'pointer-leave' }, navigation: route }); const navigate = vi.fn(); render([next], { onNavigate: navigate });
  const layer = host.querySelector('[data-name=hotspot]')!;
  pointer(layer, 'pointerover'); tick(50); pointer(layer, 'pointerout'); tick(200); expect(navigate).toHaveBeenCalledOnce(); expect(navigate.mock.calls[0]![2]).toEqual({ type: 'pointer-leave' });
  pointer(layer, 'pointerover'); tick(100); expect(navigate).toHaveBeenCalledTimes(2);
  pointer(layer, 'pointerout', 'touch'); expect(navigate).toHaveBeenCalledTimes(2);
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList); pointer(layer, 'pointerover'); tick(100); expect(navigate).toHaveBeenCalledTimes(2);
});
it('scopes exact key chords to the view and skips typing, repeat and composition', () => {
  const navigate = vi.fn(), next = node({ type: 'key', keyCodes: [16, 17, 65] }); render([next], { onNavigate: navigate }); const view = host.querySelector('[data-xdesign-view]')!;
  key(window, { key: 'A', code: 'KeyA', shiftKey: true, ctrlKey: true }); key(view, { key: 'a', code: 'KeyA', ctrlKey: true }); expect(navigate).not.toHaveBeenCalled();
  key(view, { key: 'A', code: 'KeyA', shiftKey: true, ctrlKey: true, repeat: true }); key(view, { key: 'A', code: 'KeyA', shiftKey: true, ctrlKey: true, isComposing: true }); expect(navigate).not.toHaveBeenCalled();
  const field = document.createElement('textarea'); view.append(field); key(field, { key: 'A', code: 'KeyA', shiftKey: true, ctrlKey: true }); expect(navigate).not.toHaveBeenCalled();
  key(view, { key: 'A', code: 'KeyA', shiftKey: true, ctrlKey: true }); expect(navigate).toHaveBeenCalledWith(route, 'hotspot', next.interactions![0]!.trigger);
});
it('dispatches only one matching key interaction and yields zero delays to the browser', () => {
  const navigate = vi.fn(); render([node({ type: 'key', keyCodes: [13] }, 'a'), node({ type: 'key', keyCodes: [13] }, 'b'), node({ type: 'delay', delay: 0 }, 'c')], { onNavigate: navigate });
  key(host.querySelector('[data-xdesign-view]')!, { key: 'Enter' }); expect(navigate).toHaveBeenCalledOnce(); tick(15); expect(navigate).toHaveBeenCalledOnce(); tick(1); expect(navigate).toHaveBeenCalledTimes(2);
});
it('handles all authored triggers on the same layer', () => {
  const triggers: DesignTrigger[] = [{ type: 'click' }, { type: 'pointer-enter' }, { type: 'pointer-leave' }, { type: 'key', keyCodes: [32] }, { type: 'delay', delay: 100 }];
  const next = node(triggers[0]!); next.interactions = triggers.map((trigger, index): DesignInteraction => ({ id: String(index), trigger, navigation: route })); const navigate = vi.fn(); render([next], { onNavigate: navigate });
  const layer = host.querySelector('[data-name=hotspot]')!; act(() => (layer as HTMLElement).click()); pointer(layer, 'pointerover'); pointer(layer, 'pointerout'); key(host.querySelector('[data-xdesign-view]')!, { key: ' ', code: 'Space' }); tick(100); expect(navigate).toHaveBeenCalledTimes(5);
});

it('cancels a pending mouse hold when hidden or when the pointer is cancelled', () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false), navigate = vi.fn(); render([node({ type: 'pointer-enter', delay: 100 })], { onNavigate: navigate }); const layer = host.querySelector('[data-name=hotspot]')!;
  pointer(layer, 'pointerover'); tick(50); hidden.mockReturnValue(true); act(() => document.dispatchEvent(new Event('visibilitychange'))); hidden.mockReturnValue(false); act(() => document.dispatchEvent(new Event('visibilitychange'))); tick(100); expect(navigate).not.toHaveBeenCalled();
  pointer(layer, 'pointerout'); pointer(layer, 'pointerover'); tick(50); pointer(layer, 'pointercancel'); tick(100); expect(navigate).not.toHaveBeenCalled();
  pointer(layer, 'pointerout'); pointer(layer, 'pointerover'); tick(100); expect(navigate).toHaveBeenCalledOnce();
});

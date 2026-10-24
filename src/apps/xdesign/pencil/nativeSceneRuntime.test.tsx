import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DesignView, type DesignMotion, type DesignNode, type DesignProps } from './reactExportRuntime';
import { captureSmartLayers } from './prototypeSmartSnapshot';
import { prototypeSnapshot } from './prototypeMotion';
import { prepareSmartMotion } from './prototypeSmartMotion';
import type { NativePaintContext } from './prototypeNativePaint';

let host: HTMLDivElement, root: Root;
const motion: DesignMotion = { version: 1, root: true, type: 'FRAME', shape: 'box', shadow: true, composition: 'scene', width: 100, height: 80, local: [1, 0, 0, 1, 0, 0], radii: [0, 0, 0, 0], paints: [{ type: 'SOLID', color: [1, 0, 0, 1], opacity: 1, blend: 'NORMAL' }] };
const link = { action: 'back' as const, transition: 'smart' as const, duration: 200, easing: 'linear' as const };
function model(image = 'data:image/png;base64,AA=='): DesignNode {
  return { id: 'composed', name: 'Group', visible: true, motion, style: { width: 100, height: 80, position: 'relative', opacity: 1 }, image, imageStyle: { left: '-10%', top: '-10%', width: '120%', height: '120%' }, children: [
    { id: 'hotspot', sourceId: 'native-child', name: 'Open detail', sceneCovered: true, visible: true, style: { position: 'absolute', left: 10, top: 12, width: 30, height: 24 }, children: [], interactions: [{ id: 'go', trigger: { type: 'click' }, navigation: link }] },
  ] };
}
function mount(node: DesignNode, props: DesignProps = {}) { act(() => root.render(<DesignView nodes={[node]} width={200} height={160} {...props} />)); return host.querySelector<HTMLElement>('[data-name="Group"]')!; }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('keeps the covered semantic hit region focusable and clickable under a single noninteractive bitmap', () => {
  const navigate = vi.fn(), element = mount(model(), { onNavigate: navigate }), target = element.querySelector<HTMLElement>('[data-name="Open detail"]')!, image = element.querySelector('img')!;
  expect(element.querySelectorAll('img')).toHaveLength(1); expect(image.style.pointerEvents).toBe('none'); expect(image.style.width).toBe('120%'); expect(target.style.left).toBe('10px'); expect(target.style.width).toBe('30px');
  expect(target.getAttribute('data-xdesign-layer')).toBe('hotspot'); expect(target.getAttribute('data-xdesign-source')).toBe('native-child'); expect(target.hasAttribute('data-xdesign-scene-covered')).toBe(true); expect(target.hasAttribute('data-xdesign-motion')).toBe(false);
  expect(target.getAttribute('role')).toBe('link'); expect(target.tabIndex).toBe(0); expect(target.getAttribute('aria-label')).toBe('Open detail'); expect(target.closest('[inert],[hidden],[aria-hidden="true"]')).toBeNull(); expect(target.style.visibility).toBe(''); expect(target.style.opacity).toBe('');
  act(() => target.click()); expect(navigate).toHaveBeenCalledWith(link, 'hotspot'); navigate.mockClear();
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); expect(navigate).toHaveBeenCalledWith(link, 'hotspot');
  expect(captureSmartLayers(host).map(layer => layer.element)).toEqual([element]);
});
it('crossfades composed native artwork without cloning or hiding semantic children or planning a single-node native paint', () => {
  const element = mount(model()), parent = element.parentElement!, snapshot = prototypeSnapshot(host), incoming = document.createElement('div');
  host.prepend(snapshot); mount(model('data:image/png;base64,AQ==')); incoming.append(element); host.append(incoming);
  const target = element.querySelector<HTMLElement>('[data-name="Open detail"]')!, native = { plan: vi.fn() };
  const prepared = prepareSmartMotion(host, incoming, snapshot, link, native as unknown as NativePaintContext)!;
  expect(prepared).toBeTruthy(); expect(native.plan).not.toHaveBeenCalled(); expect(prepared.tracks.some(track => track.element === target)).toBe(false);
  const paints = [...element.querySelectorAll<HTMLElement>(':scope > [data-xdesign-motion-paint]')]; expect(paints).toHaveLength(2); expect(paints.map(paint => paint.querySelector('img')?.getAttribute('src'))).toEqual(['data:image/png;base64,AA==', 'data:image/png;base64,AQ==']);
  expect(paints.every(paint => !paint.querySelector('[data-name="Open detail"]'))).toBe(true); expect(target.style.visibility).toBe(''); expect(target.parentElement).toBe(element);
  expect(prepared.tracks.find(track => track.element === paints[0])?.frame(.5)).toEqual({ opacity: .5 }); expect(prepared.tracks.find(track => track.element === paints[1])?.frame(.5)).toEqual({ opacity: .5 });
  prepared.restore(); expect(element.querySelector('[data-xdesign-motion-paint]')).toBeNull(); expect(element.querySelector<HTMLImageElement>(':scope > img')?.style.visibility).toBe(''); expect(target.parentElement).toBe(element);
  parent.append(element); incoming.remove(); snapshot.remove();
});
it('removes coverage on reused semantic DOM and restores ordinary motion metadata on model changes', () => {
  const element = mount(model()), target = element.querySelector<HTMLElement>('[data-name="Open detail"]')!, next = model(); next.children[0]!.sceneCovered = false; next.children[0]!.motion = { ...motion, root: false, composition: undefined, shadow: false };
  mount(next); expect(element.querySelector('[data-name="Open detail"]')).toBe(target); expect(target.hasAttribute('data-xdesign-scene-covered')).toBe(false); expect(target.hasAttribute('data-xdesign-motion')).toBe(true); expect(captureSmartLayers(host)).toHaveLength(2);
  mount(model()); expect(target.hasAttribute('data-xdesign-motion')).toBe(false); expect(captureSmartLayers(host)).toHaveLength(1);
});
it('uses whole-branch fallback when a composed scene changes to independently painted descendants', () => {
  const element = mount(model()), parent = element.parentElement!, snapshot = prototypeSnapshot(host), next = model(); next.motion = { ...motion, composition: undefined, shadow: false }; next.children[0]!.sceneCovered = false; next.children[0]!.motion = { ...motion, root: false, composition: undefined, shadow: false };
  mount(next); const incoming = document.createElement('div'); incoming.append(element); host.append(incoming); host.prepend(snapshot);
  expect(prepareSmartMotion(host, incoming, snapshot, link)).toBeUndefined(); parent.append(element); incoming.remove(); snapshot.remove();
});
it('keeps native-composed text and styled runs accessible and restores their paint when coverage ends', () => {
  const node = model(), text = node.children[0]!; Object.assign(text, { text: 'Ready café', lang: 'en', style: { ...text.style, color: 'red', textDecorationColor: 'red', textShadow: '1px 1px black' }, runs: [{ text: 'Ready ', style: { color: 'red' } }, { text: 'café', lang: 'fr', style: { color: 'blue', textDecorationLine: 'underline', textDecorationColor: 'blue', textShadow: '1px 1px blue' } }] });
  const navigate = vi.fn(), element = mount(node, { onNavigate: navigate }), target = element.querySelector<HTMLElement>('[data-name="Open detail"]')!, runs = [...target.querySelectorAll<HTMLSpanElement>('span')];
  expect(target.textContent).toBe('Ready café'); expect(target.lang).toBe('en'); expect(runs[1]!.lang).toBe('fr'); expect(target.getAttribute('aria-label')).toBe('Open detail'); expect(target.tabIndex).toBe(0); expect(target.closest('[aria-hidden="true"],[hidden],[inert]')).toBeNull();
  for (const span of [target, ...runs]) { expect(span.style.color).toBe('transparent'); expect(span.style.textDecorationColor).toBe('transparent'); expect(span.style.textShadow).toBe('none'); expect(span.style.visibility).toBe(''); expect(span.style.opacity).toBe(''); }
  act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); expect(navigate).toHaveBeenCalledWith(link, 'hotspot');
  text.sceneCovered = false; mount(node, { onNavigate: navigate }); expect(element.querySelector('[data-name="Open detail"]')).toBe(target); expect(target.style.color).toBe('red'); expect(target.style.textDecorationColor).toBe('red'); expect(target.style.textShadow).toBe('1px 1px black'); expect(runs[1]!.style.color).toBe('blue'); expect(runs[1]!.style.textDecorationColor).toBe('blue'); expect(runs[1]!.style.textShadow).toBe('1px 1px blue'); expect(target.hasAttribute('data-xdesign-scene-covered')).toBe(false);
});
it('renders private mask clip definitions with unique identities and retains covered navigation inside the clipped group', () => {
  const node = model(), target = node.children[0]!; node.children = [{ id: 'mask-wrapper', name: 'Mask region', visible: true, sceneCovered: true, maskPath: 'M10,12h30v24h-30Z', style: { position: 'absolute', left: 0, top: 0, width: 100, height: 80 }, children: [target] }];
  const navigate = vi.fn(); act(() => root.render(<><DesignView nodes={[node]} width={100} height={80} onNavigate={navigate} /><DesignView nodes={[node]} width={100} height={80} onNavigate={navigate} /></>));
  const regions = [...host.querySelectorAll<HTMLElement>('[data-xdesign-mask]')], definitions = [...host.querySelectorAll('clipPath')]; expect(regions).toHaveLength(2); expect(new Set(definitions.map(definition => definition.id)).size).toBe(2);
  for (let i = 0; i < regions.length; i++) { expect(regions[i]!.style.clipPath).toBe(`url(#${definitions[i]!.id})`); expect(definitions[i]!.getAttribute('clipPathUnits')).toBe('userSpaceOnUse'); expect(definitions[i]!.querySelector('path')!.getAttribute('d')).toBe(node.children[0]!.maskPath); expect(definitions[i]!.closest('svg')!.getAttribute('aria-hidden')).toBe('true'); }
  const semantic = regions[0]!.querySelector<HTMLElement>('[data-name="Open detail"]')!; expect(semantic.tabIndex).toBe(0); act(() => semantic.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); expect(navigate).toHaveBeenCalledWith(link, 'hotspot');
});
it('removes fully masked semantic targets and clears clip definitions on reused DOM when coverage ends', () => {
  const node = model(), target = node.children[0]!, region: DesignNode = { id: 'mask-wrapper', name: 'Mask region', visible: false, sceneCovered: true, maskPath: '', style: { width: 100, height: 80 }, children: [target] }; node.children = [region]; mount(node); expect(host.querySelector('[data-name="Open detail"]')).toBeNull(); expect(host.querySelector('clipPath')).toBeNull();
  region.visible = true; region.maskPath = 'M0,0h100v80h-100Z'; mount(node); const element = host.querySelector<HTMLElement>('[data-name="Mask region"]')!; expect(element.style.clipPath).toContain('url('); expect(element.querySelector('clipPath')).not.toBeNull();
  delete region.maskPath; mount(node); expect(host.querySelector('[data-name="Mask region"]')).toBe(element); expect(element.style.clipPath).toBe(''); expect(element.querySelector('clipPath')).toBeNull(); expect(element.hasAttribute('data-xdesign-mask')).toBe(false); expect(element.querySelector('[data-name="Open detail"]')).not.toBeNull();
});
it('disables a clipped parent hotspot while retaining an overflowing visible child hotspot and restores reused navigation', () => {
  const node = model(), parent = node.children[0]!; parent.hitHidden = true; parent.children = [{ ...parent, id: 'overflow-target', name: 'Visible overflow', hitHidden: false, children: [] }]; const navigate = vi.fn(); mount(node, { onNavigate: navigate }); const element = host.querySelector<HTMLElement>('[data-name="Open detail"]')!, child = host.querySelector<HTMLElement>('[data-name="Visible overflow"]')!; expect(element.getAttribute('role')).toBeNull(); expect(element.tabIndex).toBe(-1); expect(child.tabIndex).toBe(0);
  act(() => child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); expect(navigate).toHaveBeenCalledWith(link, 'overflow-target'); navigate.mockClear(); act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); expect(navigate).not.toHaveBeenCalled();
  parent.hitHidden = false; mount(node, { onNavigate: navigate }); expect(host.querySelector('[data-name="Open detail"]')).toBe(element); expect(element.tabIndex).toBe(0); expect(element.getAttribute('role')).toBe('link');
});

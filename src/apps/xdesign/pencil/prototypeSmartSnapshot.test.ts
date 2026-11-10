import { afterEach, expect, it, vi } from 'vitest';
import { captureSmartLayers } from './prototypeSmartSnapshot';
import { prototypeSnapshot } from './prototypeMotion';
import type { DesignMotion } from './reactExportRuntime';
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const motion: DesignMotion = { version: 1, root: false, type: 'RECTANGLE', shape: 'rectangle', shadow: false, width: 100, height: 100, local: [1, 0, 0, 1, 10, 20], radii: [0, 0, 0, 0], paints: [] };
function layer(name: string, patch: Partial<DesignMotion> = {}) { const element = document.createElement('div'); element.setAttribute('data-xdesign-motion', JSON.stringify({ ...motion, ...patch, name })); element.style.width = `${patch.width ?? motion.width}px`; element.style.height = `${patch.height ?? motion.height}px`; return element; }
it('captures measured rotated/fitted geometry from fractional CSS dimensions and live opacity', () => {
  const surface = document.createElement('div'), scale = document.createElement('div'), element = layer('Card', { width: 25.5, height: 40 }); surface.append(scale); scale.append(element); document.body.append(surface); scale.style.transform = 'matrix(0.5,0,0,0.5,0,0)'; element.style.transform = 'matrix(0,1,-1,0,0,0)'; element.style.opacity = '0.4';
  Object.defineProperty(element, 'offsetWidth', { value: 26 }); vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 200, width: 500, height: 500 } as DOMRect); vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 110, top: 250, width: 20, height: 12.75 } as DOMRect);
  expect(captureSmartLayers(surface)[0]!.pose).toEqual({ matrix: [0, 0.5, -0.5, 0, 30, 50], width: 25.5, height: 40, opacity: 0.4 });
});
it('keeps hierarchy and duplicate ordering, omits hidden trees and uses native geometry when layout measurement is unavailable', () => {
  const surface = document.createElement('div'), root = layer('Screen name', { root: true, local: [1, 0, 0, 1, 0, 0] }), group = layer('Group/1'), a = layer('カード'), b = layer('カード'), hidden = layer('Hidden'); hidden.hidden = true; hidden.append(layer('Ignored')); group.append(a, b, hidden); root.append(group); surface.append(root);
  const snapshots = captureSmartLayers(surface); expect(snapshots.map(state => state.motion.name)).toEqual(['Screen name', 'Group/1', 'カード', 'カード']); expect(snapshots[0]!.key).toBe('/["",0]'); expect(snapshots[2]!.parent).toBe(snapshots[1]!.key); expect(snapshots[2]!.key).not.toBe(snapshots[3]!.key); expect(snapshots[2]!.pose.matrix).toEqual([1, 0, 0, 1, 20, 40]);
});
it('copies current visual layer transforms/opacity and detached pose records without live source identities', () => {
  const surface = document.createElement('div'), element = layer('Layer'); element.setAttribute('data-xdesign-layer', 'live-target'); element.setAttribute('data-xdesign-source', 'native-guid'); element.id = 'original'; element.style.transform = 'matrix(1,0,0,1,35,45)'; element.style.opacity = '0.25'; surface.append(element);
  const copied = prototypeSnapshot(surface), clone = copied.firstElementChild as HTMLElement, state = JSON.parse(clone.getAttribute('data-xdesign-motion-state')!);
  expect(state.pose.opacity).toBe(0.25); expect(clone.style.transform).toBe('matrix(1,0,0,1,35,45)'); expect(clone.style.opacity).toBe('0.25'); expect(copied.querySelector('[id],[data-xdesign-layer],[data-xdesign-source]')).toBeNull(); expect(element.id).toBe('original'); expect(element.getAttribute('data-xdesign-motion-state')).toBeNull(); expect(copied.hasAttribute('inert')).toBe(true);
});
it('handles absent/malformed/non-finite/future metadata and omits unsupported measured transforms', () => {
  const surface = document.createElement('div');
  for (const text of ['bad', JSON.stringify({ ...motion, name: 'Future', version: 2 }), JSON.stringify({ ...motion, name: 'Broken', local: [null, 0, 0, 1, 0, 0] })]) { const element = document.createElement('div'); element.setAttribute('data-xdesign-motion', text); surface.append(element); }
  expect(captureSmartLayers(surface)).toEqual([]); const unsupported = layer('3D'); unsupported.style.transform = 'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)'; surface.append(unsupported); vi.spyOn(unsupported, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect); vi.stubGlobal('DOMMatrixReadOnly', undefined); expect(captureSmartLayers(surface)).toEqual([]);
});
it('ignores accumulated outgoing snapshots while preserving every current screen/overlay layer', () => {
  const surface = document.createElement('div'), old = document.createElement('div'), current = document.createElement('div'), overlay = document.createElement('div'); old.setAttribute('data-xdesign-snapshot', ''); old.append(layer('Stale')); current.setAttribute('data-xdesign-view', ''); overlay.setAttribute('data-xdesign-view', ''); current.append(layer('Current')); overlay.append(layer('Overlay')); surface.append(old, current, overlay);
  expect(captureSmartLayers(surface).map(state => state.motion.name)).toEqual(['Current', 'Overlay']); const copied = prototypeSnapshot(surface); expect(copied.querySelector('[data-xdesign-snapshot]')).toBeNull(); expect([...copied.querySelectorAll('[data-xdesign-motion-state]')].map(element => JSON.parse(element.getAttribute('data-xdesign-motion')!).name)).toEqual(['Current', 'Overlay']);
});
it('retains a live zero width and zero alpha instead of reviving the native model defaults', () => {
  const surface = document.createElement('div'), element = layer('Collapsed'); element.style.width = '0px'; element.style.opacity = '0'; surface.append(element); expect(captureSmartLayers(surface)[0]!.pose).toMatchObject({ width: 0, opacity: 0 });
});
it('normalizes host/window rotation and scaling to local surface coordinates', () => {
  const host = document.createElement('div'), surface = document.createElement('div'), element = layer('Card', { width: 40, height: 20 }); Object.assign(host.style, { transform: 'matrix(0,0.5,-0.5,0,12,34)' }); Object.assign(surface.style, { width: '400px', height: '300px' }); surface.append(element); host.append(surface); document.body.append(host);
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 200, width: 150, height: 200 } as DOMRect); vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left: 210, top: 225, width: 10, height: 20 } as DOMRect);
  expect(captureSmartLayers(surface)[0]!.pose.matrix).toEqual([1, 0, 0, 1, 50, 60]);
});

it('retains wrapper opacity and current corner radii and omits CSS-hidden layers', () => {
  const surface = document.createElement('div'), wrapper = document.createElement('div'), parent = layer('Parent'), inner = document.createElement('div'), child = layer('Child'), hidden = layer('Hidden');
  wrapper.style.opacity = '0.5'; parent.style.opacity = '0.8'; inner.style.opacity = '0.25'; child.style.opacity = '0.6'; child.style.borderRadius = '4px 8px 12px 16px'; hidden.style.visibility = 'hidden'; inner.append(child, hidden); parent.append(inner); wrapper.append(parent); surface.append(wrapper); document.body.append(surface);
  const snapshots = captureSmartLayers(surface); expect(snapshots).toHaveLength(2); expect(snapshots[0]!.pose.opacity).toBeCloseTo(0.4); expect(snapshots[1]!.pose.opacity).toBeCloseTo(0.15); expect(snapshots[1]!.pose.radii).toEqual([4, 8, 12, 16]);
});

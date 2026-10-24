import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LensGeometryEditor, lensPointFromClient } from './LensGeometryEditor';

let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const initial = { constraints: [{ a: [20, 30], b: [180, 60], orientation: 'horizontal' }] };
const render = (wide = true, disabled = false, source: Record<string, unknown> = initial) => {
  const updates = vi.fn();
  function Editor() { const [values, setValues] = useState(source); return <LensGeometryEditor wide={wide} values={values} width={200} height={100} image="source.png" disabled={disabled} change={(key, value) => { updates(key, value); setValues(current => ({ ...current, [key]: value })); }}/>; }
  act(() => root.render(<Editor/>)); return updates;
};
const click = (text: string) => act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === text)!.click());
const pointer = (element: Element, type: string, x: number, y: number, id = 1) => act(() => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }); Object.defineProperty(event, 'pointerId', { value: id }); element.dispatchEvent(event);
});

it('maps contained source pixels through portrait/landscape letterboxing and clamps captured drags', () => {
  expect(lensPointFromClient({ left: 10, top: 20, width: 200, height: 200 }, 400, 200, 60, 95)).toEqual([100, 50]);
  expect(lensPointFromClient({ left: 10, top: 20, width: 200, height: 200 }, 200, 400, 85, 70)).toEqual([50, 100]);
  expect(lensPointFromClient({ left: 0, top: 0, width: 200, height: 100 }, 200, 100, -10, 120)).toEqual([0, 100]);
  expect(lensPointFromClient({ left: 0, top: 0, width: 0, height: 100 }, 200, 100, 10, 10)).toBeUndefined();
});

it('drags only owned endpoints, rolls back cancellation, and preserves original constraints', () => {
  const before = structuredClone(initial), updates = render(), svg = host.querySelector('svg')!;
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 200, height: 100 } as DOMRect);
  pointer(host.querySelector('[aria-label="Constraint 1 start"]')!, 'pointerdown', 30, 50);
  pointer(svg, 'pointermove', 90, 60, 2); expect(updates).not.toHaveBeenCalled();
  pointer(svg, 'pointermove', 90, 60); expect(updates).toHaveBeenLastCalledWith('constraints', [{ a: [80, 40], b: [180, 60], orientation: 'horizontal' }]);
  pointer(svg, 'pointercancel', 90, 60); expect(updates).toHaveBeenLastCalledWith('constraints', initial.constraints);
  expect(initial).toEqual(before);
  pointer(svg, 'pointermove', 100, 70); expect(updates).toHaveBeenCalledTimes(2);
  pointer(host.querySelector('[aria-label="Constraint 1 end"]')!, 'pointerdown', 190, 80);
  pointer(svg, 'pointerup', 150, 90); expect(updates).toHaveBeenLastCalledWith('constraints', [{ a: [20, 30], b: [140, 70], orientation: 'horizontal' }]);
});

it('ignores other pointers cancelling or losing capture while the owned drag finishes or rolls back', () => {
  const updates = render(), svg = host.querySelector('svg')!, captured = new Set<number>();
  svg.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 } as DOMRect);
  svg.setPointerCapture = vi.fn(id => { captured.add(id); });
  svg.hasPointerCapture = vi.fn(id => captured.has(id));
  svg.releasePointerCapture = vi.fn(id => { captured.delete(id); });
  pointer(host.querySelector('[aria-label="Constraint 1 start"]')!, 'pointerdown', 30, 50);
  pointer(svg, 'pointermove', 60, 60);
  const count = updates.mock.calls.length;
  pointer(svg, 'pointercancel', 90, 70, 2); pointer(svg, 'lostpointercapture', 90, 70, 2);
  expect(updates).toHaveBeenCalledTimes(count); expect(captured.has(1)).toBe(true); expect(svg.releasePointerCapture).not.toHaveBeenCalled();
  pointer(svg, 'pointermove', 90, 70); pointer(svg, 'pointerup', 110, 80);
  const finished = [{ a: [100, 60], b: [180, 60], orientation: 'horizontal' }];
  expect(updates).toHaveBeenLastCalledWith('constraints', finished); expect(svg.releasePointerCapture).toHaveBeenCalledTimes(1); expect(svg.releasePointerCapture).toHaveBeenCalledWith(1);
  pointer(host.querySelector('[aria-label="Constraint 1 start"]')!, 'pointerdown', 110, 80, 3);
  pointer(svg, 'pointermove', 140, 100, 3); pointer(svg, 'pointercancel', 140, 100, 3);
  expect(updates).toHaveBeenLastCalledWith('constraints', finished); expect(captured.size).toBe(0); expect(svg.releasePointerCapture).toHaveBeenLastCalledWith(3);
});

it('supports keyboard precision, typed orientation, insertion/removal and fractional drafts', () => {
  const updates = render();
  act(() => host.querySelector('[aria-label="Constraint 1 start"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })));
  expect(updates).toHaveBeenLastCalledWith('constraints', [{ a: [30, 30], b: [180, 60], orientation: 'horizontal' }]);
  act(() => { const input = host.querySelector<HTMLInputElement>('[aria-label="Start X (px)"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '30.125'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(updates).toHaveBeenLastCalledWith('constraints', [{ a: [30.125, 30], b: [180, 60], orientation: 'horizontal' }]);
  expect(host.querySelector<HTMLInputElement>('[aria-label="Start X (px)"]')!.checkValidity()).toBe(true);
  act(() => { const select = host.querySelector<HTMLSelectElement>('[aria-label="Constraint orientation"]')!; select.value = 'vertical'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(updates).toHaveBeenLastCalledWith('constraints', [{ a: [30.125, 30], b: [180, 60], orientation: 'vertical' }]);
  click('Add constraint'); expect((updates.mock.calls.at(-1)![1] as unknown[])).toHaveLength(2);
  click('Remove constraint'); expect(updates).toHaveBeenLastCalledWith('constraints', [{ a: [30.125, 30], b: [180, 60], orientation: 'vertical' }]);
});

it('creates and clears optional straightening without changing manual angle', () => {
  const updates = render(false, false, { angle: 5, straighten: null }); expect(host.querySelectorAll('circle')).toHaveLength(0); expect(updates).not.toHaveBeenCalled(); click('Add straightening line');
  expect(updates).toHaveBeenLastCalledWith('straighten', [[20, 50], [180, 50]]);
  click('Remove straightening line'); expect(updates).toHaveBeenLastCalledWith('straighten', undefined);
});

it('retains unknown fields on every constraint during endpoint and orientation edits', () => {
  const source = { constraints: [{ ...initial.constraints[0], vendor: { serial: [7, 8] } }, { a: [40, 40], b: [160, 70], orientation: 'vertical', imported: 'retained' }] }, before = structuredClone(source);
  const updates = render(true, false, source);
  act(() => host.querySelector('[aria-label="Constraint 1 start"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  expect(updates).toHaveBeenLastCalledWith('constraints', [{ ...source.constraints[0], a: [21, 30] }, source.constraints[1]]);
  act(() => { const input = host.querySelector<HTMLSelectElement>('[aria-label="Constraint orientation"]')!; input.value = 'vertical'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(updates).toHaveBeenLastCalledWith('constraints', [{ ...source.constraints[0], a: [21, 30], orientation: 'vertical' }, source.constraints[1]]);
  expect(source).toEqual(before);
});

it('rejects interaction while disabled and preserves oversized imported arrays', () => {
  const updates = render(true, true);
  pointer(host.querySelector('[aria-label="Constraint 1 start"]')!, 'pointerdown', 20, 30);
  act(() => host.querySelector('[aria-label="Constraint 1 start"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  click('Add constraint'); expect(updates).not.toHaveBeenCalled();
  act(() => root.render(<LensGeometryEditor wide values={{ constraints: Array(129).fill(initial.constraints[0]) }} width={200} height={100} image="source.png" disabled={false} change={updates}/>));
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('128-line'); expect(host.querySelectorAll('circle')).toHaveLength(0); expect(updates).not.toHaveBeenCalled();
});

it('abandons a captured drag after external reset and renders only valid current native curves', () => {
  const updates = vi.fn(), draw = (values: Record<string, unknown>, curves: unknown) => act(() => root.render(<LensGeometryEditor wide values={values} curves={curves} width={200} height={100} image="source.png" disabled={false} change={updates}/>));
  draw(initial, [[[20, 30], [100, 25], [180, 60]]]);
  expect(host.querySelector('polyline')!.getAttribute('points')).toBe('20,30 100,25 180,60');
  const svg = host.querySelector('svg')!; vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 200, height: 100 } as DOMRect);
  pointer(host.querySelector('[aria-label="Constraint 1 start"]')!, 'pointerdown', 20, 30);
  draw({ constraints: [] }, null); pointer(svg, 'pointermove', 80, 40); pointer(svg, 'pointercancel', 80, 40);
  expect(updates).not.toHaveBeenCalled(); expect(host.querySelectorAll('circle')).toHaveLength(0);
  draw(initial, [[[20, 30], [100, Number.NaN]]]); expect(host.querySelector('polyline')).toBeNull(); expect(host.querySelector('line')).not.toBeNull();
});

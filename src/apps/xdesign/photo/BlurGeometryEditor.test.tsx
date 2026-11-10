import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BlurGeometryEditor, blurPointFromClient, type BlurGeometryBounds } from './BlurGeometryEditor';
import type { BlurGeometryMode } from './blurGeometry';

let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const pointer = (element: Element, type: string, x: number, y: number, id = 1) => act(() => { const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }); Object.defineProperty(event, 'pointerId', { value: id }); element.dispatchEvent(event); });
const key = (label: string, key: string, shiftKey = false) => act(() => host.querySelector(`[aria-label="${label}"]`)!.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })));
const click = (label: string) => act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === label || button.getAttribute('aria-label') === label)!.click());
const doubleClick = (element: Element, x: number, y: number) => act(() => element.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true })));
function render(mode: BlurGeometryMode, initial: Record<string, unknown>, bounds?: BlurGeometryBounds) {
  const updates = vi.fn();
  function Editor() { const [values, setValues] = useState(initial); return <BlurGeometryEditor mode={mode} label={mode === 'iris' ? 'Iris Blur' : mode === 'spin' ? 'Spin Blur' : 'Field Blur'} values={values} width={400} height={200} bounds={bounds} image="image.png" sourceKey="v1" disabled={false} change={patch => { updates(patch); setValues(current => ({ ...current, ...patch })); }}/>; }
  act(() => root.render(<Editor/>)); const svg = host.querySelector('svg')!;
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20, width: 400, height: 200 } as DOMRect);
  const capture = new Set<number>(); Object.defineProperties(svg, { setPointerCapture: { value: vi.fn((id: number) => capture.add(id)) }, hasPointerCapture: { value: (id: number) => capture.has(id) }, releasePointerCapture: { value: vi.fn((id: number) => capture.delete(id)) } });
  return { updates, svg, capture };
}

it('maps full-image and selection coordinates through portrait/landscape letterboxing', () => {
  expect(blurPointFromClient({ left: 10, top: 20, width: 200, height: 200 }, 400, 200, { x: 100, y: 50, width: 200, height: 100 }, 110, 120)).toEqual([.5, .5]);
  expect(blurPointFromClient({ left: 10, top: 20, width: 200, height: 200 }, 200, 400, { x: 0, y: 0, width: 200, height: 400 }, 110, 120)).toEqual([.5, .5]);
  expect(blurPointFromClient({ left: 0, top: 0, width: 400, height: 200 }, 400, 200, { x: 100, y: 50, width: 80, height: 40 }, 220, 70)).toEqual([1.5, .5]);
  expect(blurPointFromClient({ left: 0, top: 0, width: 0, height: 0 }, 400, 200, { x: 0, y: 0, width: 400, height: 200 }, 10, 10)).toBeUndefined();
});

it.each(['content', 'source'] as const)('expires an owned pan on %s replacement with the correct viewport lifetime', kind => {
  const updates = vi.fn(), values = { centerX: .5, centerY: .5, blur: 15 }, draw = (sourceKey: string, interactionKey?: string) => act(() => root.render(<BlurGeometryEditor mode="field" label="Field Blur" values={values} width={400} height={200} image={`${sourceKey}/${interactionKey ?? ''}.png`} sourceKey={sourceKey} interactionKey={interactionKey} disabled={false} change={updates}/>));
  draw('document-v1', kind === 'content' ? 'pixels-1' : undefined); const svg = host.querySelector('svg')!; svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 } as DOMRect); const capture = new Set<number>(); svg.setPointerCapture = vi.fn(id => { capture.add(id); }); svg.hasPointerCapture = id => capture.has(id); svg.releasePointerCapture = vi.fn(id => { capture.delete(id); });
  click('Zoom in blur preview'); click('Zoom in blur preview'); click('Zoom in blur preview'); click('Pan preview'); pointer(svg, 'pointerdown', 200, 100); pointer(svg, 'pointermove', 160, 80); const viewport = svg.getAttribute('viewBox'); expect(viewport).not.toBe('0 0 400 200'); expect(capture.has(1)).toBe(true);
  draw(kind === 'source' ? 'document-v2' : 'document-v1', kind === 'content' ? 'pixels-2' : undefined); expect(host.querySelector('svg')).toBe(svg); expect(svg.releasePointerCapture).toHaveBeenCalledOnce(); expect(capture.size).toBe(0); expect(svg.getAttribute('viewBox')).toBe(kind === 'content' ? viewport : '0 0 400 200'); expect(host.querySelector('[aria-label="Blur preview zoom"]')!.textContent).toBe(kind === 'content' ? '8× fit' : '1× fit'); pointer(svg, 'pointermove', 100, 40); expect(svg.getAttribute('viewBox')).toBe(kind === 'content' ? viewport : '0 0 400 200'); expect(updates).not.toHaveBeenCalled();
});

it.each(['drag', 'pan'] as const)('releases the originating SVG capture on %s unmount after its DOM ref is cleared', kind => {
  const { updates, svg, capture } = render('field', { centerX: .5, centerY: .5, blur: 15 }); if (kind === 'pan') { click('Zoom in blur preview'); click('Pan preview'); pointer(svg, 'pointerdown', 210, 120); pointer(svg, 'pointermove', 190, 110); } else { pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 210, 120); pointer(svg, 'pointermove', 230, 130); }
  expect(capture.has(1)).toBe(true); const published = updates.mock.calls.length; act(() => root.render(null)); expect(svg.isConnected).toBe(false); expect(svg.releasePointerCapture).toHaveBeenCalledOnce(); expect(capture.size).toBe(0); expect(updates).toHaveBeenCalledTimes(published); pointer(svg, 'pointermove', 280, 160); expect(updates).toHaveBeenCalledTimes(published);
});

it('moves only an owned selection-relative pin, restores cancellation and preserves caller data', () => {
  const initial = { pins: [{ x: .5, y: .5, blur: 15, note: 'keep' }, { x: .8, y: .3, blur: 9 }] }, before = structuredClone(initial);
  const { updates, svg, capture } = render('field', initial, { x: 100, y: 50, width: 200, height: 100 });
  pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 210, 120);
  pointer(svg, 'pointermove', 250, 140, 2); expect(updates).not.toHaveBeenCalled();
  pointer(svg, 'pointermove', 250, 140); expect(updates).toHaveBeenLastCalledWith({ pins: [{ x: .7, y: .7, blur: 15, note: 'keep' }, initial.pins[1]] });
  pointer(svg, 'pointercancel', 250, 140, 2); expect(capture.has(1)).toBe(true);
  pointer(svg, 'pointercancel', 250, 140); expect(updates).toHaveBeenLastCalledWith({ pins: initial.pins }); expect(capture.size).toBe(0);
  expect(initial).toEqual(before); pointer(svg, 'pointermove', 280, 160); expect(updates).toHaveBeenCalledTimes(2);
});

it('commits pointer release, supports one-pixel keyboard precision and restores amount drags on Escape/blur', () => {
  const { updates, svg } = render('field', { centerX: .5, centerY: .5, blur: 15 });
  key('Field Blur 1 center', 'ArrowRight', true); expect(updates).toHaveBeenLastCalledWith({ centerX: .525, centerY: .5 });
  pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 220, 120);
  pointer(svg, 'pointerup', 240, 140); expect(updates).toHaveBeenLastCalledWith({ centerX: .575, centerY: .6 });
  pointer(host.querySelector('[aria-label="Blur 1"]')!, 'pointerdown', 240, 100); pointer(svg, 'pointermove', 240, 80); expect(updates).toHaveBeenLastCalledWith({ blur: 35 });
  key('Blur 1', 'Escape'); expect(updates).toHaveBeenLastCalledWith({ blur: 15 });
  pointer(host.querySelector('[aria-label="Blur 1"]')!, 'pointerdown', 240, 100); pointer(svg, 'pointermove', 240, 80);
  act(() => window.dispatchEvent(new Event('blur'))); expect(updates).toHaveBeenLastCalledWith({ blur: 15 });
});

it('renders iris axes in shorter-selection-side units, adjusts feather and keeps fractional geometry', () => {
  const { updates } = render('iris', { centerX: .5, centerY: .5, radiusX: .3, radiusY: .2, angle: 90, feather: .5, roundness: 0, blur: 15 }, { x: 100, y: 50, width: 200, height: 100 });
  const radius = host.querySelector('[aria-label="Iris Blur 1 horizontal radius"] circle:last-child')!;
  expect(Number(radius.getAttribute('cx'))).toBeCloseTo(200); expect(Number(radius.getAttribute('cy'))).toBeCloseTo(130);
  key('Iris Blur 1 horizontal radius', 'ArrowDown'); expect(updates).toHaveBeenLastCalledWith({ radiusX: .31 });
  key('Iris Blur 1 feather', 'ArrowDown'); expect(Number(updates.mock.calls.at(-1)![0].feather)).toBeCloseTo(.5 - 1 / 31);
  key('Iris Blur 1 rotation', 'ArrowRight'); expect(updates).toHaveBeenLastCalledWith({ angle: 91 });
});

it('changes spin blur angle without moving or altering other pins', () => {
  const pins = [{ x: .5, y: .5, radiusX: .3, radiusY: .2, angle: 0, blurAngle: 20 }, { x: .1, y: .1, blurAngle: 5 }];
  const { updates } = render('spin', { pins }); key('Spin angle 1', 'ArrowUp', true);
  expect(updates).toHaveBeenLastCalledWith({ pins: [{ ...pins[0], blurAngle: 30 }, pins[1]] });
  expect(host.querySelector('[aria-label="Spin angle 1"]')!.getAttribute('aria-valuenow')).toBe('30');
});

it('edits selected path vertices and speed without flattening multi-path data or allowing another pointer to steal capture', () => {
  const paths = [{ points: [[.1, .2], [.5, .5], [.9, .8]], speed: 50, taper: 2, x: 'metadata' }, { points: [[.2, .3], [.7, .6]], speed: 25, taper: 10 }];
  const { updates, svg } = render('paths', { paths });
  pointer(host.querySelector('[aria-label="Path 1 point 2"]')!, 'pointerdown', 210, 120);
  pointer(host.querySelector('polyline')!, 'pointerdown', 30, 30, 2); pointer(svg, 'pointermove', 250, 140);
  expect(updates).toHaveBeenLastCalledWith({ paths: [{ ...paths[0], points: [[.1, .2], [.6, .6], [.9, .8]] }, paths[1]] });
  pointer(svg, 'pointerup', 250, 140); key('Path speed 1', 'ArrowDown');
  expect(updates.mock.calls.at(-1)![0].paths[0].speed).toBe(49);
  act(() => { const select = host.querySelector<HTMLSelectElement>('[aria-label="Selected blur path"]')!; select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.querySelectorAll('[aria-label^="Path 2 point"]')).toHaveLength(2); expect(host.querySelector('[aria-label="Path 1 point 1"]')).toBeNull();
});

it('keeps tilt focus/transition in the selected operation basis and its angle inside numeric controls', () => {
  const { updates } = render('tilt', { centerX: .5, centerY: .5, angle: 0, focus: .1, transition: .15, blur: 20 }, { x: 100, y: 50, width: 200, height: 100 });
  key('Tilt-Shift focus width', 'ArrowDown'); expect(Number(updates.mock.calls.at(-1)![0].focus)).toBeCloseTo(.11);
  key('Tilt-Shift transition width', 'ArrowDown', true); expect(Number(updates.mock.calls.at(-1)![0].transition)).toBeCloseTo(.25);
  for (let at = 0; at < 10; at++) key('Tilt-Shift rotation', 'ArrowRight', true);
  expect(updates).toHaveBeenLastCalledWith({ angle: -80 });
});

it.each(['reset', 'source', 'busy', 'bounds'] as const)('abandons captured edits after %s replacement without restoring over newer state', reason => {
  const initial = { pins: [{ x: .5, y: .5, blur: 15 }] }, updates = vi.fn();
  const draw = (values = initial, sourceKey = 'v1', disabled = false, bounds?: BlurGeometryBounds) => act(() => root.render(<BlurGeometryEditor mode="field" label="Field Blur" values={values} width={400} height={200} bounds={bounds} sourceKey={sourceKey} image="image.png" disabled={disabled} change={updates}/>));
  draw(); const svg = host.querySelector('svg')!; vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
  pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 200, 100);
  if (reason === 'reset') draw({ pins: [] }); else if (reason === 'source') draw(initial, 'v2'); else if (reason === 'busy') draw(initial, 'v1', true); else draw(initial, 'v1', false, { x: 50, y: 20, width: 200, height: 100 });
  pointer(svg, 'pointermove', 240, 120); pointer(svg, 'pointercancel', 240, 120); expect(updates).not.toHaveBeenCalled();
});

it('preserves empty/malformed/oversized imported lists and blocks disabled or unavailable-image editing', () => {
  const updates = vi.fn();
  for (const values of [{ pins: [] }, { pins: [{ x: 'bad' }] }, { pins: Array(257).fill({ x: .5, y: .5 }) }]) {
    const before = structuredClone(values); act(() => root.render(<BlurGeometryEditor mode="field" label="Field Blur" values={values} width={400} height={200} sourceKey="v1" image="image.png" disabled={false} change={updates}/>));
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelectorAll('[role="button"],[role="slider"]')).toHaveLength(0); expect(values).toEqual(before);
  }
  act(() => root.render(<BlurGeometryEditor mode="field" label="Field Blur" values={{}} width={400} height={200} sourceKey="v1" image="" disabled={false} change={updates}/>));
  expect(host.querySelectorAll('[role="button"],[role="slider"]')).toHaveLength(0);
  act(() => root.render(<BlurGeometryEditor mode="field" label="Field Blur" values={{}} width={400} height={200} sourceKey="v1" image="image.png" disabled change={updates}/>));
  key('Field Blur 1 center', 'ArrowRight'); expect(host.querySelector('[aria-label="Field Blur 1 center"]')!.getAttribute('tabindex')).toBe('-1'); expect(updates).not.toHaveBeenCalled();
});

it.each(['field', 'iris', 'spin'] as const)('adds and deletes %s pins directly while retaining scalar parameters and selecting an adjacent surviving pin', mode => {
  const initial = { centerX: .25, centerY: .4, blur: 20, radiusX: .3, radiusY: .2, angle: 15, blurAngle: 30 };
  const { updates, svg } = render(mode, initial);
  doubleClick(svg, 330, 140);
  const pins = updates.mock.calls.at(-1)![0].pins as { x: number; y: number }[];
  expect(pins).toHaveLength(2); expect(pins[0]).toMatchObject({ x: .25, y: .4 }); expect(pins[1]).toMatchObject({ x: .8, y: .6 });
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Selected blur pin"]')!.value).toBe('1');
  const label = mode === 'iris' ? 'Iris Blur' : mode === 'spin' ? 'Spin Blur' : 'Field Blur';
  key(`${label} 2 center`, 'Delete'); expect(updates.mock.calls.at(-1)![0].pins).toEqual([pins[0]]);
  expect(host.querySelector('[aria-label="Selected blur pin"]')).toBeNull();
  const count = updates.mock.calls.length; key(`${label} 1 center`, 'Backspace'); expect(updates).toHaveBeenCalledTimes(count);
});

it('inserts and removes path vertices on the nearest segment and retains path metadata', () => {
  const paths = [{ points: [[.1, .2], [.9, .8]], speed: 31, taper: 17, x: 'retained' }], before = structuredClone(paths);
  const { updates, svg } = render('paths', { paths }); doubleClick(svg, 210, 120);
  expect(updates).toHaveBeenLastCalledWith({ paths: [{ ...paths[0], points: [[.1, .2], [.5, .5], [.9, .8]] }] });
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Path 1 point 2');
  key('Path 1 point 2', 'Delete'); expect(updates).toHaveBeenLastCalledWith({ paths });
  const count = updates.mock.calls.length; key('Path 1 point 1', 'Delete'); expect(updates).toHaveBeenCalledTimes(count); expect(paths).toEqual(before);
});

it('keeps pointer mapping and source-pixel keyboard steps correct after zoom with stable physical handle size', () => {
  const { updates, svg } = render('field', { centerX: .5, centerY: .5, blur: 15 }); click('Zoom in blur preview');
  expect(svg.getAttribute('viewBox')).toBe('100 50 200 100');
  expect(host.querySelector('[aria-label="Field Blur 1 center"] circle:last-child')!.getAttribute('r')).toBe('2.5');
  pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 210, 120); pointer(svg, 'pointerup', 230, 140);
  expect(updates).toHaveBeenLastCalledWith({ centerX: .525, centerY: .55 });
  key('Field Blur 1 center', 'ArrowRight'); expect(updates).toHaveBeenLastCalledWith({ centerX: .5275, centerY: .55 });
  click('Fit image'); expect(svg.getAttribute('viewBox')).toBe('0 0 400 200');
  expect(host.querySelector('[aria-label="Blur preview zoom"]')!.textContent).toBe('1× fit');
});

it('owns pan gestures, restores cancellation, commits release and keeps filter settings untouched', () => {
  const { updates, svg } = render('field', { centerX: .5, centerY: .5, blur: 15 }); click('Zoom in blur preview'); click('Pan preview');
  pointer(svg, 'pointerdown', 210, 120); pointer(svg, 'pointermove', 250, 140, 2); expect(svg.getAttribute('viewBox')).toBe('100 50 200 100');
  pointer(svg, 'pointermove', 250, 140); expect(svg.getAttribute('viewBox')).toBe('80 40 200 100');
  pointer(svg, 'pointercancel', 250, 140, 2); expect(svg.getAttribute('viewBox')).toBe('80 40 200 100');
  pointer(svg, 'pointercancel', 250, 140); expect(svg.getAttribute('viewBox')).toBe('100 50 200 100');
  pointer(svg, 'pointerdown', 210, 120); pointer(svg, 'pointerup', 250, 140); expect(svg.getAttribute('viewBox')).toBe('80 40 200 100');
  expect(updates).not.toHaveBeenCalled();
});

it('anchors modified-wheel zoom, preserves normal page scrolling and cancels a handle drag before view changes', () => {
  const { updates, svg } = render('field', { centerX: .5, centerY: .5, blur: 15 });
  const normal = new WheelEvent('wheel', { clientX: 110, clientY: 120, deltaY: -10, cancelable: true, bubbles: true }); act(() => svg.dispatchEvent(normal)); expect(normal.defaultPrevented).toBe(false);
  const zoom = new WheelEvent('wheel', { clientX: 110, clientY: 120, deltaY: -Math.log(2) * 100, ctrlKey: true, cancelable: true, bubbles: true }); act(() => svg.dispatchEvent(zoom));
  expect(zoom.defaultPrevented).toBe(true); expect(svg.getAttribute('viewBox')).toBe('50 50 200 100');
  click('Fit image'); pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 210, 120); pointer(svg, 'pointermove', 250, 140);
  expect(updates).toHaveBeenLastCalledWith({ centerX: .6, centerY: .6 }); click('Zoom in blur preview');
  expect(updates).toHaveBeenLastCalledWith({ centerX: .5, centerY: .5 }); const count = updates.mock.calls.length;
  pointer(svg, 'pointermove', 290, 180); pointer(svg, 'pointercancel', 290, 180); expect(updates).toHaveBeenCalledTimes(count);
});

it('clamps stored selection after external deletion and releases edits before topology changes', () => {
  const updates = vi.fn(), pins = [{ x: .2, y: .3 }, { x: .4, y: .5 }, { x: .8, y: .7 }];
  const draw = (values: Record<string, unknown>) => act(() => root.render(<BlurGeometryEditor mode="field" label="Field Blur" values={values} width={400} height={200} sourceKey="v1" image="image.png" disabled={false} change={updates}/>));
  draw({ pins }); act(() => { const select = host.querySelector<HTMLSelectElement>('[aria-label="Selected blur pin"]')!; select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  draw({ pins: [pins[0]] }); draw({ pins }); expect(host.querySelector<HTMLSelectElement>('[aria-label="Selected blur pin"]')!.value).toBe('0');
  const svg = host.querySelector('svg')!; vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
  pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 80, 60); click('Add pin');
  const count = updates.mock.calls.length; pointer(svg, 'pointermove', 100, 80); pointer(svg, 'pointercancel', 100, 80); expect(updates).toHaveBeenCalledTimes(count);
});

it('refuses background creation outside selection, over limits, on handles or while busy', () => {
  const { updates, svg } = render('field', { centerX: .5, centerY: .5 }, { x: 100, y: 50, width: 200, height: 100 });
  doubleClick(svg, 30, 30); doubleClick(host.querySelector('[aria-label="Field Blur 1 center"] circle:last-child')!, 210, 120); expect(updates).not.toHaveBeenCalled();
  act(() => root.render(<BlurGeometryEditor mode="field" label="Field Blur" values={{ pins: Array(256).fill({ x: .5, y: .5 }) }} width={400} height={200} sourceKey="v1" image="image.png" disabled={false} change={updates}/>));
  doubleClick(svg, 210, 120); click('Add pin'); expect(updates).not.toHaveBeenCalled();
  act(() => root.render(<BlurGeometryEditor mode="field" label="Field Blur" values={{}} width={400} height={200} sourceKey="v1" image="image.png" disabled change={updates}/>));
  doubleClick(svg, 210, 120); click('Zoom in blur preview'); expect(updates).not.toHaveBeenCalled();
});

it('supports temporary Space panning and restores viewport cancellation on window blur without filter edits', () => {
  const { updates, svg } = render('field', { centerX: .5, centerY: .5, blur: 15 }); click('Zoom in blur preview'); key('Field Blur preview', ' ');
  pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 210, 120); pointer(svg, 'pointermove', 250, 120);
  expect(svg.getAttribute('viewBox')).toBe('80 50 200 100'); act(() => window.dispatchEvent(new Event('blur')));
  expect(svg.getAttribute('viewBox')).toBe('100 50 200 100'); expect(updates).not.toHaveBeenCalled();
  pointer(svg, 'pointermove', 290, 120); expect(svg.getAttribute('viewBox')).toBe('100 50 200 100');
  key('Field Blur preview', ' ');
  const toolbarButton = host.querySelector<HTMLButtonElement>('[aria-label="Zoom in blur preview"]')!;
  act(() => { toolbarButton.focus(); toolbarButton.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })); });
  pointer(host.querySelector('[aria-label="Field Blur 1 center"]')!, 'pointerdown', 210, 120); pointer(svg, 'pointermove', 250, 120);
  expect(updates).toHaveBeenLastCalledWith({ centerX: .55, centerY: .5 }); expect(svg.getAttribute('viewBox')).toBe('100 50 200 100');
  pointer(svg, 'pointercancel', 250, 120);
});

it('resets view and discards captured pan after source replacement without reviving an earlier source viewport', () => {
  const updates = vi.fn(), values = { centerX: .5, centerY: .5, blur: 15 };
  const draw = (sourceKey: string) => act(() => root.render(<BlurGeometryEditor mode="field" label="Field Blur" values={values} width={400} height={200} sourceKey={sourceKey} image="image.png" disabled={false} change={updates}/>));
  draw('v1'); const svg = host.querySelector('svg')!; vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 400, height: 200 } as DOMRect);
  click('Zoom in blur preview'); click('Pan preview'); pointer(svg, 'pointerdown', 200, 100); pointer(svg, 'pointermove', 240, 120);
  draw('v2'); pointer(svg, 'pointercancel', 240, 120); expect(svg.getAttribute('viewBox')).toBe('0 0 400 200');
  draw('v1'); expect(svg.getAttribute('viewBox')).toBe('0 0 400 200'); expect(updates).not.toHaveBeenCalled();
});

it('reports viewport measurements and density, draws noninteractive source-space tiles and cleans resize observers', () => {
  const change = vi.fn(), viewChange = vi.fn(), disconnect = vi.fn(), observe = vi.fn(); let resized!: () => void;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback; } observe = observe; disconnect = disconnect; });
  vi.stubGlobal('devicePixelRatio', 2);
  const draw = (sourceKey = 'v1') => act(() => root.render(<BlurGeometryEditor mode="field" label="Field Blur" values={{ centerX: .5, centerY: .5, blur: 15 }} width={4096} height={2048} image="base.png" sourceKey={sourceKey} disabled={false} change={change} viewChange={viewChange} tiles={[{ x: 1536, y: 768, width: 512, height: 512, scale: 1, pixelWidth: 512, pixelHeight: 512, url: 'tile.png' }]}/>));
  draw(); const svg = host.querySelector('svg')!;
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 400 } as DOMRect);
  act(() => resized()); expect(viewChange).toHaveBeenLastCalledWith({ x: 0, y: 0, zoom: 1 }, { width: 800, height: 400 }, 2);
  click('Zoom in blur preview'); click('Zoom in blur preview');
  expect(viewChange).toHaveBeenLastCalledWith({ x: 1536, y: 768, zoom: 4 }, { width: 800, height: 400 }, 2);
  const image = host.querySelector<SVGImageElement>('[data-preview-detail]')!;
  expect([image.getAttribute('x'), image.getAttribute('y'), image.getAttribute('width'), image.getAttribute('height')]).toEqual(['1536', '768', '512', '512']);
  expect(image.style.pointerEvents).toBe('none'); expect(image.getAttribute('aria-hidden')).toBe('true'); expect(image.hasAttribute('tabindex')).toBe(false);
  expect(change).not.toHaveBeenCalled(); draw('v2');
  expect(viewChange).toHaveBeenLastCalledWith({ x: 0, y: 0, zoom: 1 }, { width: 800, height: 400 }, 2);
  expect(disconnect).toHaveBeenCalledOnce(); expect(observe).toHaveBeenCalledTimes(2);
});

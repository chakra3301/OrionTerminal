// @vitest-environment node
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { fontManager } from '@open-pencil/core/text';
import { getWorldMatrix, TransformMatrix, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit } from 'canvaskit-wasm';
import { PrototypePreviewDialog } from './PrototypePreviewDialog';
import { usePencilWorkspace } from './runtime';
import { setPrototypeInteractions, setPrototypeStart } from './prototype';
import { setPrototypeScroll } from './prototypeScroll';
import * as exports from './reactExport';
import { renderNativeSceneImage } from './nativeSceneArtwork';
import { cloneDesignSubgraph } from './graphSubset';
import { createComponentProperty, bindComponentProperty } from './componentProperties';
import { setComponentBehaviour } from './behaviour/editor';
import { installSlotSupport, createSlot } from './slots';
import { serializeGraph } from './document';
import { clearXDesignActivities } from '../runtimeActivity';
import { prepareNativeSceneComponents } from './nativeSceneComponents';
import { prepareNativeSceneLayout } from './nativeSceneLayout';
import { prepareGraphFonts } from '@open-pencil/core/text';
import * as playback from './reactExportRuntime';
import { unpackGraph } from './graphPacking';
import { finishNativeSceneControls, prepareNativeSceneControls } from './nativeSceneControls';

type TestDOM = { window: Window & typeof globalThis };
const { JSDOM } = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, options: { pretendToBeVisual: boolean }) => TestDOM };
let kit: CanvasKit, dom: TestDOM, root: Root | undefined, editor: ReturnType<typeof createEditor>, host: HTMLDivElement, frame: SceneNode;
let installedGlyphs: Promise<void> | undefined;
const installedFonts = { 'Heiti TC': '/System/Library/Fonts/STHeiti Medium.ttc', 'Apple Color Emoji': '/System/Library/Fonts/Apple Color Emoji.ttc' } as const;
async function prepareInstalledGlyphs() {
  installedGlyphs ??= (async () => {
    for (const [family, path] of Object.entries(installedFonts)) {
      const bytes = await readFile(path), face = kit.Typeface.MakeFreeTypeFaceFromData(bytes)!;
      try { expect(Array.from(face.getGlyphIDs(family === 'Heiti TC' ? '你好' : '👩🏽🎨'))).not.toContain(0); } finally { face.delete(); }
      await fontManager.loadFont(family, 'Regular'); fontManager.setCJKFallbackFamily(family);
    }
    await fontManager.loadFont('Noto Naskh Arabic', 'Regular'); fontManager.setArabicFallbackFamily('Noto Naskh Arabic');
  })();
  await installedGlyphs;
}
const color = (r = 1, g = 0, b = 0) => [{ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g, b, a: 1 } }];
beforeAll(async () => { kit = await getCanvasKit(); fontManager.setOnlineFontProviders({ google: false, fontshare: false, fontsource: false }); });
beforeEach(() => {
  dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  for (const name of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLVideoElement', 'SVGElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'CompositionEvent'] as const) vi.stubGlobal(name, dom.window[name]);
  vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window)); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // React loaded before this Node DOM uses its legacy input-change path.
  Object.assign(HTMLElement.prototype, { attachEvent() {}, detachEvent() {} });
  fontManager.setHostFontLoader(async (family, style) => {
    if (style !== 'Regular') return null;
    if (family === 'Inter') return fontManager.fetchBundledFont('/Inter-Regular.ttf');
    if (family === 'Noto Naskh Arabic') return fontManager.fetchBundledFont('/NotoNaskhArabic-Regular.ttf');
    const path = installedFonts[family as keyof typeof installedFonts];
    if (!path) return null;
    const bytes = await readFile(path); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  });
  editor = createEditor(); installSlotSupport(editor.graph);
  frame = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Control screen', width: 240, height: 140, fills: [], clipsContent: false, effects: [{ type: 'LAYER_BLUR', visible: true, radius: 3, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } }] });
  setPrototypeStart(editor, frame.id);
});
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; editor.dispose(); usePencilWorkspace.setState({ editor: null }); clearXDesignActivities(); dom.window.close(); fontManager.setHostFontLoader(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const component = (name: string, width = 40, height = 30) => editor.graph.createNode('COMPONENT', editor.state.currentPageId, { name, width, height, fills: [] });
const place = (main: SceneNode, parent = frame.id, x = 10, y = 10) => editor.graph.createInstance(main.id, parent, { x, y })!;
function booleanControl(kind: 'checkbox' | 'switch' | 'toggle' | 'radio') {
  const main = component(kind), mark = editor.graph.createNode('RECTANGLE', main.id, { name: 'Mark', width: 20, height: 20, visible: false, fills: color() });
  const id = createComponentProperty(editor, main, 'Checked', 'BOOLEAN', 'false'); bindComponentProperty(editor, mark, 'VISIBLE', id);
  setComponentBehaviour(editor, main, { kind, values: { value: 'Checked' } }); return main;
}
function slot(main: SceneNode, name: string, width = 180, x = 0, y = 0) {
  const result = editor.graph.createNode('FRAME', main.id, { name, width, height: 24, x, y, fills: [] }); createSlot(editor, result); return result;
}
async function mount() {
  host = document.createElement('div'); host.className = 'xd-pencil'; document.body.append(host);
  const { createRoot } = await import('react-dom/client'); root = createRoot(host); usePencilWorkspace.setState({ editor, busy: false });
  await act(async () => root!.render(<PrototypePreviewDialog close={() => { throw new Error('Unexpected close'); }} />));
  await vi.waitFor(async () => { await act(async () => {}); expect(host.querySelector('.xd-prototype-stage')?.getAttribute('aria-busy')).toBe('false'); }, { timeout: 20000, interval: 10 });
}
function sourceUnchanged(before: string, stage = '') {
  const after = serializeGraph(editor.graph), differences: unknown[] = [];
  const compare = (a: unknown, b: unknown, path: string) => {
    if (differences.length >= 8 || JSON.stringify(a) === JSON.stringify(b)) return;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') { differences.push({ path, before: a, after: b }); return; }
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}/${key}`);
  };
  if (after !== before) compare(JSON.parse(unpackGraph(before).json), JSON.parse(unpackGraph(after).json), 'graph');
  expect(after === before, `${stage}: ${JSON.stringify(differences)}`).toBe(true);
}
const image = () => host.querySelector<HTMLImageElement>('[data-name="Control screen"] > img')!;
const restart = () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Restart')!;
function expected(graph: SceneGraph, node = frame) {
  for (const layer of graph.nodes.values()) layer.pluginData = layer.pluginData.filter(entry => !(entry.pluginId === 'open-pencil' && entry.key === 'behaviour'));
  prepareNativeSceneComponents(graph, [frame.id]);
  const artwork = renderNativeSceneImage(kit, graph, graph.getNode(node.id)!);
  return `data:image/png;base64,${Buffer.from(artwork.bytes).toString('base64')}`;
}
function expectedRoot(graph: SceneGraph, rootId: string) {
  for (const layer of graph.nodes.values()) layer.pluginData = layer.pluginData.filter(entry => !(entry.pluginId === 'open-pencil' && entry.key === 'behaviour'));
  prepareNativeSceneComponents(graph, [rootId]);
  const artwork = renderNativeSceneImage(kit, graph, graph.getNode(rootId)!);
  return `data:image/png;base64,${Buffer.from(artwork.bytes).toString('base64')}`;
}
function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
}
function pointer(element: EventTarget, type: string, id = 7, x = 10) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 10 }); Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'mouse' }, isPrimary: { value: true } }); element.dispatchEvent(event);
}
it.each(['checkbox', 'switch', 'toggle', 'radio'] as const)('updates actual composed %s pixels and retains its focused element through Restart', async kind => {
  const instance = place(booleanControl(kind)), before = serializeGraph(editor.graph); await mount();
  const control = host.querySelector<HTMLElement>('[data-name="Control screen"]')!.querySelector<HTMLButtonElement>(kind === 'toggle' ? '[aria-pressed]' : `[role=${kind}]`)!;
  const initial = image().src; await act(async () => control.focus()); await act(async () => control.click());
  expect(control.isConnected).toBe(true); expect(document.activeElement).toBe(control); expect(control.getAttribute(kind === 'toggle' ? 'aria-pressed' : 'aria-checked')).toBe('true');
  const copy = cloneDesignSubgraph(editor.graph, [frame.id]); copy.getChildren(instance.id)[0]!.visible = true;
  expect(image().src).toBe(expected(copy)); expect(image().src).not.toBe(initial); expect(host.querySelectorAll('[data-xdesign-scene-covered] img')).toHaveLength(0); expect(host.querySelector('[role=alert]')).toBeNull(); sourceUnchanged(before);
  await act(async () => restart().click()); expect(image().src).toBe(initial); expect(host.querySelector<HTMLElement>('[data-name="Control screen"]')!.querySelector(kind === 'toggle' ? '[aria-pressed]' : `[role=${kind}]`)?.getAttribute(kind === 'toggle' ? 'aria-pressed' : 'aria-checked')).toBe('false'); sourceUnchanged(before);
});
it('publishes native hover, press, release and focus variants without replacing the button', async () => {
  const set = editor.graph.createNode('COMPONENT_SET', editor.state.currentPageId, { name: 'Action' });
  set.componentPropertyDefinitions = [{ id: 'state', name: 'State', type: 'VARIANT', defaultValue: 'Rest', variantOptions: ['Rest', 'Hover', 'Pressed', 'Focus'] }];
  const variants = ['Rest', 'Hover', 'Pressed', 'Focus'].map((state, index) => editor.graph.createNode('COMPONENT', set.id, { name: state, width: 80, height: 30, fills: color(index === 0 ? 1 : 0, index === 2 ? 1 : 0, index === 1 || index === 3 ? 1 : 0), componentPropertyValues: { State: state } }));
  setComponentBehaviour(editor, set, { kind: 'button', states: 'State' }); const instance = place(variants[0]!); instance.name = 'Action'; const before = serializeGraph(editor.graph); await mount();
  const control = host.querySelector<HTMLButtonElement>('[aria-label="Action"]')!;
  for (const [event, index] of [['pointerover', 1], ['pointerdown', 2], ['pointerup', 1]] as const) {
    await act(async () => pointer(control, event)); const copy = cloneDesignSubgraph(editor.graph, [frame.id]); copy.swapInstanceComponent(instance.id, variants[index]!.id);
    expect(image().src).toBe(expected(copy)); expect(control.isConnected).toBe(true);
  }
  await act(async () => control.focus()); const copy = cloneDesignSubgraph(editor.graph, [frame.id]); copy.swapInstanceComponent(instance.id, variants[3]!.id); expect(image().src).toBe(expected(copy)); expect(document.activeElement).toBe(control); expect(host.querySelector('[role=alert]')).toBeNull(); sourceUnchanged(before);
});
it('restores native PNG and bound geometry after automatic same-source delay inside a press lease', async () => {
  vi.useFakeTimers();
  const main = component('Held native action'); main.fills = color(0, 0, 1); setComponentBehaviour(editor, main, { kind: 'button' });
  const action = place(main), collection = editor.graph.createCollection('Session'), width = editor.graph.createVariable('Width', 'FLOAT', collection.id, 240);
  editor.graph.bindVariable(frame.id, 'width', width.id);
  setPrototypeInteractions(editor, action, [
    { id: 'press-width', trigger: { type: 'press' }, navigation: { action: 'set-variable', variable: width.id, value: { type: 'literal', value: 280 }, transition: 'instant', duration: 0 } },
    { id: 'delay-width', trigger: { type: 'delay', delay: 100 }, navigation: { action: 'set-variable', variable: width.id, value: { type: 'literal', value: 320 }, transition: 'instant', duration: 0 } },
  ]);
  await Promise.resolve(); const before = serializeGraph(editor.graph); await mount();
  const initial = image().src, screen = host.querySelector<HTMLElement>('.xd-prototype-screen')!, button = host.querySelector<HTMLButtonElement>('[aria-label="Held native action"]')!;
  const referenceAtWidth = (value: number) => { const copy = cloneDesignSubgraph(editor.graph, [frame.id]), target = copy.getNode(frame.id)!; target.width = value; target.boundVariables = {}; return expected(copy); };
  expect(initial).toBe(referenceAtWidth(240)); expect(screen.style.width).toBe('240px');
  await act(async () => pointer(button, 'pointerdown'));
  expect(screen.style.width).toBe('280px'); expect(image().src).toBe(referenceAtWidth(280)); expect(image().src).not.toBe(initial);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.style.width).toBe('320px'); expect(image().src).toBe(referenceAtWidth(320)); expect(image().src).not.toBe(referenceAtWidth(280));
  await act(async () => pointer(document, 'pointerup'));
  expect(screen.style.width).toBe('240px'); expect(image().src).toBe(initial); expect(host.querySelector('[role=alert]')).toBeNull(); sourceUnchanged(before);
});
it('restores native pixels after a press returns to the same authored frame with changed history', async () => {
  const main = component('History action'); main.fills = color(0, 0, 1); setComponentBehaviour(editor, main, { kind: 'button' });
  const action = place(main), other = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Other screen', width: 240, height: 140, fills: [], clipsContent: false, effects: structuredClone(frame.effects) });
  const collection = editor.graph.createCollection('History session'), width = editor.graph.createVariable('Width', 'FLOAT', collection.id, 240);
  editor.graph.bindVariable(frame.id, 'width', width.id); editor.graph.bindVariable(other.id, 'width', width.id);
  const instant = { transition: 'instant' as const, duration: 0 };
  setPrototypeInteractions(editor, action, [
    { id: 'hold-return', trigger: { type: 'press' }, navigation: { ...instant, action: 'sequence', actions: [{ ...instant, action: 'navigate', target: other.id }, { ...instant, action: 'navigate', target: frame.id }] } },
    { id: 'destination-local', trigger: { type: 'click' }, navigation: { ...instant, action: 'set-variable', variable: width.id, value: { type: 'literal', value: 400 } } },
  ]);
  await Promise.resolve(); const before = serializeGraph(editor.graph); await mount();
  const initial = image().src, screen = () => host.querySelector<HTMLElement>('.xd-prototype-screen')!, referenceAtWidth = (value: number) => { const copy = cloneDesignSubgraph(editor.graph, [frame.id]), target = copy.getNode(frame.id)!; target.width = value; target.boundVariables = {}; return expected(copy); };
  expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true); expect(screen().style.width).toBe('240px');
  const source = host.querySelector<HTMLButtonElement>('[aria-label="History action"]')!;
  await act(async () => pointer(source, 'pointerdown'));
  expect(host.querySelector('h2')?.textContent).toBe('Control screen'); expect(screen().style.width).toBe('240px'); expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Back')?.disabled).toBe(false);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="History action"]')!.click());
  expect(screen().style.width).toBe('400px'); expect(image().src).toBe(referenceAtWidth(400)); expect(image().src).not.toBe(initial);
  await act(async () => pointer(document, 'pointerup'));
  expect(host.querySelector('h2')?.textContent).toBe('Control screen'); expect(screen().style.width).toBe('240px'); expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Back')?.disabled).toBe(true);
  expect(image().src).toBe(initial); expect(host.querySelector('[role=alert]')).toBeNull(); sourceUnchanged(before);
});
it('composes a disabled semantic Boolean without a visual property target and refuses clicks', async () => {
  const main = component('Disabled action'); main.fills = color(0, 0, 1); createComponentProperty(editor, main, 'Disabled', 'BOOLEAN', 'true'); setComponentBehaviour(editor, main, { kind: 'button', values: { disabled: 'Disabled' } }); place(main); const before = serializeGraph(editor.graph); await mount();
  const control = host.querySelector<HTMLButtonElement>('[aria-label="Disabled action"]')!; expect(control.disabled).toBe(true); expect(image()).not.toBeNull(); const initial = image().src; await act(async () => control.click()); expect(image().src).toBe(initial); expect(host.textContent).not.toContain('component controls and properties'); sourceUnchanged(before);
});
it.each(['textField', 'textarea', 'numberField'] as const)('keeps the %s caret/input identity while publishing exact current native text', async kind => {
  if (kind !== 'numberField') await prepareInstalledGlyphs();
  const main = component('Field', 180, 44), text = editor.graph.createNode('TEXT', main.id, { name: 'Value', text: 'Hello', fontFamily: 'Inter', width: 170, height: 40, fills: color(0, 0, 1) });
  const value = createComponentProperty(editor, main, 'Value', 'TEXT', 'Hello'); bindComponentProperty(editor, text, 'TEXT', value);
  setComponentBehaviour(editor, main, { kind, values: { [kind === 'numberField' ? 'text' : 'value']: 'Value' }, numbers: kind === 'numberField' ? { value: { min: 0, max: 20, step: 2, default: 12 } } : undefined });
  const instance = place(main), before = serializeGraph(editor.graph); await mount(); expect(image(), host.textContent ?? '').not.toBeNull(); const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')!, initial = image().src;
  await act(async () => field.focus()); if (kind !== 'numberField') field.setSelectionRange(2, 2);
  const next = kind === 'numberField' ? '13' : '你好 👩🏽‍🎨 مرحبا'; await act(async () => { field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); input(field, next); field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: next })); });
  await vi.waitFor(async () => { await act(async () => {}); expect(host.querySelector('[role=alert]')).toBeNull(); expect(image().src).not.toBe(initial); }, { timeout: 20000, interval: 10 });
  expect(field.isConnected).toBe(true); expect(document.activeElement).toBe(field); expect(field.value, host.textContent ?? '').toBe(kind === 'numberField' ? '14' : next);
  const copy = cloneDesignSubgraph(editor.graph, [frame.id]); copy.getChildren(instance.id)[0]!.text = kind === 'numberField' ? '14' : next;
  expect(image().src).toBe(expected(copy)); expect(image().src).not.toBe(initial); expect(host.querySelector('[role=alert]')).toBeNull(); sourceUnchanged(before);
}, 30_000);
it('keeps a slider focused and publishes final thumb/range pixels and semantic dimensions', async () => {
  const main = component('Slider', 200, 40); slot(main, 'Track', 180, 10).fills = color(0, 0, 1); slot(main, 'Thumb', 20).fills = color(); slot(main, 'Range').fills = color(0, 1, 0);
  setComponentBehaviour(editor, main, { kind: 'slider', parts: { track: 'Track', thumb: 'Thumb', range: 'Range' }, numbers: { value: { min: 0, max: 100, step: 10, default: 50 } } });
  const instance = place(main), before = serializeGraph(editor.graph); await mount(); const field = host.querySelector<HTMLInputElement>('input[type=range]')!; await act(async () => field.focus()); await act(async () => input(field, '100'));
  const copy = cloneDesignSubgraph(editor.graph, [frame.id]), parts = copy.getChildren(instance.id); parts[1]!.x = 170; parts[2]!.width = 180;
  expect(image().src).toBe(expected(copy)); expect(host.querySelector<HTMLElement>('[data-name="Thumb"]')!.style.left).toBe('170px'); expect(host.querySelector<HTMLElement>('[data-name="Range"]')!.style.width).toBe('180px'); expect(document.activeElement).toBe(field); sourceUnchanged(before);
});
it('matches independently positioned rotated slider parts to native CanvasKit pixels and settles repeatedly', async () => {
  frame.height = 240;
  const main = component('Affine Slider', 210, 210);
  const trackParent = editor.graph.createNode('FRAME', main.id, { name: 'Track parent', x: 14, y: 18, width: 160, height: 36, rotation: 28, fills: [] });
  const track = slot(trackParent, 'Track', 120, 10, 8); track.height = 8; track.fills = color(0, 0, 1);
  const thumbParent = editor.graph.createNode('FRAME', main.id, { name: 'Thumb parent', x: 90, y: 72, width: 70, height: 42, rotation: -32, flipX: true, fills: [] });
  const thumb = slot(thumbParent, 'Thumb', 18, 22, 11); thumb.width = 18; thumb.height = 18; thumb.fills = color(); thumb.rotation = 12;
  const rangeParent = editor.graph.createNode('FRAME', main.id, { name: 'Range parent', x: 32, y: 126, width: 150, height: 30, rotation: 61, flipY: true, fills: [] });
  const range = slot(rangeParent, 'Range', 90, 4, 8); range.height = 8; range.rotation = -9; range.flipX = true; range.fills = color(0, 1, 0);
  setComponentBehaviour(editor, main, { kind: 'slider', parts: { track: 'Track', thumb: 'Thumb', range: 'Range' }, numbers: { value: { min: 0, max: 100, step: 10, default: 50 } } });
  const instance = place(main, frame.id, 8, 8); instance.name = 'Affine Slider'; await Promise.resolve(); const before = serializeGraph(editor.graph); await mount();
  const field = host.querySelector<HTMLInputElement>('input[type=range]')!; await act(async () => field.focus()); await act(async () => input(field, '80'));

  const copy = cloneDesignSubgraph(editor.graph, [frame.id]), expectedInstance = copy.getNode(instance.id)!;
  const find = (node: SceneNode, name: string): SceneNode | undefined => { if (node.name === name) return node; for (const child of copy.getChildren(node.id)) { const found = find(child, name); if (found) return found; } };
  const expectedTrack = find(expectedInstance, 'Track')!, expectedThumb = find(expectedInstance, 'Thumb')!, expectedRange = find(expectedInstance, 'Range')!, ratio = 0.8;
  const map = (matrix: number[], x: number, y: number) => { const p = TransformMatrix.mapPoints(matrix, [x, y]); return { x: p[0]!, y: p[1]! }; };
  const deltaPosition = (node: SceneNode, target: { x: number; y: number }) => {
    const parent = node.parentId ? getWorldMatrix(copy.getNode(node.parentId)!, copy) : TransformMatrix.identity(), inverse = TransformMatrix.invert(parent)!;
    const current = map(getWorldMatrix(node, copy), 0, 0), delta = map(inverse, target.x - current.x, target.y - current.y), zero = map(inverse, 0, 0);
    node.x += delta.x - zero.x; node.y += delta.y - zero.y;
  };
  const trackWorld = getWorldMatrix(expectedTrack, copy), inverseTrack = TransformMatrix.invert(trackWorld)!;
  const thumbRelative = TransformMatrix.multiply(inverseTrack, getWorldMatrix(expectedThumb, copy));
  const thumbCorners = TransformMatrix.mapPoints(thumbRelative, [0, 0, expectedThumb.width, 0, expectedThumb.width, expectedThumb.height, 0, expectedThumb.height]);
  const thumbXs = [thumbCorners[0]!, thumbCorners[2]!, thumbCorners[4]!, thumbCorners[6]!], origin = map(thumbRelative, 0, 0);
  const span = Math.max(...thumbXs) - Math.min(...thumbXs), leading = Math.min(...thumbXs) - origin.x;
  const thumbTarget = map(trackWorld, -leading + (expectedTrack.width - span) * ratio, origin.y); deltaPosition(expectedThumb, thumbTarget);
  const oldRange = TransformMatrix.multiply(inverseTrack, getWorldMatrix(expectedRange, copy)), authoredRangeOrigin = map(oldRange, 0, 0);
  const expectedRangeParent = expectedRange.parentId ? getWorldMatrix(copy.getNode(expectedRange.parentId)!, copy) : TransformMatrix.identity(), inverseRangeParent = TransformMatrix.invert(expectedRangeParent)!;
  const relative = TransformMatrix.multiply(inverseRangeParent, trackWorld), reflected = relative[0]! * relative[4]! - relative[1]! * relative[3]! < 0;
  expectedRange.rotation = Math.atan2(reflected ? -relative[1]! : relative[3]!, relative[0]!) * 180 / Math.PI;
  expectedRange.flipX = false; expectedRange.flipY = reflected; expectedRange.width = expectedTrack.width * ratio;
  deltaPosition(expectedRange, map(trackWorld, authoredRangeOrigin.x, authoredRangeOrigin.y));
  expect(image().src).toBe(expected(copy)); expect(document.activeElement).toBe(field); expect(host.querySelector('[role=alert]')).toBeNull();
  const stability = cloneDesignSubgraph(editor.graph, [instance.id]); prepareNativeSceneControls(stability, [instance.id], { [JSON.stringify([instance.id])]: { value: 80, state: 'rest' } });
  const settled = serializeGraph(stability); finishNativeSceneControls(stability); expect(serializeGraph(stability)).toBe(settled); sourceUnchanged(before);
});
it('composes externally supplied progress values with matching native and accessible ranges', () => {
  const main = component('Progress', 200, 40); slot(main, 'Track', 200).fills = color(0, 0, 1); slot(main, 'Indicator', 200).fills = color(); setComponentBehaviour(editor, main, { kind: 'progress', parts: { track: 'Track', indicator: 'Indicator' }, numbers: { value: { min: 0, max: 100, step: 10, default: 50 } } });
  const instance = place(main), before = serializeGraph(editor.graph), key = JSON.stringify([frame.id, ['Progress', 0]]);
  for (const value of [0, 50, 100]) {
    const model = exports.selectionToDesignModel(editor.graph, [frame.id], kit, true, undefined, { [key]: { value, state: 'rest' } }, true), copy = cloneDesignSubgraph(editor.graph, [frame.id]); copy.getChildren(instance.id)[1]!.width = 200 * value / 100;
    expect(model.nodes[0]!.image).toBe(expected(copy)); expect(model.nodes[0]!.children[0]!.control!.native!.values.value).toBe(value); expect(model.prototypeIssues).toEqual([]);
  }
  sourceUnchanged(before);
});
it.each(['radioGroup', 'toggleGroup', 'accordion', 'tabs'] as const)('publishes %s selection/content without duplicate composed artwork', async kind => {
  const main = component(kind, 200, 100), items = slot(main, kind === 'tabs' ? 'List' : 'Items');
  let item: SceneNode;
  if (kind === 'accordion') { item = component('Disclosure', 70, 70); slot(item, 'Trigger', 60).fills = color(); slot(item, 'Content', 60, 0, 30).fills = color(0, 0, 1); setComponentBehaviour(editor, item, { kind: 'collapsible', parts: { trigger: 'Trigger', content: 'Content' } }); }
  else item = booleanControl(kind === 'radioGroup' ? 'radio' : 'toggle');
  place(item, items.id, 0, 0); place(item, items.id, 80, 0);
  if (kind === 'tabs') { const panels = slot(main, 'Panels', 180, 0, 70); for (let i = 0; i < 2; i++) editor.graph.createNode('RECTANGLE', panels.id, { name: `Panel ${i}`, width: 160, height: 24, fills: color(i, 0, 1 - i) }); }
  setComponentBehaviour(editor, main, { kind, parts: kind === 'tabs' ? { list: 'List', panels: 'Panels' } : { items: 'Items' } }); const instance = place(main);
  await Promise.resolve();
  const before = serializeGraph(editor.graph); await mount(); sourceUnchanged(before, 'after mount'); const initial = image().src;
  const controls = host.querySelectorAll<HTMLButtonElement>(kind === 'tabs' ? '[role=tab]' : '[data-xdesign-group-item]'); expect(controls).toHaveLength(2); await act(async () => controls[1]!.click());
  sourceUnchanged(before, 'after selection');
  const copy = cloneDesignSubgraph(editor.graph, [frame.id]), parts = copy.getChildren(instance.id), nested = copy.getChildren(parts[0]!.id);
  sourceUnchanged(before, 'after reference clone');
  if (kind === 'accordion') { copy.getChildren(nested[0]!.id)[1]!.visible = false; copy.getChildren(nested[1]!.id)[1]!.visible = true; }
  else nested.forEach((node, i) => { copy.getChildren(node.id)[0]!.visible = i === 1; });
  if (kind === 'tabs') copy.getChildren(parts[1]!.id).forEach((node, i) => { node.visible = i === 1; });
  expect(image().src).toBe(expected(copy)); expect(image().src).not.toBe(initial); expect(host.querySelectorAll('[data-xdesign-scene-covered] img')).toHaveLength(0); expect(host.querySelector('[role=alert]')).toBeNull(); sourceUnchanged(before);
});
it('retains focus and old artwork during async edits, cancels obsolete preparation and publishes the latest value', async () => {
  const main = component('Field', 180, 44), text = editor.graph.createNode('TEXT', main.id, { name: 'Value', text: 'Hello', fontFamily: 'Inter', width: 170, height: 40 }); const value = createComponentProperty(editor, main, 'Value', 'TEXT', 'Hello'); bindComponentProperty(editor, text, 'TEXT', value); setComponentBehaviour(editor, main, { kind: 'textField', values: { value: 'Value' } }); const instance = place(main), before = serializeGraph(editor.graph); await mount(); const field = host.querySelector<HTMLInputElement>('input')!; await act(async () => field.focus()); const initial = image().src;
  let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }), original = exports.prepareDesignModelFonts; vi.spyOn(exports, 'prepareDesignModelFonts').mockImplementation(async (...args) => { await wait; return original(...args); }); const capture = vi.spyOn(exports, 'selectionToDesignModel');
  await act(async () => input(field, 'First')); await act(async () => input(field, 'Latest')); expect(field.disabled).toBe(false); expect(document.activeElement).toBe(field); expect(image().src).toBe(initial); expect(capture).not.toHaveBeenCalled();
  await act(async () => release()); expect(capture).toHaveBeenCalledTimes(1); const copy = cloneDesignSubgraph(editor.graph, [frame.id]); copy.getChildren(instance.id)[0]!.text = 'Latest'; expect(image().src).toBe(expected(copy)); expect(field.value).toBe('Latest'); expect(field.isConnected).toBe(true); expect(document.activeElement).toBe(field); sourceUnchanged(before);
});
it('rolls back a failed control publication without blurring the surviving input, then accepts another edit', async () => {
  place(booleanControl('checkbox')); await mount(); const control = host.querySelector<HTMLButtonElement>('[role=checkbox]')!; await act(async () => control.focus()); const initial = image().src, original = exports.selectionToDesignModel; const spy = vi.spyOn(exports, 'selectionToDesignModel').mockImplementation(() => { throw new Error('Control capture failed'); });
  await act(async () => control.click()); expect(image().src).toBe(initial); expect(control.getAttribute('aria-checked')).toBe('false'); expect(document.activeElement).toBe(control); expect(host.querySelector('[role=alert]')?.textContent).toContain('Control capture failed');
  spy.mockImplementation(original); await act(async () => control.click()); expect(control.getAttribute('aria-checked')).toBe('true'); expect(image().src).not.toBe(initial); expect(host.querySelector('[role=alert]')).toBeNull();
});
it.each(['direct', 'conditional'] as const)('restores controls and variables after temporary navigation and discards destination edits (%s)', async kind => {
  const checkbox = booleanControl('checkbox'); place(checkbox);
  const main = component('Temporary action'); main.fills = color(0, 0, 1); setComponentBehaviour(editor, main, { kind: 'button' }); const action = place(main, frame.id, 100);
  const target = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Temporary screen', width: 240, height: 140, fills: [] }); place(checkbox, target.id);
  const collection = editor.graph.createCollection('Session'), width = editor.graph.createVariable('Width', 'FLOAT', collection.id, 240); editor.graph.bindVariable(frame.id, 'width', width.id); editor.graph.bindVariable(target.id, 'width', width.id);
  setPrototypeInteractions(editor, action, [{ id: 'held', trigger: { type: 'press' }, navigation: { action: 'navigate', target: target.id, transition: 'instant', duration: 0 } }, { id: 'open', trigger: { type: 'click' }, navigation: { action: 'navigate', target: target.id, transition: 'instant', duration: 0 } }]);
  const trigger = editor.graph.createNode('RECTANGLE', target.id, { name: 'Grow', x: 100, y: 60, width: 20, height: 20, fills: color() }); setPrototypeInteractions(editor, trigger, [{ id: 'grow', trigger: { type: 'click' }, navigation: kind === 'direct' ? { action: 'set-variable', variable: width.id, value: { type: 'literal', value: 300 }, transition: 'instant', duration: 0 } : { action: 'conditional', transition: 'instant', duration: 0, branches: [{ condition: { type: 'literal', value: false }, actions: [{ action: 'navigate', target: frame.id, transition: 'instant', duration: 0 }] }, { actions: [{ action: 'set-variable', variable: width.id, value: { type: 'literal', value: 300 }, transition: 'instant', duration: 0 }] }] } }]);
  const before = serializeGraph(editor.graph); await mount(); await act(async () => host.querySelector<HTMLButtonElement>('[role=checkbox]')!.click()); const initial = image().src;
  const execution = vi.spyOn(playback, 'executeDesignActions'), button = host.querySelector<HTMLButtonElement>('[aria-label="Temporary action"]')!;
  expect(button.disabled).toBe(false); expect(button.closest('[inert]')).toBeNull();
  await act(async () => pointer(button, 'pointerdown')); expect(execution).toHaveBeenCalled(); expect(execution.mock.calls.at(-1)?.[0]).toMatchObject({ target: target.id }); expect(host.querySelector('h2')!.textContent, host.textContent ?? '').toBe('Temporary screen');
  await act(async () => host.querySelector<HTMLButtonElement>('[role=checkbox]')!.click()); await act(async () => host.querySelector<HTMLElement>('[data-name="Grow"]')!.click()); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')!.style.width).toBe('300px');
  await act(async () => pointer(document, 'pointerup')); expect(host.querySelector('h2')!.textContent).toBe('Control screen'); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')!.style.width).toBe('240px'); expect(host.querySelector('[role=checkbox]')!.getAttribute('aria-checked')).toBe('true'); expect(image().src).toBe(initial);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Temporary action"]')!.click()); expect(host.querySelector('[role=checkbox]')!.getAttribute('aria-checked')).toBe('false'); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')!.style.width).toBe('240px'); sourceUnchanged(before);
});
it('isolates repeated native overlay instances through temporary restore, close and reopen pixels', async () => {
  const checkbox = booleanControl('checkbox');
  const overlay = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Repeated modal', width: 120, height: 100, fills: color(0, 0, 1) });
  const nativeGroup = editor.graph.createNode('FRAME', overlay.id, { name: 'Native controls', x: 4, y: 4, width: 72, height: 52, fills: [], effects: structuredClone(frame.effects) });
  const modalCheck = place(checkbox, nativeGroup.id, 0, 0);
  const modalCheckAgain = place(checkbox, nativeGroup.id, 32, 0);
  const scroll = editor.graph.createNode('FRAME', overlay.id, { name: 'Modal scroll', x: 82, y: 4, width: 30, height: 42, fills: [] });
  setPrototypeScroll(editor, scroll, { axis: 'vertical' }); editor.graph.createNode('RECTANGLE', scroll.id, { name: 'Scrollable content', y: 100, width: 28, height: 12, fills: color(0, 1, 0) });
  const actionMain = component('Open modal', 60, 26); actionMain.fills = color(1, 1, 0); setComponentBehaviour(editor, actionMain, { kind: 'button' });
  const homeAction = place(actionMain, frame.id, 12, 70), modalAction = place(actionMain, overlay.id, 12, 60);
  const open = { action: 'overlay' as const, target: overlay.id, transition: 'instant' as const, duration: 0 };
  const invalid = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Invalid modal destination', width: 0, height: 80 });
  const invalidSwap = editor.graph.createNode('RECTANGLE', overlay.id, { name: 'Swap invalid', x: 80, y: 70, width: 20, height: 12, fills: color(1, 0, 0) });
  setPrototypeInteractions(editor, invalidSwap, [{ id: 'bad-swap', trigger: { type: 'click' }, navigation: { action: 'swap', target: invalid.id, transition: 'instant', duration: 0 } }]);
  const leave = editor.graph.createNode('RECTANGLE', overlay.id, { name: 'Leave modal', x: 104, y: 70, width: 12, height: 12, fills: color(0, 1, 0) });
  setPrototypeInteractions(editor, leave, [{ id: 'leave', trigger: { type: 'click' }, navigation: { action: 'navigate', target: frame.id, transition: 'instant', duration: 0 } }]);
  setPrototypeInteractions(editor, homeAction, [{ id: 'open', trigger: { type: 'click' }, navigation: open }]);
  setPrototypeInteractions(editor, modalAction, [
    { id: 'open-again', trigger: { type: 'click' }, navigation: open },
    { id: 'temporary', trigger: { type: 'press' }, navigation: open },
  ]);
  await Promise.resolve(); const before = serializeGraph(editor.graph); await mount();
  const modalImage = (index: number) => host.querySelectorAll<HTMLImageElement>('.xd-prototype-overlay-frame [data-name="Native controls"] > img')[index]!;
  const modalControl = (index: number) => host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame')[index]!.querySelector<HTMLElement>('[role=checkbox]')!;
  const modalScroll = (index: number) => host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame [data-xdesign-scroll]')[index]!;
  const setScroll = (element: HTMLElement, top: number) => { element.scrollTop = top; element.dispatchEvent(new Event('scroll', { bubbles: true })); };
  const setCheckedReference = (checked: boolean, checkedAgain = false) => {
    const copy = cloneDesignSubgraph(editor.graph, [nativeGroup.id]);
    if (checked) copy.getChildren(modalCheck.id)[0]!.visible = true;
    if (checkedAgain) copy.getChildren(modalCheckAgain.id)[0]!.visible = true;
    return expectedRoot(copy, nativeGroup.id);
  };
  const baseOpen = host.querySelector<HTMLButtonElement>('[aria-label="Open modal"]')!;
  await act(async () => baseOpen.click());
  expect(modalImage(0).src).toBe(setCheckedReference(false));
  const firstCheckbox = modalControl(0), firstOpen = host.querySelectorAll<HTMLButtonElement>('.xd-prototype-overlay-frame [aria-label="Open modal"]')[0]!;
  const firstOpenLayerId = firstOpen.getAttribute('data-xdesign-layer');
  setScroll(modalScroll(0), 17); expect(modalScroll(0).scrollTop).toBe(17);
  await act(async () => firstCheckbox.click());
  const checkedPng = setCheckedReference(true);
  expect(modalImage(0).src).toBe(checkedPng); expect(firstCheckbox.getAttribute('aria-checked')).toBe('true');
  await act(async () => firstOpen.focus());
  await act(async () => pointer(firstOpen, 'pointerdown'));
  expect(host.querySelectorAll('.xd-prototype-overlay-frame')).toHaveLength(2);
  const temporaryCheckbox = modalControl(1); expect(temporaryCheckbox.getAttribute('aria-checked')).toBe('false');
  expect(modalScroll(1).getAttribute('data-xdesign-scroll')).not.toBe(modalScroll(0).getAttribute('data-xdesign-scroll')); expect(modalScroll(1).scrollTop).toBe(0);
  setScroll(modalScroll(1), 9); expect(modalScroll(0).scrollTop).toBe(17);
  expect(modalImage(1).src).toBe(setCheckedReference(false));
  await act(async () => pointer(document, 'pointerup'));
  expect(host.querySelectorAll('.xd-prototype-overlay-frame')).toHaveLength(1);
  expect(modalControl(0).getAttribute('aria-checked')).toBe('true'); expect(modalImage(0).src).toBe(checkedPng);
  expect(modalScroll(0).scrollTop).toBe(17);
  expect(document.activeElement?.closest('[data-xdesign-layer]')?.getAttribute('data-xdesign-layer')).toBe(firstOpenLayerId);
  await act(async () => host.querySelectorAll<HTMLButtonElement>('.xd-prototype-overlay-frame [aria-label="Open modal"]')[0]!.click());
  expect(host.querySelectorAll('.xd-prototype-overlay-frame')).toHaveLength(2);
  const secondCheckbox = modalControl(1); expect(secondCheckbox.getAttribute('aria-checked')).toBe('false'); expect(modalImage(1).src).toBe(setCheckedReference(false));
  expect(modalScroll(1).scrollTop).toBe(0);
  expect(secondCheckbox.getAttribute('data-xdesign-layer')).not.toBe(firstCheckbox.getAttribute('data-xdesign-layer'));
  await act(async () => secondCheckbox.click()); expect(modalImage(1).src).toBe(checkedPng);
  expect(modalImage(0).src).toBe(checkedPng);
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Close overlay')!.click());
  expect(modalControl(0).getAttribute('aria-checked')).toBe('true'); expect(modalImage(0).src).toBe(checkedPng);
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Close overlay')!.click());
  expect(host.querySelectorAll('.xd-prototype-overlay-frame')).toHaveLength(0);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open modal"]')!.click()); expect(modalControl(0).getAttribute('aria-checked')).toBe('false'); expect(modalImage(0).src).toBe(setCheckedReference(false));
  expect(modalScroll(0).scrollTop).toBe(17);
  const failedFirst = modalControl(0), failedSecond = host.querySelectorAll<HTMLElement>('.xd-prototype-overlay-frame')[0]!.querySelectorAll<HTMLElement>('[role=checkbox]')[1]!;
  await act(async () => failedFirst.click()); expect(modalImage(0).src).toBe(setCheckedReference(true));
  await act(async () => host.querySelector<HTMLElement>('[data-name="Swap invalid"]')!.click());
  expect(host.querySelector('[role=alert]')?.textContent).toContain('positive');
  expect(host.querySelector('.xd-prototype-stage')?.getAttribute('aria-busy')).toBe('false');
  expect(failedFirst.getAttribute('aria-checked')).toBe('true');
  await act(async () => failedSecond.click());
  expect(failedFirst.getAttribute('aria-checked')).toBe('true'); expect(failedSecond.getAttribute('aria-checked')).toBe('true');
  expect(modalImage(0).src).toBe(setCheckedReference(true, true));
  expect(host.querySelector('.xd-prototype-stage')?.getAttribute('aria-busy')).toBe('false');
  await act(async () => host.querySelector<HTMLElement>('[data-name="Leave modal"]')!.click());
  expect(host.querySelectorAll('.xd-prototype-overlay-frame')).toHaveLength(0);
  expect(host.querySelector('h2')?.textContent).toBe('Control screen');
  expect(host.querySelector('.xd-prototype-stage')?.getAttribute('aria-busy')).toBe('false');
  expect(host.querySelector('[role=alert]')).toBeNull(); sourceUnchanged(before);
});
it('resets native controls on Restart while an old preparation is pending', async () => {
  place(booleanControl('checkbox')); await mount(); const initial = image().src; let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }), original = exports.prepareDesignModelFonts;
  let pending = true; vi.spyOn(exports, 'prepareDesignModelFonts').mockImplementation(async (...args) => { if (pending) await wait; return original(...args); });
  await act(async () => host.querySelector<HTMLButtonElement>('[role=checkbox]')!.click()); expect(image().src).toBe(initial); pending = false; await act(async () => restart().click()); await act(async () => release());
  expect(host.querySelector('[role=checkbox]')!.getAttribute('aria-checked')).toBe('false'); expect(image().src).toBe(initial); expect(host.querySelector('[role=alert]')).toBeNull();
});
it('clips native controls and removes fully masked keyboard targets across value updates and Restart', async () => {
  editor.graph.createNode('ELLIPSE', frame.id, { name: 'Coverage', width: 60, height: 60, isMask: true, maskType: 'ALPHA', fills: color(1, 1, 1) });
  const main = booleanControl('checkbox'), visible = place(main, frame.id, 30), hidden = place(main, frame.id, 110); await Promise.resolve();
  const before = serializeGraph(editor.graph); await mount(); const initial = image().src;
  const controls = host.querySelectorAll<HTMLButtonElement>('[role=checkbox]'); expect(controls).toHaveLength(1); expect(controls[0]!.closest('[data-xdesign-mask]')).not.toBeNull();
  await act(async () => controls[0]!.focus()); await act(async () => controls[0]!.click());
  const copy = cloneDesignSubgraph(editor.graph, [frame.id]); copy.getChildren(visible.id)[0]!.visible = true;
  expect(image().src).toBe(expected(copy)); expect(image().src).not.toBe(initial); expect(document.activeElement).toBe(controls[0]);
  expect(host.querySelector(`[data-xdesign-source="${hidden.id}"]`)).toBeNull(); expect(host.querySelector('[role=alert]')).toBeNull(); sourceUnchanged(before);
  await act(async () => restart().click()); expect(image().src).toBe(initial); expect(host.querySelectorAll('[role=checkbox]')).toHaveLength(1); sourceUnchanged(before);
});
it('finds masks inside a live variant and clips its nested control semantics with the same native pixels', async () => {
  frame.effects = [];
  const main = component('Disclosure', 200, 100); slot(main, 'Trigger', 180).fills = color(0, 0, 1); const content = slot(main, 'Content', 180, 0, 30);
  const open = createComponentProperty(editor, main, 'Open', 'BOOLEAN', 'true'); bindComponentProperty(editor, content, 'VISIBLE', open);
  editor.graph.createNode('ELLIPSE', content.id, { name: 'Coverage', width: 60, height: 50, isMask: true, maskType: 'ALPHA', fills: color(1, 1, 1) });
  const item = booleanControl('checkbox'); place(item, content.id, 20, 0); place(item, content.id, 110, 0);
  setComponentBehaviour(editor, main, { kind: 'collapsible', values: { open: 'Open' }, parts: { trigger: 'Trigger', content: 'Content' } }); const instance = place(main); await Promise.resolve();
  const before = serializeGraph(editor.graph); await mount(); const controls = host.querySelectorAll<HTMLButtonElement>('[role=checkbox]'); expect(controls).toHaveLength(1);
  const contentImage = () => host.querySelector<HTMLImageElement>('[data-name=Content] > img')!; const initial = contentImage().src;
  await act(async () => controls[0]!.click()); const copy = cloneDesignSubgraph(editor.graph, [frame.id]), privateContent = copy.getChildren(instance.id)[1]!;
  copy.getChildren(copy.getChildren(privateContent.id)[1]!.id)[0]!.visible = true;
  expect(contentImage().src).toBe(expected(copy, privateContent)); expect(contentImage().src).not.toBe(initial); expect(host.querySelector('[role=alert]')).toBeNull(); sourceUnchanged(before);
});
it.each(['commit', 'rollback', 'cancel'] as const)('uses actual native pixels and restores control/variable checkpoints after a drag %s', async mode => {
  const checkbox = booleanControl('checkbox'); place(checkbox); const actionMain = component('Drag action'); actionMain.fills = color(0, 0, 1); setComponentBehaviour(editor, actionMain, { kind: 'button' }); const action = place(actionMain, frame.id, 100);
  const destination = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Destination', width: 240, height: 140, fills: [], effects: structuredClone(frame.effects), clipsContent: false }); place(checkbox, destination.id);
  const collection = editor.graph.createCollection('Session'), width = editor.graph.createVariable('Width', 'FLOAT', collection.id, 240); editor.graph.bindVariable(frame.id, 'width', width.id); editor.graph.bindVariable(destination.id, 'width', width.id);
  setPrototypeInteractions(editor, action, [{ id: 'drag', trigger: { type: 'drag' }, navigation: { action: 'sequence', transition: 'instant', duration: 0, actions: [{ action: 'set-variable', variable: width.id, value: { type: 'literal', value: 360 }, transition: 'instant', duration: 0 }, { action: 'navigate', target: destination.id, transition: 'instant', duration: 0 }] } }]); await Promise.resolve();
  const before = serializeGraph(editor.graph); await mount(); await act(async () => host.querySelector<HTMLButtonElement>('[role=checkbox]')!.click()); const initial = image().src;
  const pointerAt = (target: EventTarget, type: string, x: number, time: number) => { const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 20 }); Object.defineProperties(event, { pointerId: { value: 9 }, pointerType: { value: 'mouse' }, timeStamp: { value: time } }); target.dispatchEvent(event); };
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Drag action"]')!; await act(async () => pointerAt(button, 'pointerdown', 20, 0)); await act(async () => pointerAt(document, 'pointermove', mode === 'commit' ? 260 : 40, 1000));
  expect(host.querySelector('h2')!.textContent).toBe('Destination'); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')!.style.width).toBe('360px');
  await act(async () => pointerAt(document, mode === 'cancel' ? 'pointercancel' : 'pointerup', mode === 'commit' ? 260 : 40, 2000));
  expect(host.querySelector('h2')!.textContent).toBe(mode === 'commit' ? 'Destination' : 'Control screen');
  if (mode === 'commit') {
    const copy = cloneDesignSubgraph(editor.graph, [destination.id]); copy.getNode(destination.id)!.width = 360; copy.getNode(destination.id)!.boundVariables = {};
    for (const node of copy.nodes.values()) node.pluginData = node.pluginData.filter(entry => !(entry.pluginId === 'open-pencil' && entry.key === 'behaviour'));
    prepareNativeSceneComponents(copy, [destination.id]); const artwork = renderNativeSceneImage(kit, copy, copy.getNode(destination.id)!);
    expect(host.querySelector<HTMLImageElement>('[data-name=Destination] > img')!.src).toBe(`data:image/png;base64,${Buffer.from(artwork.bytes).toString('base64')}`); expect(host.querySelector('[role=checkbox]')!.getAttribute('aria-checked')).toBe('false');
  } else { expect(image().src).toBe(initial); expect(host.querySelector('[role=checkbox]')!.getAttribute('aria-checked')).toBe('true'); expect(host.querySelector<HTMLElement>('.xd-prototype-screen')!.style.width).toBe('240px'); }
  expect(host.querySelector('[data-xdesign-snapshot]')).toBeNull(); expect(host.querySelector('[role=alert]')).toBeNull(); sourceUnchanged(before);
});
it.each(['COMPONENT', 'COMPONENT_SET'] as const)('prepares a fresh %s root snapshot before fonts, native layout and capture', async type => {
  const set = editor.graph.createNode('COMPONENT_SET', editor.state.currentPageId, { name: 'Field set', width: 900, height: 300 });
  set.componentPropertyDefinitions = [{ id: 'state', name: 'State', type: 'VARIANT', defaultValue: 'Rest', variantOptions: ['Rest', 'Focus'] }];
  const variants = ['Rest', 'Focus'].map((state, index) => {
    const main = editor.graph.createNode('COMPONENT', set.id, { name: state, width: index ? 280 : 200, height: 50, fills: [], effects: structuredClone(frame.effects), componentPropertyValues: { State: state }, componentPropertyDefinitions: [{ id: `value-${index}`, name: 'Value', type: 'TEXT', defaultValue: 'Hello' }], layoutMode: 'HORIZONTAL', primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED', counterAxisAlign: 'MIN', paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4, itemSpacing: 8 });
    editor.graph.createNode('TEXT', main.id, { name: 'Value', text: 'Hello', fontFamily: 'Inter', width: 80, height: 24, componentPropertyReferences: [{ propertyId: `value-${index}`, field: 'TEXT' }], fills: color(0, 0, 1) });
    editor.graph.createNode('RECTANGLE', main.id, { name: 'Flexible', width: 20, height: 24, layoutGrow: 1, fills: color() });
    return main;
  });
  setComponentBehaviour(editor, set, { kind: 'textField', states: 'State', values: { value: 'Value' } });
  const selected = type === 'COMPONENT' ? variants[0]! : set; if (type === 'COMPONENT') selected.rotation = 90;
  await Promise.resolve(); const before = serializeGraph(editor.graph), key = JSON.stringify([selected.id]);
  const capture = async (value: string) => {
    const controls: playback.DesignControlSession = { [key]: { value, state: 'focus' } };
    await exports.prepareDesignModelFonts(editor.graph, [selected.id], undefined, controls);
    const model = exports.selectionToDesignModel(editor.graph, [selected.id], kit, true, undefined, controls, true), node = model.nodes[0]!, control = node.control!, visual = control.variants[0]!.tree;
    expect(node.id).toBe(selected.id); expect(node.sourceId).toBe(selected.id); expect(control.native?.key).toBe(key); expect(control.playback).toEqual({ value, state: 'focus' }); expect(control.defaults.value).toBe('Hello');
    expect(model.prototypeIssues).toEqual([]); expect(visual.children.find(child => child.name === 'Value')?.text).toBe(value); expect(visual.children.find(child => child.name === 'Flexible')?.style).toMatchObject({ left: 92, width: 184 });
    expect(model.width).toBeCloseTo(type === 'COMPONENT' ? 50 : 280); expect(model.height).toBeCloseTo(type === 'COMPONENT' ? 280 : 50);
    const copy = cloneDesignSubgraph(editor.graph, [selected.id]), instance = copy.createInstance(variants[0]!.id, editor.state.currentPageId, { x: 0, y: 0 })!;
    copy.swapInstanceComponent(instance.id, variants[1]!.id); instance.componentPropertyAssignments = { 'value-1': value };
    for (const layer of copy.nodes.values()) layer.pluginData = layer.pluginData.filter(entry => !(entry.pluginId === 'open-pencil' && entry.key === 'behaviour'));
    prepareNativeSceneComponents(copy, [instance.id]); await prepareGraphFonts(copy, [instance.id]); expect(prepareNativeSceneLayout(kit, copy, [instance.id]).issue).toBeUndefined();
    const artwork = renderNativeSceneImage(kit, copy, instance); expect(visual.image).toBe(`data:image/png;base64,${Buffer.from(artwork.bytes).toString('base64')}`);
    sourceUnchanged(before); return visual.image;
  };
  expect(await capture('Latest')).not.toBe(await capture('Changed'));
});

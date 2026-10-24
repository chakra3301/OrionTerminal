import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { transform } from 'sucrase';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { computeAllLayouts } from '@open-pencil/core/layout';
import { getNodeLocalMatrix, type SceneNode } from '@open-pencil/scene-graph';
import { constrainedChildRect } from '@open-pencil/scene-graph/resize';
import { cloneReactExportGraph, selectionToDesignModel, selectionToReact } from './reactExport';
import type { DesignNode, DesignProps } from './reactExportRuntime';
import { serializeGraph } from './document';
import { installSlotSupport } from './slots';
import { setComponentBehaviour } from './behaviour/editor';
import { setPrototypeScroll, setScrollBehaviour } from './prototypeScroll';
import { placePreparedVideo } from './videoPaints';

type Size = { width: number; height: number };
type Axis = 'HORIZONTAL' | 'VERTICAL';
type Constraint = 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'SCALE';
const constraints: Constraint[] = ['MIN', 'CENTER', 'MAX', 'STRETCH', 'SCALE'];
const authored = { width: 80, height: 80 }, childRect = { x: 8, y: 6, width: 20, height: 12 };
const paint = [{ type: 'SOLID' as const, visible: true, opacity: 1, color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } }];
let editor: Editor, host: HTMLDivElement, root: Root;
let observers: FakeResizeObserver[];

class FakeResizeObserver {
  readonly targets = new Set<Element>();
  readonly observe = vi.fn((target: Element, _options?: ResizeObserverOptions) => { this.targets.add(target); });
  readonly unobserve = vi.fn((target: Element) => { this.targets.delete(target); });
  readonly disconnect = vi.fn(() => this.targets.clear());
  constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
  deliver(target: Element, size: Size | null, legacy = false) {
    const borderBoxSize = size ? { inlineSize: size.width, blockSize: size.height } : undefined;
    const entry = { target, borderBoxSize: legacy ? borderBoxSize : borderBoxSize ? [borderBoxSize] : undefined, contentRect: { width: 999, height: 777 } } as unknown as ResizeObserverEntry;
    act(() => this.callback([entry], this as unknown as ResizeObserver));
  }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('matchMedia', () => ({ matches: false }));
  observers = []; vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  editor = createEditor(); installSlotSupport(editor.graph);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); editor.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const element = (name: string) => host.querySelector<HTMLElement>(`[data-name="${name}"]`)!;
const viewport = (node: SceneNode) => host.querySelector<HTMLElement>(`[aria-label="${node.name} scroll area"]`)!;
const pixels = (node: HTMLElement) => ['left', 'top', 'width', 'height'].map(key => Number.parseFloat(node.style[key as 'left']));
function observerFor(target: HTMLElement) { const observer = observers.find(observer => observer.targets.has(target)); expect(observer).toBeDefined(); return observer!; }
function dimensions(node: HTMLElement, width: number, height: number) {
  for (const [key, value] of Object.entries({ clientWidth: width, clientHeight: height, scrollWidth: 1000, scrollHeight: 1000 })) Object.defineProperty(node, key, { configurable: true, value });
}
function fixture(axis: Axis, stretch = false) {
  const graph = editor.graph, frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Flex root', width: 300, height: 220, layoutMode: axis, counterAxisAlign: stretch ? 'STRETCH' : 'MIN', primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED', fills: [] });
  graph.createNode('FRAME', frame.id, { name: 'Fixed sibling', width: 60, height: 60, fills: [] });
  const flex = graph.createNode('FRAME', frame.id, { name: 'Measured frame', ...authored, layoutGrow: 1, layoutMode: 'NONE', primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED', fills: [] });
  const children = constraints.map(constraint => graph.createNode('RECTANGLE', flex.id, { name: `Axis ${constraint}`, ...childRect, horizontalConstraint: constraint, verticalConstraint: constraint, layoutPositioning: 'ABSOLUTE', fills: paint }));
  return { frame, flex, children };
}
function compile(frame: SceneNode) {
  const source = serializeGraph(editor.graph), images = [...editor.graph.images].map(([hash, bytes]) => [hash, [...bytes]]);
  const initial = cloneReactExportGraph(editor.graph, [frame.id]); computeAllLayouts(initial, frame.id);
  const initialSize = (id: string): Size => { const node = initial.getNode(id)!; return { width: node.width, height: node.height }; };
  const model = selectionToDesignModel(editor.graph, [frame.id]), modelBytes = JSON.stringify(model);
  expect(model.prototypeIssues).toEqual([]);
  const layers = (nodes: DesignNode[]): DesignNode[] => nodes.flatMap(node => [node, ...layers(node.children)]);
  const idFor = (source: SceneNode) => { const node = layers(model.nodes).find(node => node.name === source.name); expect(node).toBeDefined(); return node!.id; };
  const exported = selectionToReact(editor.graph, [frame.id]);
  type Delivered = { default: React.ComponentType<DesignProps>; DesignView: React.ComponentType<DesignProps & { nodes: DesignNode[]; width: number; height: number }> };
  const delivered = {} as Delivered;
  const code = transform(exported.code, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'automatic', production: true }).code;
  new Function('require', 'exports', code)((id: string) => { if (id === 'react') return React; if (id === 'react/jsx-runtime') return jsxRuntime; throw new Error(`Unexpected export dependency: ${id}`); }, delivered);
  const unchanged = () => { expect(serializeGraph(editor.graph)).toBe(source); expect([...editor.graph.images].map(([hash, bytes]) => [hash, [...bytes]])).toEqual(images); expect(JSON.stringify(model)).toBe(modelBytes); };
  const render = (props: DesignProps = {}) => act(() => root.render(React.createElement(delivered.default, props)));
  // Lifecycle fixtures feed exported SDK models through the runtime delivered in this same module.
  const renderModel = (nodes: DesignNode[], props: DesignProps = {}) => act(() => root.render(React.createElement(delivered.DesignView, { nodes, width: model.width, height: model.height, prototypeVariables: model.prototypeVariables, ...props })));
  unchanged(); return { model, render, renderModel, unchanged, initialSize, idFor, code: exported.code };
}
function expectedRect(constraint: Constraint, size: Size) { return constrainedChildRect(childRect, authored, size, constraint, constraint); }
function expectConstraints(size: Size) { for (const constraint of constraints) { const rect = expectedRect(constraint, size); expect(pixels(element(`Axis ${constraint}`))).toEqual([rect.x, rect.y, rect.width, rect.height]); } }
function mapNodes(nodes: DesignNode[], change: (node: DesignNode) => DesignNode): DesignNode[] { return nodes.map(node => change({ ...node, children: mapNodes(node.children, change) })); }
function expectCorners(node: HTMLElement, expected: SceneNode) {
  const width = Number.parseFloat(node.style.width), height = Number.parseFloat(node.style.height), css = node.style.transform ? node.style.transform.slice(7, -1).split(',').map(Number) : [1, 0, 0, 1, 0, 0];
  const origin = node.style.transformOrigin.split(/\s+/), coordinate = (value: string | undefined, size: number) => value ? Number.parseFloat(value) * (value.endsWith('%') ? size / 100 : 1) : 0;
  const ox = coordinate(origin[0], width), oy = coordinate(origin[1], height), left = Number.parseFloat(node.style.left) || 0, top = Number.parseFloat(node.style.top) || 0, matrix = getNodeLocalMatrix(expected);
  for (const [x, y] of [[0, 0], [width, 0], [width, height], [0, height]]) {
    expect(left + ox + css[0]! * (x! - ox) + css[2]! * (y! - oy) + css[4]!).toBeCloseTo(matrix[0]! * x! + matrix[1]! * y! + matrix[2]!, 8);
    expect(top + oy + css[1]! * (x! - ox) + css[3]! * (y! - oy) + css[5]!).toBeCloseTo(matrix[3]! * x! + matrix[4]! * y! + matrix[5]!, 8);
  }
}

it.each(['HORIZONTAL', 'VERTICAL'] as const)('executes generated %s flex growth with public constraint oracles at zero, initial, two and repeated measures', axis => {
  const { frame, flex } = fixture(axis), exported = compile(frame); exported.render();
  const target = element(flex.name), observer = observerFor(target), identities = constraints.map(constraint => element(`Axis ${constraint}`));
  const registration = () => { expect(target.getAttribute('data-xdesign-layer')).toBe(exported.idFor(flex)); expect(target.getAttribute('data-xdesign-source')).toBeNull(); };
  expectConstraints(exported.initialSize(flex.id)); registration(); expect(observer.observe).toHaveBeenCalledExactlyOnceWith(target, { box: 'border-box' });
  const sizes = [{ width: 0, height: 0 }, axis === 'HORIZONTAL' ? { width: 160, height: 80 } : { width: 80, height: 160 }, axis === 'HORIZONTAL' ? { width: 240, height: 80 } : { width: 80, height: 240 }];
  for (const size of [...sizes, sizes[1]!, sizes[1]!]) { observer.deliver(target, size); expectConstraints(size); registration(); expect(element(flex.name)).toBe(target); constraints.forEach((constraint, index) => expect(element(`Axis ${constraint}`)).toBe(identities[index])); }
  expect(observers).toHaveLength(1); expect(observer.disconnect).not.toHaveBeenCalled(); exported.unchanged();
});

it.each(['HORIZONTAL', 'VERTICAL'] as const)('uses locally measured cross-stretched %s frame dimensions without changing the exported flex DOM', axis => {
  const { frame, flex } = fixture(axis, true), exported = compile(frame); exported.render(); const target = element(flex.name), observer = observerFor(target), parent = target.parentElement;
  for (const size of [{ width: 160, height: 120 }, { width: 240, height: 160 }, { width: 160, height: 120 }]) { observer.deliver(target, size); expectConstraints(size); expect(target.parentElement).toBe(parent); }
  expect(target.style.flexGrow).toBe('1'); expect(target.style[axis === 'HORIZONTAL' ? 'width' : 'height']).toBe('0px'); expect(target.querySelectorAll('[data-name]')).toHaveLength(5); exported.unchanged();
});

it('keeps live explicit variable positions and dimensions ahead of measured constraints in the real generated component', () => {
  const { frame, flex } = fixture('HORIZONTAL'), graph = editor.graph, collection = graph.createCollection('Explicit measured child');
  const left = graph.createVariable('Left', 'FLOAT', collection.id, 7), width = graph.createVariable('Width', 'FLOAT', collection.id, 33);
  const explicit = graph.createNode('RECTANGLE', flex.id, { name: 'Bound child', ...childRect, horizontalConstraint: 'SCALE', verticalConstraint: 'STRETCH', fills: paint });
  graph.bindVariable(explicit.id, 'x', left.id); graph.bindVariable(explicit.id, 'width', width.id);
  const exported = compile(frame); exported.render(); const target = element(flex.name), observer = observerFor(target), child = element(explicit.name);
  observer.deliver(target, { width: 160, height: 120 }); const first = constrainedChildRect(childRect, authored, { width: 160, height: 120 }, 'SCALE', 'STRETCH'); expect(pixels(child)).toEqual([7, first.y, 33, first.height]);
  exported.render({ prototypeSession: { values: { [left.id]: 13, [width.id]: 49 }, modes: {} } });
  observer.deliver(target, { width: 240, height: 160 }); const second = constrainedChildRect(childRect, authored, { width: 240, height: 160 }, 'SCALE', 'STRETCH'); expect(pixels(child)).toEqual([13, second.y, 49, second.height]); expect(element(explicit.name)).toBe(child); expect(observers).toHaveLength(1); exported.unchanged();
});

it.each(['HORIZONTAL', 'VERTICAL'] as const)('forwards a live %s cross-size binding while retaining the observer and actual frame element', axis => {
  const { frame, flex } = fixture(axis), graph = editor.graph, collection = graph.createCollection('Measured cross size'), variable = graph.createVariable('Cross size', 'FLOAT', collection.id, 90);
  graph.bindVariable(flex.id, axis === 'HORIZONTAL' ? 'height' : 'width', variable.id);
  const exported = compile(frame); exported.render(); const target = element(flex.name), observer = observerFor(target), cross = axis === 'HORIZONTAL' ? 'height' : 'width', main = axis === 'HORIZONTAL' ? 'width' : 'height';
  for (const value of [90, 130, 90]) {
    exported.render({ prototypeSession: { values: { [variable.id]: value }, modes: {} } });
    expect(target.style[cross]).toBe(`${value}px`); expect(target.style[main]).toBe('0px');
    const size = axis === 'HORIZONTAL' ? { width: 160, height: value } : { width: value, height: 160 }; observer.deliver(target, size); expectConstraints(size);
    expect(element(flex.name)).toBe(target); expect(observerFor(target)).toBe(observer); expect(observers).toHaveLength(1);
  }
  expect(observer.disconnect).not.toHaveBeenCalled(); exported.unchanged();
});

it('measures the reflected rotated local border box and offset fallback instead of its transformed client rectangle', () => {
  const { frame, flex, children } = fixture('HORIZONTAL'), graph = editor.graph; Object.assign(flex, { rotation: 31, flipX: true }); const transformed = children[3]!; Object.assign(transformed, { rotation: -23, flipY: true });
  const independent = cloneReactExportGraph(graph, [frame.id]), exported = compile(frame); exported.render(); const target = element(flex.name), observer = observerFor(target), transform = target.style.transform;
  const screen = vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ left: -400, top: 300, width: 900, height: 700 } as DOMRect);
  observer.deliver(target, { width: 160, height: 120 }, true); expectConstraints({ width: 160, height: 120 }); const expected = independent.getNode(transformed.id)!; Object.assign(expected, constrainedChildRect(childRect, authored, { width: 160, height: 120 }, 'STRETCH', 'STRETCH')); expectCorners(element(transformed.name), expected);
  Object.defineProperties(target, { offsetWidth: { configurable: true, value: 240 }, offsetHeight: { configurable: true, value: 160 } }); observer.deliver(target, null); expectConstraints({ width: 240, height: 160 }); Object.assign(expected, constrainedChildRect(childRect, authored, { width: 240, height: 160 }, 'STRETCH', 'STRETCH')); expectCorners(element(transformed.name), expected);
  expect(screen).not.toHaveBeenCalled(); expect(target.style.transform).toBe(transform); exported.unchanged();
});

it('uses a real initial offset measurement and cleans window fallback when ResizeObserver is unavailable', () => {
  vi.stubGlobal('ResizeObserver', undefined); const { frame, flex } = fixture('HORIZONTAL'); let size = { width: 160, height: 80 };
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('data-name') === flex.name ? size.width : 0; });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('data-name') === flex.name ? size.height : 0; });
  const exported = compile(frame), remove = vi.spyOn(window, 'removeEventListener'); exported.render(); expectConstraints(size); size = { width: 240, height: 120 }; act(() => window.dispatchEvent(new Event('resize'))); expectConstraints(size);
  act(() => root.render(null)); expect(remove.mock.calls.some(([type]) => type === 'resize')).toBe(true); act(() => window.dispatchEvent(new Event('resize'))); expect(host.childElementCount).toBe(0); expect(observers).toHaveLength(0); exported.unchanged();
});

it.each([true, false])('accepts a real zero local offset box with ResizeObserver available=%s without reading transformed dimensions', observed => {
  if (!observed) vi.stubGlobal('ResizeObserver', undefined);
  const { frame, flex } = fixture('HORIZONTAL'), exported = compile(frame); exported.render(); const target = element(flex.name);
  expectConstraints(exported.initialSize(flex.id));
  const client = vi.spyOn(target, 'getBoundingClientRect').mockImplementation(() => { throw new Error('Transformed dimensions must not be read'); });
  vi.spyOn(target, 'getClientRects').mockReturnValue({ length: 1, item: () => null, [Symbol.iterator]: function* () {} } as DOMRectList);
  if (observed) observerFor(target).deliver(target, null); else act(() => window.dispatchEvent(new Event('resize')));
  expectConstraints({ width: 0, height: 0 }); expect(client).not.toHaveBeenCalled(); exported.unchanged();
});

it('propagates measured geometry through immediate fixed and sticky children while preserving nested scroller ownership', () => {
  const { frame, flex } = fixture('HORIZONTAL'), graph = editor.graph;
  // Editor metadata commands settle flow layout; author the scroll subtree before inserting it.
  graph.reparentNode(flex.id, editor.state.currentPageId); setPrototypeScroll(editor, flex, { axis: 'both' });
  const fixed = graph.createNode('RECTANGLE', flex.id, { name: 'Outer fixed', ...childRect, horizontalConstraint: 'MAX', verticalConstraint: 'MAX', fills: paint }); setScrollBehaviour(editor, fixed, 'fixed');
  const sticky = graph.createNode('RECTANGLE', flex.id, { name: 'Outer sticky', x: 12, y: 14, width: 10, height: 8, fills: paint }); setScrollBehaviour(editor, sticky, 'sticky');
  const nested = graph.createNode('FRAME', flex.id, { name: 'Nested scroller', x: 10, y: 20, width: 40, height: 30, horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH', fills: [] }); setPrototypeScroll(editor, nested, { axis: 'both' });
  const inner = graph.createNode('RECTANGLE', nested.id, { name: 'Inner sticky', x: 5, y: 6, width: 10, height: 8, horizontalConstraint: 'MAX', verticalConstraint: 'MAX', fills: paint }); setScrollBehaviour(editor, inner, 'sticky');
  const innerFixed = graph.createNode('RECTANGLE', nested.id, { name: 'Inner fixed', x: 4, y: 3, width: 9, height: 7, horizontalConstraint: 'MAX', verticalConstraint: 'MIN', fills: paint }); setScrollBehaviour(editor, innerFixed, 'fixed');
  graph.reparentNode(flex.id, frame.id); expect({ width: flex.width, height: flex.height }).toEqual(authored); expect({ x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height }).toEqual(childRect);
  const exported = compile(frame); exported.render(); const target = element(flex.name), observer = observerFor(target), outerScroll = viewport(flex), innerScroll = viewport(nested); observer.deliver(target, { width: 160, height: 120 }); dimensions(outerScroll, 160, 120); dimensions(innerScroll, 120, 70);
  const outerRect = constrainedChildRect(childRect, authored, { width: 160, height: 120 }, 'MAX', 'MAX'); expect(pixels(element(fixed.name))).toEqual([outerRect.x, outerRect.y, outerRect.width, outerRect.height]);
  const nestedRect = constrainedChildRect({ x: 10, y: 20, width: 40, height: 30 }, authored, { width: 160, height: 120 }, 'STRETCH', 'STRETCH'), innerRect = constrainedChildRect({ x: 5, y: 6, width: 10, height: 8 }, { width: 40, height: 30 }, nestedRect, 'MAX', 'MAX'); expect(pixels(element(inner.name))).toEqual([innerRect.x, innerRect.y, innerRect.width, innerRect.height]);
  Object.defineProperties(element(sticky.name), { offsetLeft: { value: 12 }, offsetTop: { value: 14 } }); Object.defineProperties(element(inner.name), { offsetLeft: { value: 5 }, offsetTop: { value: 6 } }); const innerBefore = element(inner.name).style.transform; outerScroll.scrollLeft = 20; outerScroll.scrollTop = 40; act(() => outerScroll.dispatchEvent(new Event('scroll')));
  expect(element(sticky.name).style.transform.trim()).toBe('translate(8px,26px)'); expect(element(inner.name).style.transform).toBe(innerBefore); expect(host.querySelector<HTMLElement>(`[data-xdesign-fixed="${exported.idFor(fixed)}"]`)!.style.transform).toBe('translate(20px,40px)');
  innerScroll.scrollLeft = 15; innerScroll.scrollTop = 25; act(() => innerScroll.dispatchEvent(new Event('scroll'))); expect(element(inner.name).style.transform.trim()).toBe('translate(10px,19px)'); expect(element(sticky.name).style.transform.trim()).toBe('translate(8px,26px)'); expect(host.querySelector<HTMLElement>(`[data-xdesign-fixed="${exported.idFor(innerFixed)}"]`)!.style.transform).toBe('translate(15px,25px)');
  observer.deliver(target, { width: 240, height: 160 }); expect([outerScroll.scrollLeft, outerScroll.scrollTop, innerScroll.scrollLeft, innerScroll.scrollTop]).toEqual([20, 40, 15, 25]); expect(viewport(flex)).toBe(outerScroll); expect(viewport(nested)).toBe(innerScroll); expect(observers).toHaveLength(1); exported.unchanged();
});

it('retains generated media and keyed measurements through reorders and rejects detached callbacks after hide, replacement and unmount', () => {
  const mediaId = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Stable measured media', width: 20, height: 12, duration: 3 }, 3, 4);
  const { frame, flex } = fixture('HORIZONTAL'), graph = editor.graph;
  const other = graph.createNode('FRAME', frame.id, { name: 'Other measured', ...authored, layoutGrow: 1, fills: [] }); graph.createNode('RECTANGLE', other.id, { name: 'Other constrained', ...childRect, horizontalConstraint: 'STRETCH', fills: paint });
  graph.reparentNode(mediaId, flex.id); expect({ width: flex.width, height: flex.height }).toEqual(authored);
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const exported = compile(frame), originalModel = exported.model.nodes; exported.renderModel(originalModel); const target = element(flex.name), otherTarget = element(other.name), observer = observerFor(target), otherObserver = observerFor(otherTarget), video = host.querySelector('video')!; video.currentTime = 2.25;
  observer.deliver(target, { width: 160, height: 80 }); otherObserver.deliver(otherTarget, { width: 200, height: 80 }); const source = video.getAttribute('src'), poster = video.getAttribute('poster');
  const reordered = mapNodes(originalModel, node => node.id === exported.idFor(frame) ? { ...node, children: [...node.children].reverse() } : node); exported.renderModel(reordered, { values: { unrelated: true } });
  expect(element(flex.name)).toBe(target); expect(element(other.name)).toBe(otherTarget); expect(host.querySelector('video')).toBe(video); expect(video.currentTime).toBe(2.25); expect([video.getAttribute('src'), video.getAttribute('poster')]).toEqual([source, poster]); expect(pause).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); expect(observers).toHaveLength(2);
  const hidden = mapNodes(reordered, node => node.id === exported.idFor(flex) ? { ...node, visible: false } : node); exported.renderModel(hidden); expect(observer.disconnect).toHaveBeenCalledOnce(); expect(target.isConnected).toBe(false); const beforeOther = element('Other constrained').style.cssText; observer.deliver(target, { width: 999, height: 999 }); expect(element('Other constrained').style.cssText).toBe(beforeOther); expect(pause).toHaveBeenCalledOnce(); expect(load).toHaveBeenCalledOnce();
  exported.renderModel(reordered); const current = element(flex.name), currentObserver = observerFor(current); expect(current).not.toBe(target); expectConstraints(exported.initialSize(flex.id)); currentObserver.deliver(current, { width: 240, height: 80 });
  const replacement = mapNodes(reordered, node => node.id === exported.idFor(flex) ? { ...node, id: `${node.id}-replacement` } : node); exported.renderModel(replacement); const replacementTarget = element(flex.name), replacementObserver = observerFor(replacementTarget); expect(currentObserver.disconnect).toHaveBeenCalledOnce(); expectConstraints(exported.initialSize(flex.id)); currentObserver.deliver(current, { width: 1, height: 1 }); expectConstraints(exported.initialSize(flex.id)); replacementObserver.deliver(replacementTarget, { width: 160, height: 80 }); expectConstraints({ width: 160, height: 80 });
  const count = observers.length; act(() => root.render(null)); expect(replacementObserver.disconnect).toHaveBeenCalledOnce(); expect(otherObserver.disconnect).toHaveBeenCalledOnce(); replacementObserver.deliver(replacementTarget, { width: 500, height: 500 }); otherObserver.deliver(otherTarget, { width: 600, height: 600 }); expect(host.childElementCount).toBe(0); expect(observers).toHaveLength(count); exported.unchanged();
});

it('replaces a same-ID SDK model baseline without retaining its old measure or accepting queued observer replies', () => {
  const { frame, flex } = fixture('HORIZONTAL'), exported = compile(frame); exported.renderModel(exported.model.nodes);
  const target = element(flex.name), originalObserver = observerFor(target); originalObserver.deliver(target, { width: 160, height: 80 });
  const changedSource = cloneReactExportGraph(editor.graph, [frame.id]); changedSource.getNode(frame.id)!.width = 380;
  const independent = cloneReactExportGraph(changedSource, [frame.id]); computeAllLayouts(independent, frame.id); const grown = independent.getNode(flex.id)!;
  const next = selectionToDesignModel(changedSource, [frame.id]), nextBytes = JSON.stringify(next); expect(next.prototypeIssues).toEqual([]);
  exported.renderModel(next.nodes); expect(element(flex.name)).toBe(target); expect(originalObserver.disconnect).toHaveBeenCalledOnce(); expectConstraints(grown);
  const currentObserver = observerFor(target); expect(currentObserver).not.toBe(originalObserver); originalObserver.deliver(target, { width: 1, height: 1 }); expectConstraints(grown);
  currentObserver.deliver(target, { width: 240, height: 80 }); expectConstraints({ width: 240, height: 80 }); expect(JSON.stringify(next)).toBe(nextBytes); exported.unchanged();
});

it.each(['group', 'hug', 'grid', 'control', 'baked', 'effect', 'mask'] as const)('keeps the guarded %s family refused rather than measuring unsupported portable content', family => {
  const { frame, flex } = fixture('HORIZONTAL'), graph = editor.graph;
  if (family === 'group' || family === 'control') { const replacement = graph.createNode(family === 'group' ? 'GROUP' : 'COMPONENT', frame.id, { name: 'Unsupported growing owner', ...authored, layoutGrow: 1, fills: [] }); graph.createNode('RECTANGLE', replacement.id, { ...childRect, horizontalConstraint: 'STRETCH', fills: paint }); if (family === 'control') setComponentBehaviour(editor, replacement, { kind: 'button' }); }
  if (family === 'hug') flex.primaryAxisSizing = 'HUG';
  if (family === 'grid') flex.layoutMode = 'GRID';
  if (family === 'baked') graph.createNode('ELLIPSE', flex.id, { ...childRect, horizontalConstraint: 'STRETCH', fills: paint, arcData: { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 } });
  if (family === 'effect') flex.effects = [{ type: 'DROP_SHADOW', visible: true, radius: 2, spread: 0, offset: { x: 1, y: 1 }, color: { r: 0, g: 0, b: 0, a: 0.5 } }];
  if (family === 'mask') flex.isMask = true;
  const source = serializeGraph(graph); expect(() => selectionToReact(graph, [frame.id])).toThrow(); expect(serializeGraph(graph)).toBe(source);
});

const nestedAuthored = { width: 100, height: 80 };
type NestedFixture = ReturnType<typeof nestedFixture>;
function nestedFixture(outerAxis: Axis, innerAxis: Axis, between = false, scrolling = false) {
  const graph = editor.graph, inner = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Own layout measured Frame', ...nestedAuthored, layoutMode: innerAxis, layoutGrow: 1,
    primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED', layoutWrap: 'NO_WRAP', counterAxisAlign: 'MIN', primaryAxisAlign: between ? 'SPACE_BETWEEN' : 'MIN',
    paddingTop: 6, paddingRight: 8, paddingBottom: 10, paddingLeft: 12, itemSpacing: 11, counterAxisSpacing: 7, minWidth: 40, maxWidth: 600, minHeight: 40, maxHeight: 500, fills: [] });
  if (scrolling) setPrototypeScroll(editor, inner, { axis: 'both' });
  const flow = [28, 20, 16].map((main, index) => graph.createNode('RECTANGLE', inner.id, { name: `Own flow ${index}`, width: innerAxis === 'HORIZONTAL' ? main : 16, height: innerAxis === 'HORIZONTAL' ? 16 : main,
    layoutGrow: between || index === 0 ? 0 : index, layoutAlignSelf: 'MIN', fills: paint }));
  const specs = innerAxis === 'HORIZONTAL' ? [
    { constraint: 'STRETCH' as const, x: 8, y: 60, width: 20, height: 8 }, { constraint: 'MAX' as const, x: 8, y: 40, width: 20, height: 8 },
  ] : [
    { constraint: 'STRETCH' as const, x: 80, y: 8, width: 8, height: 20 }, { constraint: 'MAX' as const, x: 60, y: 8, width: 8, height: 20 },
  ];
  const absolute = specs.map(({ constraint, ...rect }) => graph.createNode('RECTANGLE', inner.id, { name: `Own absolute ${constraint}`, ...rect, horizontalConstraint: constraint, verticalConstraint: constraint, layoutPositioning: 'ABSOLUTE', fills: paint }));
  if (scrolling) setScrollBehaviour(editor, absolute[1]!, 'fixed');
  const frame = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Own layout outer', width: 440, height: 300, layoutMode: outerAxis, primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED', layoutWrap: 'NO_WRAP', counterAxisAlign: 'STRETCH', itemSpacing: 10, fills: [] });
  const fixed = graph.createNode('RECTANGLE', frame.id, { name: 'Own outer fixed', width: outerAxis === 'HORIZONTAL' ? 60 : 20, height: outerAxis === 'HORIZONTAL' ? 20 : 60, layoutAlignSelf: 'MIN', fills: paint });
  graph.reparentNode(inner.id, frame.id);
  const weighted = graph.createNode('RECTANGLE', frame.id, { name: 'Own outer weighted peer', width: 20, height: 20, layoutGrow: 2, layoutAlignSelf: 'MIN', fills: paint });
  expect({ width: inner.width, height: inner.height }).toEqual(nestedAuthored);
  return { frame, inner, outerAxis, innerAxis, between, flow, absolute, specs, fixed, weighted };
}
function expectNestedConstraints(fixture: NestedFixture, size: Size) {
  fixture.absolute.forEach((child, index) => {
    const specification = fixture.specs[index]!, expected = constrainedChildRect(specification, nestedAuthored, size, specification.constraint, specification.constraint);
    expect(pixels(element(child.name)), `${fixture.outerAxis}/${fixture.innerAxis}/${specification.constraint}`).toEqual([expected.x, expected.y, expected.width, expected.height]);
  });
}
function independentNestedLayout(fixture: NestedFixture, size: Size) {
  const copy = cloneReactExportGraph(editor.graph, [fixture.inner.id]), inner = copy.getNode(fixture.inner.id)!;
  copy.reparentNode(inner.id, copy.getPages()[0]!.id); Object.assign(inner, size, { layoutGrow: 0, minWidth: null, minHeight: null });
  computeAllLayouts(copy, inner.id); return copy;
}

it.each((['HORIZONTAL', 'VERTICAL'] as const).flatMap(outerAxis => (['HORIZONTAL', 'VERTICAL'] as const).flatMap(innerAxis => [false, true].map(between => ({ outerAxis, innerAxis, between })))))('executes nested $outerAxis/$innerAxis fixed own layout, padding, weighted flow and between=$between from actual generated code', ({ outerAxis, innerAxis, between }) => {
  const fixture = nestedFixture(outerAxis, innerAxis, between), exported = compile(fixture.frame); exported.render();
  const target = element(fixture.inner.name), observer = observerFor(target), fixed = element(fixture.fixed.name), weighted = element(fixture.weighted.name), identities = fixture.absolute.map(child => element(child.name));
  expectNestedConstraints(fixture, exported.initialSize(fixture.inner.id));
  expect(target.style.display).toBe('flex'); expect(target.style.flexDirection).toBe(innerAxis === 'HORIZONTAL' ? 'row' : 'column'); expect(target.style.flexGrow).toBe('1'); expect(Number.parseFloat(target.style.flexBasis)).toBe(0); expect(target.style.flexShrink).toBe('1');
  expect(target.style[outerAxis === 'HORIZONTAL' ? 'height' : 'width']).toBe(outerAxis === 'HORIZONTAL' ? '80px' : '100px');
  for (const [property, value] of [['rowGap', innerAxis === 'VERTICAL' ? between ? 0 : 11 : 7], ['columnGap', innerAxis === 'HORIZONTAL' ? between ? 0 : 11 : 7]] as const) {
    if (value === 0) expect(Number.parseFloat(target.style[property])).toBe(0); else expect(target.style[property]).toBe(`${value}px`);
  }
  expect(target.style.justifyContent).toBe(between ? 'space-between' : 'flex-start');
  expect(target.style.padding).toBe('6px 8px 10px 12px'); expect([target.style.minWidth, target.style.maxWidth, target.style.minHeight, target.style.maxHeight]).toEqual(['40px', '600px', '40px', '500px']);
  expect(fixed.style[outerAxis === 'HORIZONTAL' ? 'width' : 'height']).toBe('60px'); expect(weighted.style.flexGrow).toBe('2');
  const initial = cloneReactExportGraph(editor.graph, [fixture.frame.id]); computeAllLayouts(initial, fixture.frame.id);
  const grown = initial.getNode(fixture.inner.id)!, peer = initial.getNode(fixture.weighted.id)!;
  expect(Math.abs((outerAxis === 'HORIZONTAL' ? grown.width + peer.width : grown.height + peer.height) - ((outerAxis === 'HORIZONTAL' ? 440 : 300) - 80))).toBeLessThanOrEqual(1e-4);
  expect(outerAxis === 'HORIZONTAL' ? peer.width : peer.height).toBeGreaterThan(outerAxis === 'HORIZONTAL' ? grown.width : grown.height);
  for (const size of [{ width: 0, height: 0 }, { width: 160, height: 120 }, { width: 160.5, height: 120.25 }, { width: 240, height: 160 }, { width: 160, height: 120 }]) {
    observer.deliver(target, size); expectNestedConstraints(fixture, size); expect(element(fixture.inner.name)).toBe(target); fixture.absolute.forEach((child, index) => expect(element(child.name)).toBe(identities[index]));
    if (size.width && size.height) {
      const reference = independentNestedLayout(fixture, size), first = reference.getNode(fixture.flow[0]!.id)!;
      expect({ x: first.x, y: first.y, width: first.width, height: first.height }).toEqual(innerAxis === 'HORIZONTAL' ? { x: 12, y: 6, width: 28, height: 16 } : { x: 12, y: 6, width: 16, height: 28 });
      const second = reference.getNode(fixture.flow[1]!.id)!, last = reference.getNode(fixture.flow[2]!.id)!;
      if (between) {
        const available = innerAxis === 'HORIZONTAL' ? size.width - 20 : size.height - 16;
        const expectedGap = (available - 64) / 2;
        expect(Math.abs((innerAxis === 'HORIZONTAL' ? second.x : second.y) - ((innerAxis === 'HORIZONTAL' ? 12 : 6) + 28 + expectedGap))).toBeLessThanOrEqual(1e-4);
      } else expect(Math.abs((innerAxis === 'HORIZONTAL' ? last.width - 2 * second.width : last.height - 2 * second.height))).toBeLessThanOrEqual(1);
    }
    exported.unchanged();
  }
  expect(observer.disconnect).not.toHaveBeenCalled();
});

it.each((['HORIZONTAL', 'VERTICAL'] as const).flatMap(outerAxis => (['HORIZONTAL', 'VERTICAL'] as const).map(innerAxis => ({ outerAxis, innerAxis }))))('keeps a live numeric own-layout cross binding for $outerAxis/$innerAxis despite stretch alignment', ({ outerAxis, innerAxis }) => {
  const fixture = nestedFixture(outerAxis, innerAxis), graph = editor.graph, collection = graph.createCollection('Nested cross binding'), cross = outerAxis === 'HORIZONTAL' ? 'height' : 'width';
  const variable = graph.createVariable('Nested fixed cross', 'FLOAT', collection.id, outerAxis === 'HORIZONTAL' ? 80 : 100); graph.bindVariable(fixture.inner.id, cross, variable.id);
  const exported = compile(fixture.frame); exported.render(); const target = element(fixture.inner.name), observer = observerFor(target);
  for (const value of [120, 160, 120]) {
    const variables = exported.model.prototypeVariables!, values = { [variable.id]: value };
    exported.render({ prototypeSession: { values, modes: {} } }); expect(element(fixture.inner.name)).toBe(target); expect(target.style[cross]).toBe(`${value}px`);
    const source = cloneReactExportGraph(graph, [fixture.frame.id]); source.getNode(fixture.inner.id)![cross] = value; computeAllLayouts(source, fixture.frame.id); const expected = source.getNode(fixture.inner.id)!;
    expect(expected[cross]).toBe(value); const size = { width: expected.width, height: expected.height }; observer.deliver(target, size); expectNestedConstraints(fixture, size); expect(variables.variables.some(item => item.id === variable.id)).toBe(true); exported.unchanged();
  }
  expect(observer.disconnect).not.toHaveBeenCalled();
});

it.each(['HORIZONTAL', 'VERTICAL'] as const)('updates only the %s primary axis gap from a live spacing binding', innerAxis => {
  const fixture = nestedFixture('HORIZONTAL', innerAxis), graph = editor.graph, collection = graph.createCollection('Nested spacing'), gap = graph.createVariable('Own primary gap', 'FLOAT', collection.id, 11); graph.bindVariable(fixture.inner.id, 'itemSpacing', gap.id);
  const exported = compile(fixture.frame); exported.render(); const target = element(fixture.inner.name), observer = observerFor(target);
  for (const value of [5, 19, 5]) {
    exported.render({ prototypeSession: { values: { [gap.id]: value }, modes: {} } }); expect(target.style[innerAxis === 'HORIZONTAL' ? 'columnGap' : 'rowGap']).toBe(`${value}px`); expect(target.style[innerAxis === 'HORIZONTAL' ? 'rowGap' : 'columnGap']).toBe('7px');
    observer.deliver(target, { width: 160, height: 120 }); expectNestedConstraints(fixture, { width: 160, height: 120 }); expect(element(fixture.inner.name)).toBe(target); exported.unchanged();
  }
});

it.each(['HORIZONTAL', 'VERTICAL'] as const)('clamps a live negative %s primary gap to SDK zero without replacing measured media or its observer', innerAxis => {
  const media = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Gap transition retained video', width: 12, height: 8, duration: 3 }, 4, 4);
  const fixture = nestedFixture('HORIZONTAL', innerAxis), graph = editor.graph, collection = graph.createCollection('Clamped live spacing'), gap = graph.createVariable('Signed primary gap', 'FLOAT', collection.id, 17);
  graph.reparentNode(media, fixture.inner.id); graph.getNode(media)!.layoutPositioning = 'ABSOLUTE'; graph.bindVariable(fixture.inner.id, 'itemSpacing', gap.id);
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {}), exported = compile(fixture.frame);
  exported.render(); const target = element(fixture.inner.name), observer = observerFor(target), video = host.querySelector('video')!, children = fixture.flow.map(child => element(child.name)); video.currentTime = 2;
  const mediaSource = [video.getAttribute('src'), video.getAttribute('poster')], primary = innerAxis === 'HORIZONTAL' ? 'columnGap' : 'rowGap', secondary = innerAxis === 'HORIZONTAL' ? 'rowGap' : 'columnGap', measured = { width: 160, height: 120 };
  for (const value of [17, -5, 17]) {
    const reference = cloneReactExportGraph(graph, [fixture.inner.id]), inner = reference.getNode(fixture.inner.id)!; reference.reparentNode(inner.id, reference.getPages()[0]!.id);
    Object.assign(inner, measured, { layoutGrow: 0, itemSpacing: value }); inner.boundVariables = {}; computeAllLayouts(reference, inner.id);
    const second = reference.getNode(fixture.flow[1]!.id)!, sourcePosition = innerAxis === 'HORIZONTAL' ? second.x : second.y, expectedGap = value < 0 ? 0 : value;
    expect(sourcePosition).toBe((innerAxis === 'HORIZONTAL' ? 12 : 6) + 28 + expectedGap);
    exported.render({ prototypeSession: { values: { [gap.id]: value }, modes: {} } });
    expect(Number.parseFloat(target.style[primary])).toBe(expectedGap); expect(target.style[secondary]).toBe('7px');
    observer.deliver(target, measured); expectNestedConstraints(fixture, measured); expect(element(fixture.inner.name)).toBe(target); expect(observerFor(target)).toBe(observer); expect(observers).toHaveLength(1);
    fixture.flow.forEach((child, index) => expect(element(child.name)).toBe(children[index])); expect(host.querySelector('video')).toBe(video); expect(video.currentTime).toBe(2); expect([video.getAttribute('src'), video.getAttribute('poster')]).toEqual(mediaSource);
    expect(pause).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); expect(observer.disconnect).not.toHaveBeenCalled(); exported.unchanged();
  }
});

it.each((['HORIZONTAL', 'VERTICAL'] as const).flatMap(outerAxis => (['CENTER', 'MAX'] as const).map(alignment => ({ outerAxis, alignment }))))('preserves $outerAxis own-layout main min/max and explicit $alignment cross alignment', ({ outerAxis, alignment }) => {
  const fixture = nestedFixture(outerAxis, outerAxis), main = outerAxis === 'HORIZONTAL' ? 'width' : 'height';
  Object.assign(fixture.inner, outerAxis === 'HORIZONTAL' ? { minWidth: 120, maxWidth: 120 } : { minHeight: 120, maxHeight: 120 }); fixture.inner.layoutAlignSelf = alignment;
  const reference = cloneReactExportGraph(editor.graph, [fixture.frame.id]); computeAllLayouts(reference, fixture.frame.id); const expected = reference.getNode(fixture.inner.id)!, peer = reference.getNode(fixture.weighted.id)!;
  expect(expected[main]).toBe(120); expect(peer[main]).toBe((outerAxis === 'HORIZONTAL' ? 440 : 300) - 60 - 20 - 120);
  expect(outerAxis === 'HORIZONTAL' ? expected.y : expected.x).toBe((outerAxis === 'HORIZONTAL' ? 300 - 80 : 440 - 100) / (alignment === 'CENTER' ? 2 : 1));
  const exported = compile(fixture.frame); exported.render(); const target = element(fixture.inner.name), observer = observerFor(target);
  expect(target.style.alignSelf).toBe(alignment === 'CENTER' ? 'center' : 'flex-end'); expect([target.style[outerAxis === 'HORIZONTAL' ? 'minWidth' : 'minHeight'], target.style[outerAxis === 'HORIZONTAL' ? 'maxWidth' : 'maxHeight']]).toEqual(['120px', '120px']);
  expectNestedConstraints(fixture, expected); observer.deliver(target, expected); expectNestedConstraints(fixture, expected); expect(element(fixture.inner.name)).toBe(target); exported.unchanged();
});

it('preserves nested own-layout fixed scrolling, media, observer identity and obsolete callback cleanup', () => {
  const media = placePreparedVideo(editor, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Own layout retained video', width: 12, height: 8, duration: 3 }, 4, 4);
  const fixture = nestedFixture('HORIZONTAL', 'VERTICAL', false, true), graph = editor.graph; graph.reparentNode(media, fixture.inner.id); graph.getNode(media)!.layoutPositioning = 'ABSOLUTE';
  expect({ width: fixture.inner.width, height: fixture.inner.height }).toEqual(nestedAuthored);
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {}), exported = compile(fixture.frame);
  exported.renderModel(exported.model.nodes); const target = element(fixture.inner.name), observer = observerFor(target), scroll = viewport(fixture.inner), video = host.querySelector('video')!; video.currentTime = 2;
  observer.deliver(target, { width: 160, height: 120 }); expectNestedConstraints(fixture, { width: 160, height: 120 }); dimensions(scroll, 160, 120); scroll.scrollLeft = 15; scroll.scrollTop = 25; act(() => scroll.dispatchEvent(new Event('scroll')));
  const clip = host.querySelector<HTMLElement>(`[data-xdesign-fixed="${exported.idFor(fixture.absolute[1]!)}"]`)!; expect(clip.style.transform).toBe('translate(15px,25px)');
  exported.renderModel(exported.model.nodes, { values: { unrelated: true } }); expect(element(fixture.inner.name)).toBe(target); expect(viewport(fixture.inner)).toBe(scroll); expect(host.querySelector('video')).toBe(video); expect(video.currentTime).toBe(2); expect(pause).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled();
  const changed = mapNodes(exported.model.nodes, node => node.id === exported.idFor(fixture.inner) ? { ...node, id: `${node.id}-new` } : node); exported.renderModel(changed); expect(observer.disconnect).toHaveBeenCalledOnce(); const replacement = element(fixture.inner.name), current = observerFor(replacement);
  observer.deliver(target, { width: 999, height: 999 }); expectNestedConstraints(fixture, exported.initialSize(fixture.inner.id)); current.deliver(replacement, { width: 240, height: 160 }); expectNestedConstraints(fixture, { width: 240, height: 160 });
  act(() => root.render(null)); expect(current.disconnect).toHaveBeenCalledOnce(); current.deliver(replacement, { width: 500, height: 500 }); expect(host.childElementCount).toBe(0); exported.unchanged();
});

it.each(['own wrap', 'parent wrap', 'own hug', 'own grid'] as const)('retains the nested %s fidelity refusal and source geometry', family => {
  const fixture = nestedFixture('HORIZONTAL', 'VERTICAL');
  if (family === 'own wrap') fixture.inner.layoutWrap = 'WRAP'; if (family === 'parent wrap') fixture.frame.layoutWrap = 'WRAP'; if (family === 'own hug') fixture.inner.primaryAxisSizing = 'HUG'; if (family === 'own grid') fixture.inner.layoutMode = 'GRID';
  const source = serializeGraph(editor.graph); expect(() => selectionToReact(editor.graph, [fixture.frame.id])).toThrow(); expect(serializeGraph(editor.graph)).toBe(source);
});

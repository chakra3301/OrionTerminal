// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'sucrase';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { fontManager, prepareGraphFonts } from '@open-pencil/core/text';
import { computeAllLayouts } from '@open-pencil/core/layout';
import type { CanvasKit, MallocObj, Surface } from 'canvaskit-wasm';
import { getAxisAlignedWorldBounds, getWorldMatrix, TransformMatrix, type SceneGraph } from '@open-pencil/scene-graph';
import { constrainedChildRect } from '@open-pencil/scene-graph/resize';
import { parseSVGPath } from '@open-pencil/scene-graph/parse-path';
import { createComponentProperty, bindComponentProperty } from './componentProperties';
import { setComponentBehaviour } from './behaviour/editor';
import { cloneDesignSubgraph } from './graphSubset';
import { nativeSceneArtworkPlan, renderNativeSceneImage } from './nativeSceneArtwork';
import { prepareNativeSceneComponents } from './nativeSceneComponents';
import { prepareNativeSceneLayout } from './nativeSceneLayout';
import { renderNativeReactModel } from './nativeReactRenderer';
import { capturePrototypeVariables, materializePrototypeBindings } from './prototypeVariableGraph';
import { assignPrototypeVariable, emptyPrototypeSession } from './prototypeValues';
import { reconcilePrototypeGeometry, snapshotPrototypeGeometry } from './prototypeGeometry';
import { serializeGraph } from './document';
import { selectionToDesignModel, selectionToReact } from './reactExport';
import { resolveDesignSelection, type DesignNode } from './reactExportRuntime';
import type { DesignProps } from './reactExportRuntime';
import { createNativeRenderer, destroyNativeRenderer, freeNativeSurfacePixels, releaseNativeResources } from './nativeRendererLifecycle';
import { setNavigation } from './prototype';
import workerBundle from 'virtual:xdesign-native-react-worker';
import type { NativeReactOutput } from './nativeReactProtocol';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); fontManager.setOnlineFontProviders({ google: false, fontshare: false, fontsource: false }); });

const red = { r: 1, g: .05, b: .02, a: 1 }, blue = { r: .02, g: .1, b: 1, a: 1 };
const paint = (color = red) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color });
function pixels(bytes: Uint8Array) {
  const image = kit.MakeImageFromEncoded(bytes)!;
  try {
    const rgba = new Uint8Array(image.readPixels(0, 0, { width: image.width(), height: image.height(), alphaType: kit.AlphaType.Unpremul, colorType: kit.ColorType.RGBA_8888, colorSpace: kit.ColorSpace.SRGB })!);
    return { width: image.width(), height: image.height(), hash: createHash('sha256').update(rgba).digest('hex'), rgba };
  } finally { image.delete(); }
}
const modelBytes = (uri: string) => new Uint8Array(Buffer.from(uri.split('base64,')[1]!, 'base64'));
function imageAsset() {
  const surface = kit.MakeSurface(24, 12)!, canvas = surface.getCanvas(), paint = new kit.Paint();
  try {
    paint.setColor(kit.Color(255, 0, 0, 1)); canvas.drawRect(kit.LTRBRect(0, 0, 12, 12), paint);
    paint.setColor(kit.Color(0, 0, 255, 1)); canvas.drawRect(kit.LTRBRect(12, 0, 24, 12), paint);
    const image = surface.makeImageSnapshot(); try { return image.encodeToBytes()!; } finally { image.delete(); }
  } finally { paint.delete(); surface.delete(); }
}

function fixture() {
  const editor = createEditor(), graph = editor.graph;
  const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Responsive native host', width: 100, height: 80, fills: [], clipsContent: false,
    effects: [{ type: 'LAYER_BLUR', visible: true, radius: 2, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } }] });
  graph.images.set('responsive-image', imageAsset());
  const collection = graph.createCollection('Native responsive');
  const rootWidth = graph.createVariable('Host width', 'FLOAT', collection.id, 100), childWidth = graph.createVariable('Explicit width', 'FLOAT', collection.id, 22);
  graph.bindVariable(root.id, 'width', rootWidth.id);
  const stretched = graph.createNode('RECTANGLE', root.id, { name: 'Constrained gradient', x: 10, y: 9, width: 30, height: 26, horizontalConstraint: 'STRETCH', verticalConstraint: 'MAX',
    fills: [{ type: 'GRADIENT_LINEAR', visible: true, opacity: 1, color: red, gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, gradientStops: [{ position: 0, color: red }, { position: 1, color: blue }] }],
    strokes: [{ ...paint(blue), weight: 2, align: 'CENTER' }] });
  const explicit = graph.createNode('RECTANGLE', root.id, { name: 'Explicit child width', x: 62, y: 12, width: 22, height: 20, horizontalConstraint: 'MAX', verticalConstraint: 'MAX', fills: [paint(blue)] });
  graph.bindVariable(explicit.id, 'width', childWidth.id);
  const mask = graph.createNode('ELLIPSE', root.id, { name: 'Native mask', x: 8, y: 44, width: 24, height: 24, isMask: true, fills: [paint()] });
  const masked = graph.createNode('RECTANGLE', root.id, { name: 'Masked pixels', x: 8, y: 44, width: 50, height: 24, fills: [paint(blue)] });
  const image = graph.createNode('RECTANGLE', root.id, { name: 'Resizable image fill', x: 44, y: 44, width: 44, height: 24, horizontalConstraint: 'MAX', verticalConstraint: 'MAX', fills: [{ type: 'IMAGE', visible: true, opacity: 1, color: red, imageHash: 'responsive-image', imageScaleMode: 'CROP' }] });
  const component = graph.createNode('COMPONENT', editor.state.currentPageId, { name: 'Nested native component', width: 18, height: 18 });
  graph.createNode('ELLIPSE', component.id, { name: 'Component pixels', width: 18, height: 18, fills: [paint(blue)] });
  const instance = graph.createInstance(component.id, root.id, { x: 72, y: 14 });
  if (!instance) throw new Error('Could not create nested component fixture.');
  return { editor, graph, root, rootWidth, childWidth, stretched, explicit, mask, masked, image, instance };
}

function independentNativeImage(graph: SceneGraph, id: string, session: ReturnType<typeof emptyPrototypeSession>, width: number, height: number) {
  const copy = cloneDesignSubgraph(graph, [id]);
  prepareNativeSceneComponents(copy, [id]);
  const originals = snapshotPrototypeGeometry(copy), explicit = new Map([...copy.nodes.values()].map(node => [node.id, new Set(Object.keys(node.boundVariables).filter(field => ['x', 'y', 'width', 'height'].includes(field)))]));
  const definitions = capturePrototypeVariables(copy, copy.nodes.values());
  materializePrototypeBindings(copy, definitions, session, { detachResolved: true });
  const root = copy.getNode(id)!; root.width = width; root.height = height;
  reconcilePrototypeGeometry(copy, originals, explicit);
  prepareNativeSceneLayout(kit, copy, [id]);
  const prepared = copy.getNode(id)!;
  expect(nativeSceneArtworkPlan(copy, prepared).needed).toBe(true);
  return renderNativeSceneImage(kit, copy, prepared);
}

it('renders resized private native pixels from authored constraints, explicit bindings, blur and masks', async () => {
  const f = fixture();
  try {
    const before = serializeGraph(f.graph), definitions = capturePrototypeVariables(f.graph), session = assignPrototypeVariable(definitions,
      assignPrototypeVariable(definitions, emptyPrototypeSession(), f.rootWidth.id, { type: 'literal', value: 132 }),
      f.childWidth.id, { type: 'literal', value: 38 });
    const model = await renderNativeReactModel(kit, f.graph, [f.root.id], { session, rootSizes: { [f.root.id]: { width: 180, height: 96 } } });
    const output = model.nodes[0]!, children = output.children;
    expect(model.prototypeIssues).toEqual([]);
    expect(output.style).toMatchObject({ width: 180, height: 96 });
    expect(children.find(node => node.sourceId === f.explicit.id)!.style.width).toBe(38);
    const expectedRect = constrainedChildRect({ x: f.stretched.x, y: f.stretched.y, width: f.stretched.width, height: f.stretched.height },
      { width: f.root.width, height: f.root.height }, { width: 180, height: 96 }, f.stretched.horizontalConstraint, f.stretched.verticalConstraint);
    expect(children.find(node => node.sourceId === f.stretched.id)!.style).toMatchObject({ left: expectedRect.x, top: expectedRect.y, width: expectedRect.width, height: expectedRect.height });
    expect(output.image).toMatch(/^data:image\/png;base64,/);
    const actual = pixels(modelBytes(output.image!)), expected = pixels(independentNativeImage(f.graph, f.root.id, session, 180, 96).bytes);
    expect(actual.width).toBeGreaterThanOrEqual(180); expect(actual.height).toBeGreaterThanOrEqual(96);
    expect(actual.rgba.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(actual.hash).toBe(expected.hash);
    expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});

it('isolates size requests and failures on fresh private graphs without publishing state into the source', async () => {
  const f = fixture();
  try {
    const before = serializeGraph(f.graph);
    await expect(renderNativeReactModel(kit, f.graph, [f.root.id], { rootSizes: { [f.root.id]: { width: Infinity } } })).rejects.toThrow('positive and finite');
    await expect(renderNativeReactModel(kit, f.graph, [f.root.id], { rootSizes: { [f.stretched.id]: { width: 200 } } })).rejects.toThrow('authored selected root');
    expect(serializeGraph(f.graph)).toBe(before);
    const [small, large] = await Promise.all([
      renderNativeReactModel(kit, f.graph, [f.root.id], { rootSizes: { [f.root.id]: { width: 144, height: 80 } } }),
      renderNativeReactModel(kit, f.graph, [f.root.id], { rootSizes: { [f.root.id]: { width: 224, height: 112 } } }),
    ]);
    expect(small.nodes[0]!.style.width).toBe(144); expect(large.nodes[0]!.style.width).toBe(224);
    expect(pixels(modelBytes(small.nodes[0]!.image!)).hash).not.toBe(pixels(modelBytes(large.nodes[0]!.image!)).hash);
    expect(serializeGraph(f.graph)).toBe(before);
  } finally { f.editor.dispose(); }
});

it('keeps authored component-root identity and hydrates the same native control snapshot across sizes', async () => {
  const editor = createEditor(), graph = editor.graph;
  try {
    const root = graph.createNode('COMPONENT', editor.state.currentPageId, { name: 'Authored checkbox', width: 80, height: 48, fills: [] });
    const mark = graph.createNode('RECTANGLE', root.id, { name: 'Mark', width: 12, height: 12, visible: false, fills: [paint()] });
    const checked = createComponentProperty(editor, root, 'Checked', 'BOOLEAN', 'false');
    bindComponentProperty(editor, mark, 'VISIBLE', checked);
    setComponentBehaviour(editor, root, { kind: 'checkbox', values: { value: 'Checked' } });
    const dimensions = graph.createCollection('Authored root sizing'), width = graph.createVariable('Component width', 'FLOAT', dimensions.id, 80);
    graph.bindVariable(root.id, 'width', width.id);
    const controls = { [JSON.stringify([root.id])]: { value: true, state: 'focus' as const } }, before = serializeGraph(graph);
    const first = await renderNativeReactModel(kit, graph, [root.id], { controls, rootSizes: { [root.id]: { width: 140 } } });
    const second = await renderNativeReactModel(kit, graph, [root.id], { controls, rootSizes: { [root.id]: { width: 160 } } });
    expect(first.nodes[0]!.sourceId).toBe(root.id); expect(second.nodes[0]!.sourceId).toBe(root.id);
    expect(first.nodes[0]!.id).toBe(root.id); expect(second.nodes[0]!.id).toBe(root.id);
    expect(first.nodes[0]!.style.width).toBe(140); expect(second.nodes[0]!.style.width).toBe(160);
    expect(first.nodes[0]!.control?.playback).toMatchObject({ value: true, state: 'focus' });
    expect(second.nodes[0]!.control?.playback).toMatchObject({ value: true, state: 'focus' });
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

it('sizes a selected component set through its authored root and retains the authored set ID', async () => {
  const editor = createEditor(), graph = editor.graph;
  try {
    const set = graph.createNode('COMPONENT_SET', editor.state.currentPageId, { name: 'Authored set' });
    graph.createNode('COMPONENT', set.id, { name: 'Default variant', width: 72, height: 36, fills: [paint()] });
    const before = serializeGraph(graph), model = await renderNativeReactModel(kit, graph, [set.id], { rootSizes: { [set.id]: { width: 128, height: 64 } } });
    expect(model.nodes[0]!.sourceId).toBe(set.id); expect(model.nodes[0]!.id).toBe(set.id);
    expect(model.nodes[0]!.style).toMatchObject({ width: 128, height: 64 });
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

it('renders styled text through the native root renderer when no blur or mask requires composition', async () => {
  const editor = createEditor(), graph = editor.graph;
  try {
    const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Typography root', width: 150, height: 52, fills: [] });
    graph.createNode('TEXT', root.id, { name: 'Styled label', x: 12, y: 10, width: 124, height: 30, text: 'Responsive café', fontFamily: 'Inter', fontSize: 17, fontWeight: 600, fills: [paint(blue)] });
    const before = serializeGraph(graph), model = await renderNativeReactModel(kit, graph, [root.id]);
    expect(model.nodes[0]!.image).toMatch(/^data:image\/png;base64,/);
    const copy = cloneDesignSubgraph(graph, [root.id]); await prepareGraphFonts(copy, [root.id]);
    const expected = renderNativeSceneImage(kit, copy, copy.getNode(root.id)!, true);
    expect(pixels(modelBytes(model.nodes[0]!.image!)).hash).toBe(pixels(expected.bytes).hash);
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

function expectSelectedGeometry(nodes: DesignNode[], width: number, height: number, graph: SceneGraph, ids: string[]) {
  const bounds = ids.map(id => getAxisAlignedWorldBounds(graph.getNode(id)!, graph)), minX = Math.min(...bounds.map(rect => rect.x)), minY = Math.min(...bounds.map(rect => rect.y));
  expect(width).toBeCloseTo(Math.max(...bounds.map(rect => rect.x + rect.width)) - minX, 8); expect(height).toBeCloseTo(Math.max(...bounds.map(rect => rect.y + rect.height)) - minY, 8);
  expect(nodes.map(node => node.id)).toEqual(ids);
  for (const [index, id] of ids.entries()) {
    const source = graph.getNode(id)!, expected = getWorldMatrix(source, graph), node = nodes[index]!, matrix = String(node.style.transform).slice(7, -1).split(',').map(Number);
    expect([node.style.width, node.style.height]).toEqual([source.width, source.height]); expect(node.style.transformOrigin).toBe('0 0');
    expect(Number(node.style.left)).toBeCloseTo(expected[2]! - minX, 8); expect(Number(node.style.top)).toBeCloseTo(expected[5]! - minY, 8);
    for (const [component, value] of [expected[0], expected[3], expected[1], expected[4], 0, 0].entries()) expect(matrix[component]).toBeCloseTo(value!, 8);
    for (const [x, y] of [[0, 0], [source.width, 0], [source.width, source.height], [0, source.height]]) {
      expect(Number(node.style.left) + matrix[0]! * x! + matrix[2]! * y!).toBeCloseTo(expected[0]! * x! + expected[1]! * y! + expected[2]! - minX, 8);
      expect(Number(node.style.top) + matrix[1]! * x! + matrix[3]! * y!).toBeCloseTo(expected[3]! * x! + expected[4]! * y! + expected[5]! - minY, 8);
    }
  }
}

function expectOwnRootPaint(output: DesignNode, graph: SceneGraph, id: string, color: number[], label: string) {
  const copy = cloneDesignSubgraph(graph, [id]), root = copy.getNode(id)!;
  Object.assign(root, { x: 0, y: 0, rotation: 0, flipX: false, flipY: false }); copy.clearAbsPosCache();
  const inverse = TransformMatrix.invert(getWorldMatrix(root, copy))!;
  let minX = 0, minY = 0, maxX = root.width, maxY = root.height;
  for (const layer of [root, ...copy.getChildren(id)]) {
    const relative = TransformMatrix.multiply(inverse, getWorldMatrix(layer, copy));
    for (const [x, y] of [[0, 0], [layer.width, 0], [layer.width, layer.height], [0, layer.height]]) {
      const px = relative[0]! * x! + relative[1]! * y! + relative[2]!, py = relative[3]! * x! + relative[4]! * y! + relative[5]!;
      minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
    }
  }
  // Conservative ceil bounds can retain a transparent pixel after inverse/world matrix roundoff.
  // Its placement and every RGBA channel remain part of the oracle.
  expect(minX, label).toBeCloseTo(0, 8); expect(minY, label).toBeCloseTo(0, 8); expect(maxX, label).toBeCloseTo(root.width, 8); expect(maxY, label).toBeCloseTo(root.height, 8);
  const expectedWidth = Math.ceil((maxX - minX) * 2), expectedHeight = Math.ceil((maxY - minY) * 2), actual = pixels(modelBytes(output.image!));
  expect([actual.width, actual.height], `${label} capture bounds ${JSON.stringify({ minX, minY, maxX, maxY })}`).toEqual([expectedWidth, expectedHeight]);
  const length = (value: unknown, dimension: number) => String(value).endsWith('%') ? Number.parseFloat(String(value)) * dimension / 100 : Number.parseFloat(String(value));
  const left = length(output.imageStyle!.left, root.width), top = length(output.imageStyle!.top, root.height), width = length(output.imageStyle!.width, root.width), height = length(output.imageStyle!.height, root.height);
  expect(left, label).toBeCloseTo(minX, 10); expect(top, label).toBeCloseTo(minY, 10); expect(width, label).toBeCloseTo(expectedWidth / 2, 10); expect(height, label).toBeCloseTo(expectedHeight / 2, 10);
  const paintLeft = -left * actual.width / width, paintTop = -top * actual.height / height, paintRight = (root.width - left) * actual.width / width, paintBottom = (root.height - top) * actual.height / height;
  for (let y = 0; y < actual.height; y++) for (let x = 0; x < actual.width; x++) {
    const inside = x + .5 >= paintLeft && x + .5 < paintRight && y + .5 >= paintTop && y + .5 < paintBottom, expected = inside ? color : [0, 0, 0, 0], offset = (y * actual.width + x) * 4;
    if (expected.some((channel, index) => actual.rgba[offset + index] !== channel)) throw new Error(`${label} RGBA at ${x},${y}: actual ${[...actual.rgba.slice(offset, offset + 4)]}, expected ${expected}, imageStyle ${JSON.stringify(output.imageStyle)}`);
  }
}
it.each(['session', 'host sizes'] as const)('matches live portable multi-root geometry to independent world bounds and fresh native %s renders', async mode => {
  const editor = createEditor(), graph = editor.graph, page = editor.state.currentPageId;
  const firstParent = graph.createNode('FRAME', page, { x: -120, y: -100, width: 160, height: 100, rotation: 90, fills: [] }), secondParent = graph.createNode('FRAME', page, { x: 180, y: 70, width: 120, height: 90, rotation: -25, flipY: true, fills: [] });
  const first = graph.createNode('FRAME', firstParent.id, { name: 'Bound native first', x: 12, y: 8, width: 40, height: 20, flipX: true, fills: [paint({ r: 1, g: 0, b: 0, a: 1 })] }), second = graph.createNode('FRAME', secondParent.id, { name: 'Bound native second', x: 10, y: 5, width: 30, height: 25, rotation: 17, flipX: true, fills: [paint({ r: 0, g: 0, b: 1, a: 1 })] }), anchor = graph.createNode('RECTANGLE', page, { name: 'Static native anchor', x: 400, y: 250, width: 10, height: 10, fills: [paint({ r: 0, g: 1, b: 0, a: 1 })] });
  const collection = graph.createCollection('Native selected dimensions'), width = graph.createVariable('Width', 'FLOAT', collection.id, 40), height = graph.createVariable('Height', 'FLOAT', collection.id, 20), otherHeight = graph.createVariable('Other height', 'FLOAT', collection.id, 25);
  graph.bindVariable(first.id, 'width', width.id); graph.bindVariable(first.id, 'height', height.id); graph.bindVariable(second.id, 'height', otherHeight.id);
  const ids = [first.id, second.id, anchor.id], source = serializeGraph(graph), definitions = capturePrototypeVariables(graph), portable = selectionToDesignModel(graph, ids), portableSource = JSON.stringify(portable);
  try {
    for (const [w, h, other] of [[40, 20, 25], [80, 50, 45]] as const) {
      let session = emptyPrototypeSession(); for (const [variable, value] of [[width, w], [height, h], [otherHeight, other]] as const) session = assignPrototypeVariable(definitions, session, variable.id, { type: 'literal', value });
      const independent = cloneDesignSubgraph(graph, ids); materializePrototypeBindings(independent, definitions, session, { detachResolved: true });
      const resolved = resolveDesignSelection(portable.nodes, { prototypeVariables: portable.prototypeVariables, prototypeSession: session }, portable.width, portable.height);
      expectSelectedGeometry(resolved.nodes, resolved.width, resolved.height, independent, ids);
      const rootSizes = Object.fromEntries(ids.map(id => { const node = independent.getNode(id)!; return [id, { width: node.width, height: node.height }]; }));
      const native = await renderNativeReactModel(kit, graph, ids, mode === 'session' ? { session } : { rootSizes });
      expectSelectedGeometry(native.nodes, native.width, native.height, independent, ids); expect(native.nodes.every(node => node.selectionRoot === undefined)).toBe(true);
      for (const [index, color] of [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]].entries()) {
        const output = native.nodes[index]!, actual = pixels(modelBytes(output.image!)); expect([actual.width, actual.height]).toEqual([Number(output.style.width) * 2, Number(output.style.height) * 2]);
        for (let offset = 0; offset < actual.rgba.length; offset += 4) if (color.some((channel, channelIndex) => actual.rgba[offset + channelIndex] !== channel)) throw new Error(`Native selected root ${index} has unexpected RGBA at${offset / 4}`);
      }
      let prepared = false;
      const snapshot = selectionToDesignModel(graph, ids, undefined, true, session, undefined, false, undefined, false, () => { prepared = true; });
      expect(prepared).toBe(true); expect(snapshot.nodes.every(node => node.selectionRoot === undefined)).toBe(true); expectSelectedGeometry(snapshot.nodes, snapshot.width, snapshot.height, independent, ids);
      expect(JSON.stringify(portable)).toBe(portableSource); expect(serializeGraph(graph)).toBe(source);
    }
  } finally { editor.dispose(); }
});

it.each(['session', 'host sizes'] as const)('matches shared dynamic ancestor geometry to fresh native %s renders and analytic root PNGs', async mode => {
  const editor = createEditor(), graph = editor.graph, page = editor.state.currentPageId;
  const outer = graph.createNode('FRAME', page, { x: -80, y: 30, width: 120, height: 90, rotation: 23, flipX: true, fills: [] });
  const parent = graph.createNode('FRAME', outer.id, { x: 10, y: 8, width: 7, height: 11, rotation: 17, flipY: true, fills: [] });
  const first = graph.createNode('FRAME', parent.id, { name: 'Scaled red selected root', x: 2, y: 3, width: 3, height: 4, horizontalConstraint: 'SCALE', verticalConstraint: 'SCALE', fills: [paint({ r: 1, g: 0, b: 0, a: 1 })] });
  const second = graph.createNode('FRAME', parent.id, { name: 'Explicit blue selected root', x: 1, y: 2, width: 5, height: 4, horizontalConstraint: 'STRETCH', verticalConstraint: 'MAX', fills: [paint({ r: 0, g: 0, b: 1, a: 1 })] });
  const anchor = graph.createNode('RECTANGLE', page, { x: 180, y: 130, width: 10, height: 8, fills: [paint({ r: 0, g: 1, b: 0, a: 1 })] });
  const defaults = [10, 17, 90, 8, 13, 6] as const, collection = graph.createCollection('Native ancestor geometry'), variables = defaults.map((value, index) => graph.createVariable(`Ancestor ${index}`, 'FLOAT', collection.id, value));
  for (const [index, field] of ['width', 'height', 'rotation', 'x', 'y'].entries()) graph.bindVariable(parent.id, field!, variables[index]!.id); graph.bindVariable(second.id, 'width', variables[5]!.id);
  const ids = [first.id, second.id, anchor.id], definitions = capturePrototypeVariables(graph), source = serializeGraph(graph), portable = selectionToDesignModel(graph, ids), modelSource = JSON.stringify(portable);
  try {
    expect(portable.prototypeIssues).toEqual([]);
    for (const values of [defaults, [11, 23, 37, 19, -7, 9], [14, 13, -41, -5, 27, 7]] as const) {
      let session = emptyPrototypeSession(); for (const [index, variable] of variables.entries()) session = assignPrototypeVariable(definitions, session, variable.id, { type: 'literal', value: values[index]! });
      const independent = cloneDesignSubgraph(graph, ids); materializePrototypeBindings(independent, definitions, session, { detachResolved: true });
      const resolved = resolveDesignSelection(portable.nodes, { prototypeVariables: portable.prototypeVariables, prototypeSession: session }, portable.width, portable.height); expectSelectedGeometry(resolved.nodes, resolved.width, resolved.height, independent, ids);
      const rootSizes = Object.fromEntries(ids.map(id => { const node = independent.getNode(id)!; return [id, { width: node.width, height: node.height }]; }));
      const native = await renderNativeReactModel(kit, graph, ids, { session, ...(mode === 'host sizes' ? { rootSizes } : {}) }); expectSelectedGeometry(native.nodes, native.width, native.height, independent, ids); expect(native.nodes.every(node => !node.selectionRoot)).toBe(true);
      for (const [index, color] of [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]].entries()) {
        const output = native.nodes[index]!, actual = pixels(modelBytes(output.image!)); expect([actual.width, actual.height]).toEqual([Number(output.style.width) * 2, Number(output.style.height) * 2]);
        for (let offset = 0; offset < actual.rgba.length; offset += 4) if (color.some((channel, channelIndex) => actual.rgba[offset + channelIndex] !== channel)) throw new Error(`Dynamic ancestor native color ${mode}/${index}/${offset}: ${[...actual.rgba.slice(offset, offset + 4)]}`);
      }
      let prepared = false; const snapshot = selectionToDesignModel(graph, ids, undefined, true, session, undefined, false, undefined, false, () => { prepared = true; }); expect(prepared).toBe(true); expect(snapshot.nodes.every(node => !node.selectionRoot)).toBe(true); expectSelectedGeometry(snapshot.nodes, snapshot.width, snapshot.height, independent, ids);
    }
    expect(JSON.stringify(portable)).toBe(modelSource); expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

it.each(['flow', 'control'] as const)('preserves actual native session rendering when portable dynamic ancestor %s geometry is refused', async family => {
  const editor = createEditor(), graph = editor.graph, parent = graph.createNode('FRAME', editor.state.currentPageId, { x: 20, y: 30, width: 100, height: 80, rotation: 17, fills: [], ...(family === 'flow' ? { layoutMode: 'HORIZONTAL' as const } : {}) });
  const collection = graph.createCollection('Native guarded ancestor'), width = graph.createVariable('Width', 'FLOAT', collection.id, 120); graph.bindVariable(parent.id, 'width', width.id);
  let selected = graph.createNode('FRAME', parent.id, { name: 'Native flow child', x: 10, y: 8, width: 20, height: 12, fills: [paint(blue)] });
  if (family === 'control') {
    const main = graph.createNode('COMPONENT', editor.state.currentPageId, { name: 'Native ancestor checkbox', width: 30, height: 20, fills: [] }), mark = graph.createNode('RECTANGLE', main.id, { name: 'Checked mark', width: 12, height: 12, visible: false, fills: [paint(blue)] });
    const checked = createComponentProperty(editor, main, 'Checked', 'BOOLEAN', 'false'); bindComponentProperty(editor, mark, 'VISIBLE', checked); setComponentBehaviour(editor, main, { kind: 'checkbox', values: { value: 'Checked' } }); selected = graph.createInstance(main.id, parent.id)!;
  }
  const source = serializeGraph(graph), definitions = capturePrototypeVariables(graph), session = assignPrototypeVariable(definitions, emptyPrototypeSession(), width.id, { type: 'literal', value: 180 });
  try {
    expect(() => selectionToReact(graph, [selected.id])).toThrow('Variable-bound ancestor layout or realized controls');
    const native = await renderNativeReactModel(kit, graph, [selected.id], { session }); expect(native.prototypeIssues).toEqual([]); expect(native.nodes).toHaveLength(1); expect(native.nodes[0]!.selectionRoot).toBeUndefined();
    if (family === 'control') expect(native.nodes[0]!.control?.kind).toBe('checkbox'); else { const independent = cloneDesignSubgraph(graph, [selected.id]); materializePrototypeBindings(independent, definitions, session, { detachResolved: true }); expectSelectedGeometry(native.nodes, native.width, native.height, independent, [selected.id]); expect(native.nodes[0]!.image).toMatch(/^data:image\/png;base64,/); }
    expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

it.each(['session', 'host sizes'] as const)('matches own root transform playback to independent corners and actual native %s PNGs', async mode => {
  const editor = createEditor(), graph = editor.graph, page = editor.state.currentPageId, outer = graph.createNode('FRAME', page, { x: 90, y: 50, width: 180, height: 120, rotation: 23, flipX: true, fills: [] }), parent = graph.createNode('FRAME', outer.id, { x: 12, y: 8, width: 100, height: 80, rotation: -17, flipY: true, fills: [] }), otherParent = graph.createNode('FRAME', page, { x: -100, y: 80, width: 120, height: 90, rotation: 90, flipY: true, fills: [] });
  const first = graph.createNode('FRAME', parent.id, { name: 'Native own red root', x: 12, y: 7, width: 40, height: 24, flipX: true, horizontalConstraint: 'MAX', verticalConstraint: 'STRETCH', fills: [] }), second = graph.createNode('FRAME', otherParent.id, { name: 'Native own blue root', x: 12, y: 7, width: 40, height: 24, fills: [] }), anchor = graph.createNode('RECTANGLE', page, { x: -150, y: 200, width: 10, height: 8, fills: [paint({ r: 0, g: 1, b: 0, a: 1 })] });
  for (const [node, color] of [[first, { r: 1, g: 0, b: 0, a: 1 }], [second, { r: 0, g: 0, b: 1, a: 1 }]] as const) graph.createNode('RECTANGLE', node.id, { width: 40, height: 24, horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH', fills: [paint(color)] });
  const fields = ['x', 'y', 'rotation', 'width', 'height'] as const, defaults = [12, 7, 0, 40, 24, 100, -17] as const, collection = graph.createCollection('Native own root geometry'), variables = defaults.map((value, index) => graph.createVariable(`Own native ${index}`, 'FLOAT', collection.id, value));
  for (const node of [first, second]) for (const [index, field] of fields.entries()) graph.bindVariable(node.id, field, variables[index]!.id); graph.bindVariable(parent.id, 'width', variables[5]!.id); graph.bindVariable(parent.id, 'rotation', variables[6]!.id);
  const ids = [first.id, second.id, anchor.id], definitions = capturePrototypeVariables(graph), source = serializeGraph(graph), portable = selectionToDesignModel(graph, ids), modelSource = JSON.stringify(portable);
  try {
    expect(portable.prototypeIssues).toEqual([]); expect(portable.nodes.slice(0, 2).every(node => node.selectionRoot?.geometryRoot && !node.bindings?.style.left && !node.bindings?.style.top && !node.bindings?.style.transform)).toBe(true);
    for (const values of [defaults, [45, -13, 90, 70, 38, 160, 11], [-28, 49, -29, 52, 32, 120, -33], [45, -13, 90, 70, 38, 160, 11]] as const) {
      let session = emptyPrototypeSession(); for (const [index, variable] of variables.entries()) session = assignPrototypeVariable(definitions, session, variable.id, { type: 'literal', value: values[index]! });
      const independent = cloneDesignSubgraph(graph, ids); materializePrototypeBindings(independent, definitions, session, { detachResolved: true });
      const resolved = resolveDesignSelection(portable.nodes, { prototypeVariables: portable.prototypeVariables, prototypeSession: session }, portable.width, portable.height); expectSelectedGeometry(resolved.nodes, resolved.width, resolved.height, independent, ids);
      const rootSizes = Object.fromEntries(ids.map(id => { const node = independent.getNode(id)!; return [id, { width: node.width, height: node.height }]; }));
      const native = await renderNativeReactModel(kit, graph, ids, { session, ...(mode === 'host sizes' ? { rootSizes } : {}) }); expectSelectedGeometry(native.nodes, native.width, native.height, independent, ids); expect(native.nodes.every(node => !node.selectionRoot)).toBe(true);
      for (const [index, color] of [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]].entries()) {
        expectOwnRootPaint(native.nodes[index]!, independent, ids[index]!, color, `Own root native ${mode}/${index}/${values.join(',')}`);
      }
      let prepared = false; const snapshot = selectionToDesignModel(graph, ids, undefined, true, session, undefined, false, undefined, false, () => { prepared = true; }); expect(prepared).toBe(true); expect(snapshot.nodes.every(node => !node.selectionRoot)).toBe(true); expectSelectedGeometry(snapshot.nodes, snapshot.width, snapshot.height, independent, ids);
    }
    expect(JSON.stringify(portable)).toBe(modelSource); expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

it('keeps own baked PNG transforms portable-ineligible while actual source-backed native sessions still render them', async () => {
  const editor = createEditor(), graph = editor.graph, node = graph.createNode('RECTANGLE', editor.state.currentPageId, { name: 'Guarded own PNG', x: 10, y: 8, width: 30, height: 20, fills: [paint({ r: 1, g: 0, b: 0, a: 1 })], strokes: [{ color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, weight: 2, align: 'CENTER' }] });
  const collection = graph.createCollection('Own native painted transforms'), x = graph.createVariable('Painted x', 'FLOAT', collection.id, 10), angle = graph.createVariable('Painted angle', 'FLOAT', collection.id, 0); graph.bindVariable(node.id, 'x', x.id); graph.bindVariable(node.id, 'rotation', angle.id);
  const source = serializeGraph(graph), definitions = capturePrototypeVariables(graph), session = assignPrototypeVariable(definitions, assignPrototypeVariable(definitions, emptyPrototypeSession(), x.id, { type: 'literal', value: 50 }), angle.id, { type: 'literal', value: 37 });
  try {
    const portable = selectionToDesignModel(graph, [node.id], kit); expect(portable.nodes[0]!.image).toMatch(/^data:image\/png;base64,/); expect(portable.nodes[0]!.selectionRoot!.geometryRoot).toBeUndefined(); expect(() => selectionToReact(graph, [node.id], undefined, kit)).toThrow('Variable-bound root transforms of baked artwork');
    const native = await renderNativeReactModel(kit, graph, [node.id], { session }), independent = cloneDesignSubgraph(graph, [node.id]); materializePrototypeBindings(independent, definitions, session, { detachResolved: true }); expect(native.prototypeIssues).toEqual([]); expect(native.nodes[0]!.selectionRoot).toBeUndefined(); expectSelectedGeometry(native.nodes, native.width, native.height, independent, [node.id]);
    const actual = pixels(modelBytes(native.nodes[0]!.image!)), center = (Math.floor(actual.height / 2) * actual.width + Math.floor(actual.width / 2)) * 4; expect([...actual.rgba.slice(center, center + 4)]).toEqual([255, 0, 0, 255]); expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

type SolidElement = { style: Record<string, string>; attributes: Record<string, string>; children: SolidElement[] };
function generatedSolidTree(component: React.ComponentType<DesignProps>, props: DesignProps): SolidElement {
  const html = renderToStaticMarkup(React.createElement(component, props)), stack: SolidElement[] = [], roots: SolidElement[] = [];
  expect(html.replace(/<\/?div\b[^>]*>/g, '').trim()).toBe('');
  for (const match of html.matchAll(/<(\/?)(div)\b([^>]*)>/g)) {
    if (match[1]) { stack.pop(); continue; }
    const attributes = Object.fromEntries([...match[3]!.matchAll(/([\w-]+)="([^"]*)"/g)].map(entry => [entry[1]!, entry[2]!]));
    const style = Object.fromEntries((attributes.style ?? '').split(';').filter(Boolean).map(entry => { const colon = entry.indexOf(':'); return [entry.slice(0, colon), entry.slice(colon + 1)]; }));
    const element: SolidElement = { style, attributes, children: [] }; (stack.at(-1)?.children ?? roots).push(element); stack.push(element);
  }
  expect(stack).toEqual([]); expect(roots).toHaveLength(1); return roots[0]!;
}
function cssRadiusRect(style: string, width: number, height: number) {
  const values = (style || '0').split(/\s+/), corners = values.length === 1 ? Array(4).fill(values[0]) as string[] : values;
  expect(corners).toHaveLength(4);
  const radii = corners.map(value => [Number.parseFloat(value!) * (value!.endsWith('%') ? width / 100 : 1), Number.parseFloat(value!) * (value!.endsWith('%') ? height / 100 : 1)]);
  const ratio = (size: number, sum: number) => sum > 0 ? size / sum : 1;
  const factor = Math.min(1, ratio(width, radii[0]![0]! + radii[1]![0]!), ratio(width, radii[3]![0]! + radii[2]![0]!), ratio(height, radii[0]![1]! + radii[3]![1]!), ratio(height, radii[1]![1]! + radii[2]![1]!));
  return new Float32Array([0, 0, width, height, ...radii.flatMap(pair => pair.map(value => value * factor))]);
}
function generatedSolidPixels(tree: SolidElement, width: number, height: number, opaque: boolean) {
  const surface = kit.MakeSurface(width, height)!, canvas = surface.getCanvas(), brush = new kit.Paint(); brush.setAntiAlias(true);
  const length = (value: string | undefined, parent: number, fallback = 0) => value ? Number.parseFloat(value) * (value.endsWith('%') ? parent / 100 : 1) : fallback;
  const visit = (element: SolidElement, parentWidth: number, parentHeight: number, parentRadius = '0') => {
    const style = element.style; if (Object.hasOwn(element.attributes, 'hidden') || style.display === 'none') return;
    const w = length(style.width, parentWidth, parentWidth), h = length(style.height, parentHeight, parentHeight), radius = style['border-radius'] === 'inherit' ? parentRadius : style['border-radius'] ?? '0';
    canvas.save(); canvas.translate(length(style.left, parentWidth), length(style.top, parentHeight));
    const origin = (style['transform-origin'] ?? '0 0').split(/\s+/), ox = length(origin[0], w), oy = length(origin[1], h); canvas.translate(ox, oy);
    if (style.transform) { expect(style.transform).toMatch(/^matrix\([^)]+\)$/); const [a, b, c, d, x, y] = style.transform.slice(7, -1).split(',').map(Number); canvas.concat([a!, c!, x!, b!, d!, y!, 0, 0, 1]); }
    canvas.translate(-ox, -oy);
    const alpha = Number(style.opacity ?? 1); if (alpha !== 1) { const opacity = new kit.Paint(); opacity.setAlphaf(alpha); canvas.saveLayer(opacity); opacity.delete(); }
    const rounded = cssRadiusRect(radius, w, h);
    if (style['background-color']) { const color = style['background-color'].match(/[\d.]+/g)!.map(Number); expect(color.length).toBeGreaterThanOrEqual(3); brush.setColor(kit.Color(color[0]!, color[1]!, color[2]!, color[3] ?? 1)); canvas.drawRRect(rounded, brush); }
    if (style.overflow === 'hidden') canvas.clipRRect(rounded, kit.ClipOp.Intersect, true);
    for (const child of element.children) visit(child, w, h, radius);
    if (alpha !== 1) canvas.restore(); canvas.restore();
  };
  try { canvas.clear(opaque ? kit.WHITE : kit.TRANSPARENT); canvas.scale(2, 2); visit(tree, width / 2, height / 2); const image = surface.makeImageSnapshot(); try { return pixels(image.encodeToBytes()!); } finally { image.delete(); } }
  finally { brush.delete(); surface.delete(); }
}
function sourceSolidPixels(graph: SceneGraph, ids: string[], minX: number, minY: number, width: number, height: number, opaque: boolean, captureSampling = false) {
  if (captureSampling) return sampledSourceSolidPixels(graph, ids, minX, minY, width, height, opaque);
  const surface = kit.MakeSurface(width, height)!, renderer = createNativeRenderer(kit, surface), canvas = surface.getCanvas(); renderer.worldViewport = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 };
  try {
    canvas.clear(opaque ? kit.WHITE : kit.TRANSPARENT); canvas.scale(2, 2); canvas.translate(-minX, -minY);
    for (const id of ids) { const node = graph.getNode(id)!; if (!node.visible) continue; const parent = node.parentId ? graph.getNode(node.parentId) : undefined; canvas.save(); if (parent) canvas.concat([...getWorldMatrix(parent, graph)]); renderer.renderNode(canvas, graph, id, {}); canvas.restore(); }
    surface.flush(); const image = surface.makeImageSnapshot(); try { return pixels(image.encodeToBytes()!); } finally { image.delete(); }
  } finally { destroyNativeRenderer(renderer); }
}
function sampledSourceSolidPixels(graph: SceneGraph, ids: string[], minX: number, minY: number, width: number, height: number, opaque: boolean) {
  let high: Surface | null = null, low: Surface | null = null, highPixels: MallocObj | undefined, lowPixels: MallocObj | undefined, renderer: ReturnType<typeof createNativeRenderer> | undefined, failure: { reason: unknown } | undefined;
  try {
    // MakeSurface is Unpremul; capture interpolation requires premultiplied sRGB storage at both resolutions.
    highPixels = kit.Malloc(Uint8Array, width * height * 16); highPixels.toTypedArray().fill(0); high = kit.MakeRasterDirectSurface({ width: width * 2, height: height * 2, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, highPixels, width * 8); if (!high) throw new Error('Could not allocate source reference high surface.');
    lowPixels = kit.Malloc(Uint8Array, width * height * 4); lowPixels.toTypedArray().fill(0); low = kit.MakeRasterDirectSurface({ width, height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, lowPixels, width * 4); if (!low) throw new Error('Could not allocate source reference low surface.');
    renderer = createNativeRenderer(kit, high); renderer.worldViewport = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 }; const canvas = high.getCanvas(); canvas.clear(opaque ? kit.WHITE : kit.TRANSPARENT); canvas.scale(4, 4); canvas.translate(-minX, -minY);
    for (const id of ids) { const node = graph.getNode(id)!; if (!node.visible) continue; const parent = node.parentId ? graph.getNode(node.parentId) : undefined; canvas.save(); if (parent) canvas.concat([...getWorldMatrix(parent, graph)]); renderer.renderNode(canvas, graph, id, {}); canvas.restore(); }
    high.flush(); const image = high.makeImageSnapshot(); try {
      const canvas = low.getCanvas(); canvas.clear(kit.TRANSPARENT); canvas.drawImageRectOptions(image, kit.LTRBRect(0, 0, width * 2, height * 2), kit.LTRBRect(0, 0, width, height), kit.FilterMode.Linear, kit.MipmapMode.None, null); low.flush(); const output = low.makeImageSnapshot(); try { return pixels(output.encodeToBytes()!); } finally { output.delete(); }
    } finally { image.delete(); }
  } catch (error) { failure = { reason: error }; throw error; }
  finally { releaseNativeResources([() => renderer ? destroyNativeRenderer(renderer) : high?.delete(), () => low?.delete(), () => freeNativeSurfacePixels(kit, high, highPixels), () => freeNativeSurfacePixels(kit, low, lowPixels)], failure); }
}
function expectExactSourcePixels(actual: ReturnType<typeof pixels>, expected: ReturnType<typeof pixels>, label: string, imageStyle: DesignNode['imageStyle']) {
  expect([actual.width, actual.height], label).toEqual([expected.width, expected.height]); let changedBytes = 0, changedPixels = 0, maximum = 0, first = -1, worst = 0;
  for (let offset = 0; offset < actual.rgba.length; offset += 4) { let changed = false; for (let channel = 0; channel < 4; channel++) { const difference = Math.abs(actual.rgba[offset + channel]! - expected.rgba[offset + channel]!); if (difference) { changed = true; changedBytes++; if (first < 0) first = offset; } if (difference > maximum) { maximum = difference; worst = offset; } } if (changed) changedPixels++; }
  const pixel = (offset: number) => offset < 0 ? undefined : { x: offset / 4 % actual.width, y: Math.floor(offset / 4 / actual.width), actual: [...actual.rgba.slice(offset, offset + 4)], expected: [...expected.rgba.slice(offset, offset + 4)] };
  expect(actual.hash, JSON.stringify({ label, imageStyle, changedBytes, changedPixels, maximum, first: pixel(first), worst: pixel(worst) })).toBe(expected.hash);
}
function expectSolidScene(actual: ReturnType<typeof pixels>, expected: ReturnType<typeof pixels>, label: string, opaque: boolean) {
  expect([actual.width, actual.height], label).toEqual([expected.width, expected.height]); let worst = 0, maximum = 0;
  // Straight RGB at sub-byte alpha amplifies storage rounding; keep raw alpha and every premultiplied channel in the transparent comparison.
  const channel = (rgba: Uint8Array, index: number) => !opaque && index % 4 !== 3 ? rgba[index]! * rgba[index - index % 4 + 3]! / 255 : rgba[index]!;
  for (let index = 0; index < actual.rgba.length; index++) { const difference = Math.abs(channel(actual.rgba, index) - channel(expected.rgba, index)); if (difference > maximum) { maximum = difference; worst = index - index % 4; } }
  expect(maximum, `${label} at ${worst / 4 % actual.width},${Math.floor(worst / 4 / actual.width)} actual ${[...actual.rgba.slice(worst, worst + 4)]}, expected ${[...expected.rgba.slice(worst, worst + 4)]}`).toBeLessThanOrEqual(2);
}

it.each(['rectangle', 'rounded', 'ellipse', 'asymmetric', 'oversized', 'oversized uniform', 'clipped frame', 'overflow frame', 'ignored ellipse smoothing', 'ignored zero-radius smoothing'] as const)('matches exact generated CSS %s paint to an independent whole-scene native reference at authored and live geometry', family => {
  const editor = createEditor(), graph = editor.graph, page = editor.state.currentPageId, parent = graph.createNode('FRAME', page, { x: 90, y: 60, width: 140, height: 100, rotation: 23, flipY: true, fills: [] });
  const frame = family.endsWith('frame'), type = family === 'ellipse' || family === 'ignored ellipse smoothing' ? 'ELLIPSE' : family === 'rounded' || family.startsWith('oversized') ? 'ROUNDED_RECTANGLE' : family === 'asymmetric' || frame ? 'FRAME' : 'RECTANGLE';
  const selected = graph.createNode(type, parent.id, { name: 'Native CSS solid', x: 12, y: 8, width: 40, height: 24, rotation: 31, flipX: true, flipY: family === 'ellipse', opacity: frame ? .75 : 1, cornerRadius: family === 'oversized uniform' ? 80 : family === 'rounded' || frame ? 6 : 0, clipsContent: family === 'clipped frame', fills: [paint({ r: 1, g: 0, b: 0, a: 1 })] });
  if (family === 'asymmetric' || family === 'oversized') Object.assign(selected, { independentCorners: true, topLeftRadius: family === 'oversized' ? 80 : 3, topRightRadius: family === 'oversized' ? 30 : 8, bottomRightRadius: family === 'oversized' ? 70 : 12, bottomLeftRadius: family === 'oversized' ? 20 : 5 });
  if (family.startsWith('ignored')) Object.assign(selected, { cornerSmoothing: .6, cornerRadius: family === 'ignored ellipse smoothing' ? 8 : 0 });
  if (frame) graph.createNode('RECTANGLE', selected.id, { x: -5, y: 8, width: 50, height: 20, horizontalConstraint: 'STRETCH', verticalConstraint: 'STRETCH', fills: [paint({ r: 0, g: 0, b: 1, a: 1 })] });
  const anchor = graph.createNode('RECTANGLE', page, { name: 'Native CSS anchor', x: -80, y: 180, width: 12, height: 10, fills: [paint({ r: 0, g: 1, b: 0, a: 1 })] }), hidden = graph.createNode('RECTANGLE', page, { x: 350, y: -100, width: 8, height: 8, visible: false, fills: [paint({ r: 0, g: 0, b: 0, a: 1 })] });
  const collection = graph.createCollection('Native solid variables'), defaults = [12, 8, 31, 40, 24], variables = defaults.map((value, index) => graph.createVariable(`Native solid ${index}`, 'FLOAT', collection.id, value)); for (const [index, field] of ['x', 'y', 'rotation', 'width', 'height'].entries()) graph.bindVariable(selected.id, field!, variables[index]!.id);
  const ids = [selected.id, anchor.id, hidden.id], definitions = capturePrototypeVariables(graph), source = serializeGraph(graph), delivered = selectionToReact(graph, ids), exports: { default?: React.ComponentType<DesignProps> } = {};
  const code = transform(delivered.code, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'automatic', production: true }).code; new Function('require', 'exports', code)((id: string) => { if (id === 'react') return React; if (id === 'react/jsx-runtime') return jsxRuntime; throw new Error(`Unexpected generated dependency ${id}`); }, exports);
  try {
    for (const values of [defaults, [28, -12, 90, 64, 40], [-15, 26, -29, 32, 18], [28, -12, 90, 64, 40]]) {
      let session = emptyPrototypeSession(); for (const [index, variable] of variables.entries()) session = assignPrototypeVariable(definitions, session, variable.id, { type: 'literal', value: values[index]! }); const independent = cloneDesignSubgraph(graph, ids); materializePrototypeBindings(independent, definitions, session, { detachResolved: true });
      const bounds = ids.map(id => getAxisAlignedWorldBounds(independent.getNode(id)!, independent)), minX = Math.min(...bounds.map(rect => rect.x)), minY = Math.min(...bounds.map(rect => rect.y)), w = Math.max(...bounds.map(rect => rect.x + rect.width)) - minX, h = Math.max(...bounds.map(rect => rect.y + rect.height)) - minY, tree = generatedSolidTree(exports.default!, { prototypeSession: session });
      expect(Number.parseFloat(tree.style.width!)).toBeCloseTo(w, 8); expect(Number.parseFloat(tree.style.height!)).toBeCloseTo(h, 8); const width = Math.ceil(w * 2), height = Math.ceil(h * 2);
      for (const opaque of [true, false]) {
        const actual = generatedSolidPixels(tree, width, height, opaque), expected = sourceSolidPixels(independent, ids, minX, minY, width, height, opaque); expectSolidScene(actual, expected, `${family}/${values.join(',')}/${opaque}`, opaque);
        const x = Math.floor((anchor.x + 4 - minX) * 2), y = Math.floor((anchor.y + 4 - minY) * 2), offset = (y * width + x) * 4; expect([...actual.rgba.slice(offset, offset + 4)]).toEqual([0, 255, 0, 255]); expect([...expected.rgba.slice(offset, offset + 4)]).toEqual([0, 255, 0, 255]);
        const node = independent.getNode(selected.id)!, center = TransformMatrix.mapPoint(getWorldMatrix(node, independent), { x: node.width / 2, y: node.height / 2 }), centerOffset = (Math.floor((center.y - minY) * 2) * width + Math.floor((center.x - minX) * 2)) * 4, color = frame ? opaque ? [64, 64, 255, 255] : [0, 0, 255, 191] : [255, 0, 0, 255];
        for (const image of [actual, expected]) { for (const [channel, value] of color.entries()) expect(Math.abs(image.rgba[centerOffset + channel]! - value)).toBeLessThanOrEqual(1); expect([...image.rgba.slice(0, 4)]).toEqual(opaque ? [255, 255, 255, 255] : [0, 0, 0, 0]); }
      }
    }
    expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

it.each(['smoothing', 'negative radius', 'nonfinite radius', 'stroke', 'effect', 'backdrop', 'arc', 'vector', 'mask', 'blend', 'fill blend', 'image', 'translucent fill', 'multiple fills', 'border'] as const)('retains the live CSS solid fidelity guard for %s artwork', family => {
  const editor = createEditor(), graph = editor.graph, node = graph.createNode(family === 'arc' ? 'ELLIPSE' : 'RECTANGLE', editor.state.currentPageId, { name: 'Guarded solid paint', x: 10, y: 8, width: 40, height: 24, rotation: 31, flipX: true, cornerRadius: 6, fills: [paint({ r: 1, g: 0, b: 0, a: 1 })] });
  if (family === 'smoothing') node.cornerSmoothing = .6; if (family === 'negative radius') node.cornerRadius = -1; if (family === 'nonfinite radius') node.cornerRadius = NaN;
  if (family === 'stroke') node.strokes = [{ color: blue, opacity: 1, visible: true, weight: 2, align: 'CENTER' }];
  if (family === 'effect' || family === 'backdrop') node.effects = [{ type: family === 'backdrop' ? 'BACKGROUND_BLUR' : 'DROP_SHADOW', visible: true, radius: 2, spread: 0, offset: { x: 1, y: 1 }, color: blue }];
  if (family === 'arc') node.arcData = { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 }; if (family === 'vector') node.vectorNetwork = parseSVGPath('M0 0L40 0L0 24Z'); if (family === 'mask') node.isMask = true; if (family === 'blend') node.blendMode = 'MULTIPLY'; if (family === 'fill blend') node.fills[0]!.blendMode = 'MULTIPLY';
  if (family === 'image') { graph.images.set('guarded-solid-image', imageAsset()); node.fills = [{ type: 'IMAGE', visible: true, opacity: 1, color: red, imageHash: 'guarded-solid-image', imageScaleMode: 'CROP' }]; }
  if (family === 'translucent fill') node.fills[0]!.opacity = .5; if (family === 'multiple fills') node.fills.push(paint(blue)); if (family === 'border') node.borderTopWeight = 2;
  const collection = graph.createCollection('Guarded solid binding'), x = graph.createVariable('Guarded solid x', 'FLOAT', collection.id, 10); graph.bindVariable(node.id, 'x', x.id); const source = serializeGraph(graph);
  try {
    if (family === 'mask') expect(() => selectionToDesignModel(graph, [node.id], kit)).toThrow('mask');
    else { const model = selectionToDesignModel(graph, [node.id], kit); expect(model.nodes[0]!.style.backgroundColor).toBeUndefined(); expect(model.nodes[0]!.selectionRoot!.geometryRoot).toBeUndefined(); expect(() => selectionToReact(graph, [node.id], undefined, kit)).toThrow('source-backed rendering'); }
    expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

it.each(['arc', 'smoothing', 'fill blend', 'vector', 'fill geometry', 'stroke geometry', 'border', 'independent strokes'] as const)('retains original %s artwork and refuses an unfaithful live fill replacement', family => {
  const editor = createEditor(), graph = editor.graph, node = graph.createNode(family === 'arc' ? 'ELLIPSE' : 'RECTANGLE', editor.state.currentPageId, { name: 'Bound complex fill', width: 40, height: 24, cornerRadius: 10, fills: [paint()] });
  const blob = new Uint8Array(28), coordinates = new DataView(blob.buffer); blob[0] = 1; blob[9] = 2; coordinates.setFloat32(10, 40, true); blob[18] = 2; coordinates.setFloat32(23, 24, true);
  if (family === 'arc') node.arcData = { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 };
  if (family === 'smoothing') node.cornerSmoothing = .6;
  if (family === 'fill blend') node.fills[0]!.blendMode = 'MULTIPLY';
  if (family === 'vector') node.vectorNetwork = parseSVGPath('M0 0L40 0L0 24Z');
  if (family === 'fill geometry') node.fillGeometry = [{ commandsBlob: blob, windingRule: 'NONZERO' }];
  if (family === 'stroke geometry') node.strokeGeometry = [{ commandsBlob: blob, windingRule: 'NONZERO' }];
  if (family === 'border') node.borderTopWeight = 2;
  if (family === 'independent strokes') node.independentStrokeWeights = true;
  const collection = graph.createCollection('Complex live fill'), color = graph.createVariable('Complex color', 'COLOR', collection.id, red); graph.bindVariable(node.id, 'fills/0/color', color.id);
  try {
    const baseline = selectionToDesignModel(graph, [node.id], kit); expect(baseline.prototypeIssues).toEqual([]); expect(baseline.nodes[0]!.image).toBeDefined(); expect(baseline.nodes[0]!.style.backgroundColor).toBeUndefined(); expect(baseline.nodes[0]!.bindings?.style.backgroundColor).toBeUndefined();
    setNavigation(editor, node, { action: 'set-variable', variable: color.id, value: { type: 'literal', value: blue }, transition: 'instant', duration: 0 }); const source = serializeGraph(graph), model = selectionToDesignModel(graph, [node.id], kit);
    expect(model.nodes[0]!.image).toBe(baseline.nodes[0]!.image); expect(model.nodes[0]!.style.backgroundColor).toBeUndefined(); expect(model.nodes[0]!.bindings?.style.backgroundColor).toBeUndefined(); expect(model.prototypeIssues).toContain('Bound complex fill: This variable-bound artwork or layout needs native presentation; its React binding cannot update faithfully yet.'); expect(() => selectionToReact(graph, [node.id], undefined, kit)).toThrow('cannot update faithfully'); expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

it.each(['arc', 'smoothing'] as const)('keeps source-backed native %s fill playback available with original shape pixels', async family => {
  const editor = createEditor(), graph = editor.graph, node = graph.createNode(family === 'arc' ? 'ELLIPSE' : 'RECTANGLE', editor.state.currentPageId, { name: 'Native complex fill', width: 40, height: 24, cornerRadius: 10, fills: [paint({ r: 1, g: 0, b: 0, a: 1 })] });
  if (family === 'arc') node.arcData = { startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 }; else node.cornerSmoothing = .6;
  const collection = graph.createCollection('Native complex colors'), variable = graph.createVariable('Complex source color', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 }); graph.bindVariable(node.id, 'fills/0/color', variable.id); const definitions = capturePrototypeVariables(graph), source = serializeGraph(graph);
  try {
    for (const color of [{ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 }, { r: 0, g: 1, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 }]) {
      const session = assignPrototypeVariable(definitions, emptyPrototypeSession(), variable.id, { type: 'literal', value: color }), independent = cloneDesignSubgraph(graph, [node.id]); materializePrototypeBindings(independent, definitions, session, { detachResolved: true });
      const model = await renderNativeReactModel(kit, graph, [node.id], { session }), actual = pixels(modelBytes(model.nodes[0]!.image!)), expected = sourceSolidPixels(independent, [node.id], 0, 0, 80, 48, false, true);
      expect(model.prototypeIssues).toEqual([]); expect(model.nodes[0]!.bindings).toBeUndefined(); expect(model.nodes[0]!.selectionRoot).toBeUndefined(); expect([actual.width, actual.height]).toEqual([80, 48]); expectExactSourcePixels(actual, expected, `${family}/${JSON.stringify(color)}`, model.nodes[0]!.imageStyle);
      const interior = (36 * actual.width + 40) * 4; expect([...actual.rgba.slice(interior, interior + 4)]).toEqual([color.r * 255, color.g * 255, color.b * 255, 255]); expect([...actual.rgba.slice(0, 4)]).toEqual([0, 0, 0, 0]); if (family === 'arc') expect([...actual.rgba.slice((8 * actual.width + 40) * 4, (8 * actual.width + 40) * 4 + 4)]).toEqual([0, 0, 0, 0]);
    }
    expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

it.each(['component', 'instance'] as const)('matches realized %s live fill and clipping to independent native source paint', family => {
  const editor = createEditor(), graph = editor.graph, owner = graph.createNode('COMPONENT', editor.state.currentPageId, { name: 'Painted container', width: 48, height: 32, cornerRadius: 6, clipsContent: true, fills: [paint({ r: 1, g: 0, b: 0, a: 1 })] });
  graph.createNode('RECTANGLE', owner.id, { name: 'Clipped blue paint', x: 36, y: 8, width: 20, height: 16, fills: [paint({ r: 0, g: 0, b: 1, a: 1 })] });
  const collection = graph.createCollection('Container pixel colors'), variable = graph.createVariable('Container pixel color', 'COLOR', collection.id, { r: 1, g: 0, b: 0, a: 1 }); graph.bindVariable(owner.id, 'fills/0/color', variable.id);
  const selected = family === 'component' ? owner : graph.createInstance(owner.id, editor.state.currentPageId)!; if (family === 'instance') graph.bindVariable(selected.id, 'fills/0/color', variable.id);
  const anchor = graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 80, width: 8, height: 8, fills: [paint({ r: 0, g: 1, b: 0, a: 1 })] }), ids = [selected.id, anchor.id], definitions = capturePrototypeVariables(graph), source = serializeGraph(graph), model = selectionToDesignModel(graph, ids, kit), savedModel = JSON.stringify(model), delivered = selectionToReact(graph, ids, undefined, kit), exports: { default?: React.ComponentType<DesignProps> } = {};
  const code = transform(delivered.code, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'automatic', production: true }).code; new Function('require', 'exports', code)((id: string) => { if (id === 'react') return React; if (id === 'react/jsx-runtime') return jsxRuntime; throw new Error(`Unexpected generated dependency ${id}`); }, exports);
  try {
    const unbound = cloneDesignSubgraph(graph, ids); for (const node of unbound.nodes.values()) node.boundVariables = {}; expect(selectionToDesignModel(unbound, ids, kit).nodes[0]!.image).toBeDefined(); expect(model.nodes[0]!.image).toBeUndefined();
    for (const color of [{ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 }, { r: 0, g: 1, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 }]) {
      const session = assignPrototypeVariable(definitions, emptyPrototypeSession(), variable.id, { type: 'literal', value: color }), independent = cloneDesignSubgraph(graph, ids); prepareNativeSceneComponents(independent, ids); materializePrototypeBindings(independent, definitions, session, { detachResolved: true }); const tree = generatedSolidTree(exports.default!, { prototypeSession: session });
      expect(Number.parseFloat(tree.style.width!)).toBe(88); expect(Number.parseFloat(tree.style.height!)).toBe(32);
      for (const opaque of [true, false]) {
        const actual = generatedSolidPixels(tree, 176, 64, opaque), expected = sourceSolidPixels(independent, ids, 0, 0, 176, 64, opaque); expectSolidScene(actual, expected, `${family}/${JSON.stringify(color)}/${opaque}`, opaque);
        for (const image of [actual, expected]) for (const [x, y, rgba] of [[8, 16, [color.r * 255, color.g * 255, color.b * 255, 255]], [40, 16, [0, 0, 255, 255]], [52, 16, opaque ? [255, 255, 255, 255] : [0, 0, 0, 0]], [84, 4, [0, 255, 0, 255]]] as const) { const offset = (y * 2 * image.width + x * 2) * 4; expect([...image.rgba.slice(offset, offset + 4)]).toEqual([...rgba]); }
      }
    }
    expect(JSON.stringify(model)).toBe(savedModel); expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

it.each(['hidden first', 'hidden second'] as const)('routes a color binding by the actual paint index with %s fill', async family => {
  const editor = createEditor(), graph = editor.graph, visible = paint({ r: 0, g: 1, b: 0, a: 1 }), hidden = { ...paint({ r: 1, g: 0, b: 0, a: 1 }), visible: false }, node = graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 24, fills: family === 'hidden first' ? [hidden, visible] : [visible, hidden] }), collection = graph.createCollection('Indexed colors'), variable = graph.createVariable('Indexed color', 'COLOR', collection.id, family === 'hidden first' ? red : visible.color); graph.bindVariable(node.id, 'fills/0/color', variable.id); setNavigation(editor, node, { action: 'set-variable', variable: variable.id, value: { type: 'literal', value: { r: 0, g: 0, b: 1, a: 1 } }, transition: 'instant', duration: 0 });
  const source = serializeGraph(graph), model = selectionToDesignModel(graph, [node.id], kit), definitions = capturePrototypeVariables(graph), session = assignPrototypeVariable(definitions, emptyPrototypeSession(), variable.id, { type: 'literal', value: { r: 0, g: 0, b: 1, a: 1 } });
  try {
    expect(model.nodes[0]!.style.backgroundColor).toBe('rgba(0,255,0,1)');
    if (family === 'hidden first') { expect(model.nodes[0]!.bindings?.style.backgroundColor).toBeUndefined(); expect(() => selectionToReact(graph, [node.id], undefined, kit)).toThrow('cannot update faithfully'); }
    else { expect(model.prototypeIssues).toEqual([]); expect(model.nodes[0]!.bindings?.style.backgroundColor).toBe(variable.id); expect(() => selectionToReact(graph, [node.id], undefined, kit)).not.toThrow(); }
    const native = await renderNativeReactModel(kit, graph, [node.id], { session }), actual = pixels(modelBytes(native.nodes[0]!.image!)), rgba = family === 'hidden first' ? [0, 255, 0, 255] : [0, 0, 255, 255]; expect(native.prototypeIssues).toEqual([]); for (let offset = 0; offset < actual.rgba.length; offset += 4) expect([...actual.rgba.slice(offset, offset + 4)]).toEqual(rgba); expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

type FlexCalibration = ReturnType<typeof flexCalibrationFixture>;
function flexCalibrationFixture(graph: SceneGraph, page: string, axis: 'HORIZONTAL' | 'VERTICAL', family: 'fixed cross' | 'stretch cross' | 'self minimum' | 'transformed') {
  const root = graph.createNode('FRAME', page, { name: `${axis} ${family}`, x: -140, y: -90, width: 300, height: 120, fills: [], clipsContent: false,
    layoutMode: axis, primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED', counterAxisAlign: family === 'fixed cross' ? 'MIN' : 'STRETCH', itemSpacing: 0 });
  graph.createNode('RECTANGLE', root.id, { name: 'Fixed sixty-pixel sibling', width: axis === 'HORIZONTAL' ? 60 : 48, height: axis === 'HORIZONTAL' ? 48 : 60, layoutAlignSelf: 'MIN', fills: [paint({ r: .2, g: .2, b: .2, a: 1 })] });
  const frame = graph.createNode('FRAME', root.id, { name: 'Authored eighty-pixel grow Frame', width: 80, height: 80, fills: [], clipsContent: false, layoutGrow: 1,
    layoutAlignSelf: family === 'self minimum' ? 'MIN' : 'AUTO', ...(family === 'transformed' ? { rotation: 31, flipX: true } : {}) });
  const specifications = [
    { constraint: 'STRETCH' as const, x: 8, y: 6, width: 20, height: 12, color: [255, 0, 0, 255] },
    { constraint: 'MAX' as const, x: 8, y: 6, width: 20, height: 12, color: [0, 0, 255, 255] },
    { constraint: 'CENTER' as const, x: 40, y: 40, width: 8, height: 8, color: [0, 255, 0, 255] },
    { constraint: 'SCALE' as const, x: 40, y: 56, width: 8, height: 8, color: [255, 255, 0, 255] },
    { constraint: 'MIN' as const, x: 40, y: 20, width: 8, height: 8, color: [255, 0, 255, 255] },
  ];
  const children = specifications.map(specification => {
    const { constraint, color, ...rect } = specification;
    const child = graph.createNode('RECTANGLE', frame.id, { name: `${constraint} paint`, ...rect, layoutPositioning: 'ABSOLUTE', horizontalConstraint: constraint, verticalConstraint: constraint,
      fills: [paint({ r: color[0]! / 255, g: color[1]! / 255, b: color[2]! / 255, a: 1 })] });
    return { id: child.id, ...specification };
  });
  return { root, frame, children, axis, family };
}

function independentFlexCalibration(graph: SceneGraph, fixture: FlexCalibration, size: { width: number; height: number }) {
  const copy = cloneDesignSubgraph(graph, [fixture.root.id]), root = copy.getNode(fixture.root.id)!;
  Object.assign(root, size);
  // SDK Yoga settles flow geometry; its public resize primitive separately materializes
  // absolute children from the authored 80×80 box, without the React measurement runtime.
  computeAllLayouts(copy, root.id);
  const frame = copy.getNode(fixture.frame.id)!;
  const cross = fixture.family === 'fixed cross' || fixture.family === 'self minimum' ? 80 : fixture.axis === 'HORIZONTAL' ? size.height : size.width;
  expect({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }).toEqual(fixture.axis === 'HORIZONTAL'
    ? { x: 60, y: 0, width: size.width - 60, height: cross }
    : { x: 0, y: 60, width: cross, height: size.height - 60 });
  for (const child of fixture.children) {
    const rect = constrainedChildRect(child, { width: 80, height: 80 }, frame, child.constraint, child.constraint);
    Object.assign(copy.getNode(child.id)!, rect);
    if (child.constraint === 'MAX') expect(rect).toEqual({ x: frame.width - 72, y: frame.height - 74, width: 20, height: 12 });
    if (child.constraint === 'STRETCH') expect(rect).toEqual({ x: 8, y: 6, width: frame.width - 60, height: frame.height - 68 });
  }
  // Freeze the independently settled SDK rectangles before painting; this does not
  // replace any pixels or run the host's native layout/React measurement helpers.
  for (const node of copy.nodes.values()) { node.layoutMode = 'NONE'; node.layoutGrow = 0; }
  copy.clearAbsPosCache();
  return copy;
}

async function flexCalibrationWorker(graph: string, ids: string[]) {
  const wasm = readFileSync(createRequire(import.meta.url).resolve('canvaskit-wasm/bin/canvaskit.wasm'));
  const harness = `const {parentPort,workerData}=require('node:worker_threads');const vm=require('node:vm');
    const context=vm.createContext({console,TextEncoder,TextDecoder,setTimeout,clearTimeout,performance,Blob,URL,atob,btoa,fetch:input=>{if(!String(input).startsWith('blob:'))throw Error('Network request attempted');return fetch(input);}});
    context.postMessage=message=>parentPort.postMessage(message);context.__source=workerData.graph;context.__ids=workerData.ids;context.__wasm=workerData.wasm;
    vm.runInContext("self=globalThis;structuredClone=value=>{const seen=new Map();const copy=item=>{if(item===null||typeof item!=='object')return item;if(seen.has(item))return seen.get(item);let result;if(item instanceof ArrayBuffer)result=item.slice(0);else if(ArrayBuffer.isView(item))result=new item.constructor(copy(item.buffer),item.byteOffset,item.length);else if(item instanceof Map){result=new Map();seen.set(item,result);for(const[key,value]of item)result.set(copy(key),copy(value));}else if(item instanceof Set){result=new Set();seen.set(item,result);for(const value of item)result.add(copy(value));}else{result=Array.isArray(item)?[]:{};seen.set(item,result);for(const[key,value]of Object.entries(item))result[key]=copy(value);}return result;};return copy(value);};",context);
    vm.runInContext(workerData.source,context,{timeout:10000});
    parentPort.on('message',input=>{context.__input=JSON.stringify(input);vm.runInContext('self.onmessage({data:JSON.parse(__input)})',context);});
    vm.runInContext("self.onmessage({data:{type:'init',payload:{graph:__source,ids:__ids,wasm:Uint8Array.from(atob(__wasm),c=>c.charCodeAt(0)),fonts:{version:1,faces:[],registrations:[],cjkFallbackFamilies:[],arabicFallbackFamilies:[]}}}})",context);`;
  const worker = new Worker(harness, { eval: true, workerData: { graph, ids, wasm: wasm.toString('base64'), source: workerBundle.source } });
  const inbox: NativeReactOutput[] = [];
  const waits: { resolve: (value: NativeReactOutput) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  let failure: Error | undefined;
  worker.on('message', (message: NativeReactOutput) => { const wait = waits.shift(); if (wait) { clearTimeout(wait.timer); wait.resolve(message); } else inbox.push(message); });
  const fail = (error: Error) => { failure = error; for (const wait of waits.splice(0)) { clearTimeout(wait.timer); wait.reject(error); } };
  worker.on('error', fail); worker.on('exit', code => { if (code) fail(new Error(`Calibration worker exited ${code}.`)); });
  const next = (): Promise<NativeReactOutput> => failure ? Promise.reject(failure) : inbox.length ? Promise.resolve(inbox.shift()!) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => { const index = waits.findIndex(wait => wait.timer === timer); if (index >= 0) waits.splice(index, 1); reject(new Error('Native flex calibration timed out.')); }, 25000);
    waits.push({ resolve, reject, timer });
  });
  return { worker, next };
}

it.each(['HORIZONTAL', 'VERTICAL'] as const)('calibrates %s flex-grown Frame constraints against private SDK layout and actual offline worker PNGs', async axis => {
  const editor = createEditor(), graph = editor.graph;
  const families = axis === 'HORIZONTAL' ? ['fixed cross', 'stretch cross', 'self minimum', 'transformed'] as const : ['fixed cross', 'stretch cross', 'self minimum'] as const;
  const fixtures = families.map(family => flexCalibrationFixture(graph, editor.state.currentPageId, axis, family));
  const source = serializeGraph(graph), transport = await flexCalibrationWorker(source, fixtures.map(fixture => fixture.root.id));
  try {
    expect(await transport.next()).toEqual({ type: 'ready' });
    let id = 0;
    for (const fixture of fixtures) {
      const measurements = axis === 'HORIZONTAL' ? [{ width: 220, height: 120 }, { width: 300, height: 160 }, { width: 220, height: 120 }] : [{ width: 160, height: 180 }, { width: 240, height: 220 }, { width: 160, height: 180 }];
      const hashes: string[] = [];
      for (const size of measurements) {
        const reference = independentFlexCalibration(graph, fixture, size), frame = reference.getNode(fixture.frame.id)!;
        const request = { rootId: fixture.root.id, rootSizes: { [fixture.root.id]: size } };
        const prepared = new Map<string, { x: number; y: number; width: number; height: number }>();
        const native = await renderNativeReactModel(kit, graph, [fixture.root.id], request, scene => {
          for (const nodeId of [fixture.frame.id, ...fixture.children.map(child => child.id)]) { const node = scene.getNode(nodeId)!; prepared.set(nodeId, { x: node.x, y: node.y, width: node.width, height: node.height }); }
        });
        for (const nodeId of prepared.keys()) { const expected = reference.getNode(nodeId)!; expect(prepared.get(nodeId), `${axis}/${fixture.family}/${nodeId}`).toEqual({ x: expected.x, y: expected.y, width: expected.width, height: expected.height }); }
        const artwork = renderNativeSceneImage(kit, reference, reference.getNode(fixture.root.id)!, true), expected = pixels(artwork.bytes);
        const actual = pixels(modelBytes(native.nodes[0]!.image!));
        expectExactSourcePixels(actual, expected, `${axis}/${fixture.family}/${JSON.stringify(size)}`, native.nodes[0]!.imageStyle);
        const inverse = TransformMatrix.invert(getWorldMatrix(reference.getNode(fixture.root.id)!, reference))!;
        for (const child of fixture.children) {
          const node = reference.getNode(child.id)!, relative = TransformMatrix.multiply(inverse, getWorldMatrix(node, reference));
          const point = TransformMatrix.mapPoint(relative, { x: node.width / 2, y: node.height / 2 });
          // The broad stretch paint has later paints over its center; its corner remains red.
          const sample = child.constraint === 'STRETCH' ? TransformMatrix.mapPoint(relative, { x: 3, y: 3 }) : point;
          const x = Math.floor((sample.x - artwork.bounds.minX) * artwork.scale), y = Math.floor((sample.y - artwork.bounds.minY) * artwork.scale), offset = (y * expected.width + x) * 4;
          expect([...actual.rgba.slice(offset, offset + 4)], `${fixture.family}/${child.constraint} literal paint at ${x},${y}`).toEqual(child.color);
        }
        transport.worker.postMessage({ type: 'render', id: ++id, request });
        const response = await transport.next(); expect(response.type, response.type === 'error' ? response.message : fixture.family).toBe('model');
        if (response.type !== 'model') throw new Error('Missing native flex calibration model.');
        expect(response.id).toBe(id); expectExactSourcePixels(pixels(modelBytes(response.model.nodes[0]!.image!)), expected, `offline/${axis}/${fixture.family}/${JSON.stringify(size)}`, response.model.nodes[0]!.imageStyle);
        hashes.push(actual.hash);
        expect(serializeGraph(graph)).toBe(source);
        if (fixture.family === 'transformed') {
          const bounds = getAxisAlignedWorldBounds(frame, reference); expect(Math.abs(bounds.width - frame.width)).toBeGreaterThan(1); expect(Math.abs(bounds.height - frame.height)).toBeGreaterThan(1);
        }
      }
      expect(hashes[0]).not.toBe(hashes[1]); expect(hashes[2]).toBe(hashes[0]);
    }
  } finally { await transport.worker.terminate(); editor.dispose(); }
}, 45000);

type OwnLayoutCalibration = ReturnType<typeof ownLayoutCalibrationFixture>;
function ownLayoutCalibrationFixture(graph: SceneGraph, page: string, outerAxis: 'HORIZONTAL' | 'VERTICAL', innerAxis: 'HORIZONTAL' | 'VERTICAL', between: boolean) {
  const inner = graph.createNode('FRAME', page, { name: `${outerAxis}/${innerAxis}/${between} own layout`, width: 100, height: 80, layoutMode: innerAxis, layoutGrow: 1,
    primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED', layoutWrap: 'NO_WRAP', counterAxisAlign: 'MIN', primaryAxisAlign: between ? 'SPACE_BETWEEN' : 'MIN',
    paddingTop: 6, paddingRight: 8, paddingBottom: 10, paddingLeft: 12, itemSpacing: 11, counterAxisSpacing: 7, minWidth: 40, maxWidth: 600, minHeight: 40, maxHeight: 500, fills: [] });
  const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [255, 255, 0, 255]];
  const flow = [28, 20, 16].map((main, index) => {
    const color = colors[index]!, child = graph.createNode('RECTANGLE', inner.id, { name: `Own layout flow ${index}`, width: innerAxis === 'HORIZONTAL' ? main : 16, height: innerAxis === 'HORIZONTAL' ? 16 : main,
      layoutGrow: between || index === 0 ? 0 : index, layoutAlignSelf: 'MIN', fills: [paint({ r: color[0]! / 255, g: color[1]! / 255, b: color[2]! / 255, a: 1 })] });
    return { id: child.id, color };
  });
  const specifications = innerAxis === 'HORIZONTAL' ? [
    { constraint: 'STRETCH' as const, x: 8, y: 60, width: 20, height: 8, color: [255, 0, 255, 255] },
    { constraint: 'MAX' as const, x: 8, y: 40, width: 20, height: 8, color: [0, 0, 255, 255] },
  ] : [
    { constraint: 'STRETCH' as const, x: 80, y: 8, width: 8, height: 20, color: [255, 0, 255, 255] },
    { constraint: 'MAX' as const, x: 60, y: 8, width: 8, height: 20, color: [0, 0, 255, 255] },
  ];
  const absolute = specifications.map(({ constraint, color, ...rect }) => {
    const child = graph.createNode('RECTANGLE', inner.id, { name: `Own layout ${constraint}`, ...rect, layoutPositioning: 'ABSOLUTE', horizontalConstraint: constraint, verticalConstraint: constraint,
      fills: [paint({ r: color[0]! / 255, g: color[1]! / 255, b: color[2]! / 255, a: 1 })] });
    return { id: child.id, constraint, color, ...rect };
  });
  const root = graph.createNode('FRAME', page, { name: `${outerAxis}/${innerAxis}/${between} outer`, x: -140, y: -90, width: outerAxis === 'HORIZONTAL' ? 560 : 220, height: outerAxis === 'HORIZONTAL' ? 220 : 560,
    layoutMode: outerAxis, primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED', layoutWrap: 'NO_WRAP', counterAxisAlign: 'STRETCH', itemSpacing: 10, fills: [], clipsContent: false });
  graph.createNode('RECTANGLE', root.id, { width: outerAxis === 'HORIZONTAL' ? 60 : 20, height: outerAxis === 'HORIZONTAL' ? 20 : 60, layoutAlignSelf: 'MIN', fills: [paint({ r: .2, g: .2, b: .2, a: 1 })] });
  graph.reparentNode(inner.id, root.id);
  const peer = graph.createNode('RECTANGLE', root.id, { width: 20, height: 20, layoutGrow: 2, layoutAlignSelf: 'MIN', fills: [paint({ r: .4, g: .4, b: .4, a: 1 })] });
  const collection = graph.createCollection('Own layout cross'), variable = graph.createVariable('Own layout fixed cross', 'FLOAT', collection.id, outerAxis === 'HORIZONTAL' ? 80 : 100);
  graph.bindVariable(inner.id, outerAxis === 'HORIZONTAL' ? 'height' : 'width', variable.id);
  expect({ width: inner.width, height: inner.height }).toEqual({ width: 100, height: 80 });
  return { root, inner, outerAxis, innerAxis, between, flow, absolute, peer, variable };
}

function independentOwnLayoutCalibration(graph: SceneGraph, fixture: OwnLayoutCalibration, main: number, cross: number) {
  const copy = cloneDesignSubgraph(graph, [fixture.root.id]), root = copy.getNode(fixture.root.id)!, inner = copy.getNode(fixture.inner.id)!;
  const size = fixture.outerAxis === 'HORIZONTAL' ? { width: main * 3 + 80, height: cross + 100 } : { width: cross + 100, height: main * 3 + 80 };
  // Resolve the captured variable value directly on this private source graph; the
  // geometry oracle is SDK Yoga plus its public authored-child resize primitive.
  inner[fixture.outerAxis === 'HORIZONTAL' ? 'height' : 'width'] = cross; inner.boundVariables = {}; Object.assign(root, size); computeAllLayouts(copy, root.id);
  expect({ x: inner.x, y: inner.y }).toEqual(fixture.outerAxis === 'HORIZONTAL' ? { x: 70, y: 0 } : { x: 0, y: 70 });
  expect(inner[fixture.outerAxis === 'HORIZONTAL' ? 'height' : 'width']).toBe(cross);
  const peer = copy.getNode(fixture.peer.id)!, mainAxis = fixture.outerAxis === 'HORIZONTAL' ? 'width' : 'height';
  // The padded frame's flex base includes its own padding. Yoga, rather than a
  // naive 1:2 split of border-box sizes, supplies the independent allocation.
  expect(Math.abs(inner[mainAxis] + peer[mainAxis] - main * 3)).toBeLessThanOrEqual(1e-4); expect(peer[mainAxis]).toBeGreaterThan(inner[mainAxis]);
  const first = copy.getNode(fixture.flow[0]!.id)!, second = copy.getNode(fixture.flow[1]!.id)!, last = copy.getNode(fixture.flow[2]!.id)!;
  expect({ x: first.x, y: first.y, width: first.width, height: first.height }).toEqual(fixture.innerAxis === 'HORIZONTAL' ? { x: 12, y: 6, width: 28, height: 16 } : { x: 12, y: 6, width: 16, height: 28 });
  if (fixture.between) {
    const available = fixture.innerAxis === 'HORIZONTAL' ? inner.width - 20 : inner.height - 16;
    expect(Math.abs((fixture.innerAxis === 'HORIZONTAL' ? second.x : second.y) - ((fixture.innerAxis === 'HORIZONTAL' ? 12 : 6) + 28 + (available - 64) / 2))).toBeLessThanOrEqual(1e-4);
  } else expect(Math.abs(fixture.innerAxis === 'HORIZONTAL' ? last.width - 2 * second.width : last.height - 2 * second.height)).toBeLessThanOrEqual(1);
  for (const child of fixture.absolute) Object.assign(copy.getNode(child.id)!, constrainedChildRect(child, { width: 100, height: 80 }, inner, child.constraint, child.constraint));
  for (const node of copy.nodes.values()) { node.layoutMode = 'NONE'; node.layoutGrow = 0; }
  copy.clearAbsPosCache(); return { copy, size };
}

it.each((['HORIZONTAL', 'VERTICAL'] as const).flatMap(outerAxis => (['HORIZONTAL', 'VERTICAL'] as const).map(innerAxis => ({ outerAxis, innerAxis }))))('calibrates nested $outerAxis/$innerAxis flow, absolute paint and live cross sizing through actual offline native worker PNGs', async ({ outerAxis, innerAxis }) => {
  const editor = createEditor(), graph = editor.graph, fixtures = [false, true].map(between => ownLayoutCalibrationFixture(graph, editor.state.currentPageId, outerAxis, innerAxis, between));
  const source = serializeGraph(graph), definitions = capturePrototypeVariables(graph), transport = await flexCalibrationWorker(source, fixtures.map(fixture => fixture.root.id));
  try {
    expect(await transport.next()).toEqual({ type: 'ready' }); let id = 0;
    for (const fixture of fixtures) {
      const baseline = cloneDesignSubgraph(graph, [fixture.root.id]); computeAllLayouts(baseline, fixture.root.id); const initial = baseline.getNode(fixture.inner.id)!;
      expect(initial[outerAxis === 'HORIZONTAL' ? 'height' : 'width']).toBe(outerAxis === 'HORIZONTAL' ? 80 : 100);
      const hashes: string[] = [];
      for (const { main, cross } of [{ main: 160, cross: 120 }, { main: 240, cross: 160 }, { main: 160, cross: 120 }]) {
        const { copy, size } = independentOwnLayoutCalibration(graph, fixture, main, cross), session = assignPrototypeVariable(definitions, emptyPrototypeSession(), fixture.variable.id, { type: 'literal', value: cross });
        const request = { rootId: fixture.root.id, rootSizes: { [fixture.root.id]: size }, session }, nodeIds = [fixture.inner.id, fixture.peer.id, ...fixture.flow.map(child => child.id), ...fixture.absolute.map(child => child.id)];
        const prepared = new Map<string, { x: number; y: number; width: number; height: number }>();
        const native = await renderNativeReactModel(kit, graph, [fixture.root.id], request, scene => {
          for (const nodeId of nodeIds) { const node = scene.getNode(nodeId)!; prepared.set(nodeId, { x: node.x, y: node.y, width: node.width, height: node.height }); }
        });
        for (const nodeId of nodeIds) { const expected = copy.getNode(nodeId)!; expect(prepared.get(nodeId), `${outerAxis}/${innerAxis}/${fixture.between}/${nodeId}`).toEqual({ x: expected.x, y: expected.y, width: expected.width, height: expected.height }); }
        const artwork = renderNativeSceneImage(kit, copy, copy.getNode(fixture.root.id)!, true), expected = pixels(artwork.bytes), actual = pixels(modelBytes(native.nodes[0]!.image!));
        expectExactSourcePixels(actual, expected, `nested/${outerAxis}/${innerAxis}/${fixture.between}/${main}/${cross}`, native.nodes[0]!.imageStyle);
        const inverse = TransformMatrix.invert(getWorldMatrix(copy.getNode(fixture.root.id)!, copy))!;
        for (const child of [...fixture.flow, ...fixture.absolute]) {
          const node = copy.getNode(child.id)!, relative = TransformMatrix.multiply(inverse, getWorldMatrix(node, copy));
          const point = TransformMatrix.mapPoint(relative, 'constraint' in child && child.constraint === 'STRETCH' ? { x: 3, y: 3 } : { x: node.width / 2, y: node.height / 2 });
          const x = Math.floor((point.x - artwork.bounds.minX) * artwork.scale), y = Math.floor((point.y - artwork.bounds.minY) * artwork.scale), offset = (y * actual.width + x) * 4;
          expect([...actual.rgba.slice(offset, offset + 4)], `nested/${outerAxis}/${innerAxis}/${fixture.between}/${node.name} literal paint ${x},${y}`).toEqual(child.color);
        }
        transport.worker.postMessage({ type: 'render', id: ++id, request }); const response = await transport.next(); expect(response.type, response.type === 'error' ? response.message : fixture.inner.name).toBe('model');
        if (response.type !== 'model') throw new Error('Missing nested native calibration model.'); expect(response.id).toBe(id);
        expectExactSourcePixels(pixels(modelBytes(response.model.nodes[0]!.image!)), expected, `offline/nested/${outerAxis}/${innerAxis}/${fixture.between}/${main}/${cross}`, response.model.nodes[0]!.imageStyle);
        hashes.push(actual.hash); expect(serializeGraph(graph)).toBe(source);
      }
      expect(hashes[0]).not.toBe(hashes[1]); expect(hashes[2]).toBe(hashes[0]);
    }
  } finally { await transport.worker.terminate(); editor.dispose(); }
}, 45000);

// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { renderNodesToImage } from '@open-pencil/core/io';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit } from 'canvaskit-wasm';
import { cloneDesignSubgraph } from './graphSubset';
import { createNativeRenderer, destroyNativeRenderer } from './nativeRendererLifecycle';
import { planNativeReactComposition, renderNativeReactComposition } from './nativeReactComposition';
import { renderNativeReactLayer, renderNativeSceneImage, renderNativeSceneRegion } from './nativeSceneArtwork';
import { setPrototypeScroll, setScrollBehaviour } from './prototypeScroll';
import { serializeGraph } from './document';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
const paint = (r = 1, g = 0, b = 0) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g, b, a: 1 } });
const blur = () => ({ type: 'LAYER_BLUR' as const, visible: true, radius: 3, spread: 0, offset: { x: 0, y: 0 }, color: { r: 0, g: 0, b: 0, a: 1 } });

function rgba(bytes: Uint8Array) {
  const image = kit.MakeImageFromEncoded(bytes)!;
  try { return { width: image.width(), height: image.height(), pixels: new Uint8Array(image.readPixels(0, 0, { width: image.width(), height: image.height(), colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!) }; } finally { image.delete(); }
}

function independentNodePixels(graph: SceneGraph, node: SceneNode, scale: number) {
  const copy = cloneDesignSubgraph(graph, [node.id]), root = copy.getNode(node.id)!;
  root.childIds = [];
  let page = root; while (page.parentId && page.type !== 'CANVAS') page = copy.getNode(page.parentId)!;
  const width = Math.max(1, Math.ceil(root.width * scale)), height = Math.max(1, Math.ceil(root.height * scale));
  const wrapper = copy.createNode('FRAME', page.id, { width: width / scale, height: height / scale, fills: [], clipsContent: false });
  Object.assign(root, { parentId: wrapper.id, x: 0, y: 0, rotation: 0, flipX: false, flipY: false, opacity: 1, visible: true });
  wrapper.childIds = [root.id]; page.childIds = [wrapper.id]; copy.clearAbsPosCache();
  const pixels = kit.Malloc(Uint8Array, width * height * 4), surface = kit.MakeRasterDirectSurface({ width, height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, pixels, width * 4)!;
  const renderer = createNativeRenderer(kit, surface);
  try { return rgba(renderNodesToImage(kit, renderer, copy, page.id, [wrapper.id], { format: 'PNG', scale })!); }
  finally { destroyNativeRenderer(renderer); kit.Free(pixels); }
}

it('keeps native art, composed static groups, and live scroll/video portals in authored paint order', () => {
  const editor = createEditor(), graph = editor.graph, root = graph.createNode('FRAME', editor.state.currentPageId, { width: 120, height: 80, fills: [paint(0, 0, 1)] });
  const group = graph.createNode('FRAME', root.id, { name: 'Soft group', x: 4, y: 4, width: 24, height: 24, fills: [], effects: [blur()] });
  graph.createNode('RECTANGLE', group.id, { x: 4, y: 4, width: 16, height: 16, fills: [paint()] });
  const scroll = graph.createNode('FRAME', root.id, { name: 'Scroll', x: 36, y: 4, width: 64, height: 64, fills: [] }); setPrototypeScroll(editor, scroll, { axis: 'vertical' });
  const beforeVideo = graph.createNode('RECTANGLE', scroll.id, { name: 'Before video', x: 4, y: 4, width: 12, height: 12, fills: [paint(0, 1)] });
  const video = graph.createNode('RECTANGLE', scroll.id, { name: 'Live video', x: 22, y: 4, width: 16, height: 12, fills: [{ ...paint(), type: 'VIDEO' }] });
  const afterVideo = graph.createNode('RECTANGLE', scroll.id, { name: 'After video', x: 44, y: 4, width: 12, height: 12, fills: [paint(0, 0, 1)] });
  const source = serializeGraph(graph);
  try {
    const plan = planNativeReactComposition(graph, root);
    expect(plan.mode).toBe('layers');
    expect(plan.order.map(part => [part.kind, part.nodeId])).toEqual([
      ['native-layer', root.id], ['scene', group.id], ['scroll', scroll.id],
      ['native-layer', beforeVideo.id], ['video', video.id], ['native-layer', afterVideo.id],
    ]);
    expect(plan.sceneRootIds).toEqual([group.id]);
    expect(plan.coveredNodeIds).toContain(graph.getChildren(group.id)[0]!.id);
    expect(plan.nativeLayerIds).not.toContain(video.id);
    const rendered = renderNativeReactComposition(kit, graph, root);
    expect(rendered.layers.map(layer => layer.nodeId)).toEqual([root.id, beforeVideo.id, afterVideo.id]);
    expect(rendered.layers.every(layer => rgba(layer.bytes).pixels.some((value, index) => index % 4 === 3 && value > 0))).toBe(true);
    const groupScene = renderNativeSceneImage(kit, graph, group);
    expect(rgba(groupScene.bytes).pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    const softGroup = graph.getNode(group.id)!;
    expect(rgba(rendered.layers[0]!.bytes).pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(softGroup.effects).toHaveLength(1);
    expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

it('renders own native layer art at its current dimensions with independently matching CanvasKit pixels', () => {
  const editor = createEditor(), graph = editor.graph, root = graph.createNode('FRAME', editor.state.currentPageId, { width: 80, height: 60, fills: [] });
  const leaf = graph.createNode('RECTANGLE', root.id, { x: 8, y: 7, width: 20, height: 14, fills: [paint(.9, .2, .1)], strokes: [{ visible: true, opacity: 1, color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2, align: 'INSIDE' }] });
  const source = serializeGraph(graph);
  try {
    const first = renderNativeReactLayer(kit, graph, leaf.id), firstPixels = rgba(first.bytes);
    expect(firstPixels).toEqual(independentNodePixels(graph, leaf, first.scale));
    expect(firstPixels.pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    leaf.width = 36; leaf.height = 22; graph.clearAbsPosCache(); const resizedSource = serializeGraph(graph);
    const second = renderNativeReactLayer(kit, graph, leaf.id), secondPixels = rgba(second.bytes);
    expect(secondPixels).toEqual(independentNodePixels(graph, leaf, second.scale));
    expect([second.width, second.height]).not.toEqual([first.width, first.height]);
    expect(secondPixels.pixels).not.toEqual(firstPixels.pixels);
    expect(serializeGraph(graph)).toBe(resizedSource); expect(resizedSource).not.toBe(source);
  } finally { editor.dispose(); }
});

it('renders a parent-coordinate transparent mask region and reports exact mask membership', () => {
  const editor = createEditor(), graph = editor.graph, parent = graph.createNode('FRAME', editor.state.currentPageId, { width: 80, height: 60, fills: [paint(0, 0, 1)] });
  graph.createNode('RECTANGLE', parent.id, { name: 'Video before mask', width: 12, height: 12, fills: [{ ...paint(), type: 'VIDEO' }] });
  const mask = graph.createNode('ELLIPSE', parent.id, { name: 'Mask', x: 18, y: 8, width: 22, height: 22, isMask: true, fills: [paint()] });
  const target = graph.createNode('RECTANGLE', parent.id, { name: 'Masked child', x: 10, y: 4, width: 44, height: 34, fills: [paint(0, 1)] });
  const source = serializeGraph(graph);
  try {
    const plan = planNativeReactComposition(graph, parent);
    expect(plan.mode).toBe('layers');
    expect(plan.order).toContainEqual({ kind: 'scene-region', nodeId: parent.id, regionId: mask.id, members: [mask.id, target.id] });
    expect(plan.order.findIndex(part => part.kind === 'video')).toBeLessThan(plan.order.findIndex(part => part.kind === 'scene-region'));
    const region = renderNativeSceneRegion(kit, graph, parent.id, [mask.id, target.id]);
    expect(region.regionId).toBe(mask.id);
    expect(region.members).toEqual([mask.id, target.id]);
    expect(region.maskRegions.get(parent.id)?.[0]?.masks).toEqual([mask.id]);
    expect(region.maskRegions.get(parent.id)?.[0]?.children).toEqual([target.id]);
    const p = rgba(region.bytes);
    expect(p.pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(p.pixels.some((value, index) => index % 4 === 3 && value === 0)).toBe(true);
    expect(region.imageStyle.width).toBe('100%'); expect(region.imageStyle.height).toBe('100%');
    expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

it('refuses a live surface beneath an ancestor effect rather than flattening away dynamic ancestry', () => {
  const editor = createEditor(), graph = editor.graph, root = graph.createNode('FRAME', editor.state.currentPageId, { width: 80, height: 60, fills: [], effects: [blur()] });
  graph.createNode('RECTANGLE', root.id, { width: 20, height: 20, fills: [{ ...paint(), type: 'VIDEO' }] });
  try {
    const plan = planNativeReactComposition(graph, root);
    expect(plan.mode).toBe('unsupported'); expect(plan.issue).toContain('native effects cannot be split around a live video');
  } finally { editor.dispose(); }
});

it('preserves consecutive masks and rejects backdrop-dependent art beside live content', () => {
  const editor = createEditor(), graph = editor.graph, root = graph.createNode('FRAME', editor.state.currentPageId, { width: 80, height: 60, fills: [] });
  graph.createNode('RECTANGLE', root.id, { width: 8, height: 8, fills: [{ ...paint(), type: 'VIDEO' }] });
  const a = graph.createNode('ELLIPSE', root.id, { x: 12, y: 12, width: 24, height: 24, isMask: true, fills: [paint()] });
  const b = graph.createNode('RECTANGLE', root.id, { x: 18, y: 10, width: 24, height: 24, isMask: true, fills: [paint()] });
  const child = graph.createNode('RECTANGLE', root.id, { width: 60, height: 48, fills: [paint(0, 1)] });
  try {
    const before = serializeGraph(graph), region = renderNativeSceneRegion(kit, graph, root.id, [a.id, b.id, child.id]);
    expect(region.maskRegions.get(root.id)?.[0]?.masks).toEqual([a.id, b.id]);
    expect(rgba(region.bytes).pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(serializeGraph(graph)).toBe(before);
    child.blendMode = 'MULTIPLY';
    expect(planNativeReactComposition(graph, root)).toMatchObject({ mode: 'unsupported', issue: expect.stringContaining('backdrop-dependent') });
  } finally { editor.dispose(); }
});

it.each(['fixed', 'sticky'] as const)('classifies a %s child by its immediate nested scrolling parent', behaviour => {
  const editor = createEditor(), graph = editor.graph;
  const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Non-scrolling screen', width: 120, height: 100, fills: [] });
  const inner = graph.createNode('FRAME', root.id, { name: 'Nested scroller', x: 8, y: 8, width: 100, height: 80, fills: [] });
  setPrototypeScroll(editor, inner, { axis: 'vertical' });
  const positioned = graph.createNode('RECTANGLE', inner.id, { name: 'Positioned child', x: 4, y: 4, width: 20, height: 12, fills: [paint()] });
  setScrollBehaviour(editor, positioned, behaviour);
  const ordinary = graph.createNode('RECTANGLE', inner.id, { name: 'Ordinary sibling', x: 40, y: 4, width: 20, height: 12, fills: [paint(0, 1)] });
  const before = serializeGraph(graph);
  try {
    expect(planNativeReactComposition(graph, root)).toMatchObject({
      mode: 'layers',
      order: [
        { kind: 'scroll', nodeId: inner.id },
        { kind: 'native-layer', nodeId: positioned.id },
        { kind: behaviour, nodeId: positioned.id },
        { kind: 'native-layer', nodeId: ordinary.id },
      ],
      nativeLayerIds: [positioned.id, ordinary.id],
      coveredNodeIds: [],
    });
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

it.each(['fixed', 'sticky'] as const)('keeps overlapping authored siblings of a nested %s child in paint order', behaviour => {
  const editor = createEditor(), graph = editor.graph;
  const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Non-scrolling screen', width: 120, height: 100, fills: [] });
  const inner = graph.createNode('FRAME', root.id, { name: 'Nested scroller', width: 100, height: 80, fills: [] });
  setPrototypeScroll(editor, inner, { axis: 'vertical' });
  const positioned = graph.createNode('RECTANGLE', inner.id, { name: 'Positioned child', x: 4, y: 4, width: 20, height: 12, fills: [paint()] });
  setScrollBehaviour(editor, positioned, behaviour);
  const cover = graph.createNode('RECTANGLE', inner.id, { name: 'Authored cover', x: 10, y: 4, width: 20, height: 12, fills: [paint(0, 1)] });
  const before = serializeGraph(graph);
  try {
    expect(planNativeReactComposition(graph, root)).toMatchObject({ mode: 'layers', order: [
      { kind: 'scroll', nodeId: inner.id }, { kind: 'native-layer', nodeId: positioned.id }, { kind: behaviour, nodeId: positioned.id }, { kind: 'native-layer', nodeId: cover.id },
    ], nativeLayerIds: [positioned.id, cover.id], coveredNodeIds: [] });
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

it.each(['fixed', 'sticky'] as const)('does not extend outer scrolling through an inactive frame to a %s child', behaviour => {
  const editor = createEditor(), graph = editor.graph;
  const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Scrolling screen', width: 120, height: 100, fills: [] });
  setPrototypeScroll(editor, root, { axis: 'vertical' });
  const inner = graph.createNode('FRAME', root.id, { name: 'Inactive frame', width: 100, height: 80, fills: [] });
  setPrototypeScroll(editor, inner, { axis: 'none' });
  const positioned = graph.createNode('RECTANGLE', inner.id, { name: 'Inactive positioning', x: 4, y: 4, width: 20, height: 12, fills: [paint()] });
  setScrollBehaviour(editor, positioned, behaviour);
  const ordinary = graph.createNode('RECTANGLE', inner.id, { name: 'Overlapping ordinary sibling', x: 10, y: 4, width: 20, height: 12, fills: [paint(0, 1)] });
  const before = serializeGraph(graph);
  try {
    expect(planNativeReactComposition(graph, root)).toMatchObject({
      mode: 'layers',
      order: [
        { kind: 'scroll', nodeId: root.id },
        { kind: 'native-layer', nodeId: positioned.id },
        { kind: 'native-layer', nodeId: ordinary.id },
      ],
      nativeLayerIds: [positioned.id, ordinary.id],
      coveredNodeIds: [],
    });
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

it.each(['fixed', 'sticky'] as const)('classifies every live feature of an overlapping %s video and own-scroll frame', behaviour => {
  const editor = createEditor(), graph = editor.graph;
  const root = graph.createNode('FRAME', editor.state.currentPageId, { width: 96, height: 64, fills: [] }); setPrototypeScroll(editor, root, { axis: 'vertical' });
  const behind = graph.createNode('RECTANGLE', root.id, { width: 60, height: 40, fills: [paint(0, 0, 1)] });
  const video = graph.createNode('RECTANGLE', root.id, { name: 'Mixed video', x: 8, y: 8, width: 24, height: 16, fills: [{ ...paint(), type: 'VIDEO' }] }); setScrollBehaviour(editor, video, behaviour);
  const frame = graph.createNode('FRAME', root.id, { name: 'Mixed frame', x: 12, y: 12, width: 40, height: 32, fills: [paint(0, 1)], clipsContent: true }); setPrototypeScroll(editor, frame, { axis: 'vertical' }); setScrollBehaviour(editor, frame, behaviour);
  const content = graph.createNode('RECTANGLE', frame.id, { width: 40, height: 80, fills: [paint()] });
  const cover = graph.createNode('RECTANGLE', root.id, { width: 60, height: 40, fills: [paint(1, 1)] });
  const source = serializeGraph(graph);
  try {
    expect(planNativeReactComposition(graph, root)).toMatchObject({ mode: 'layers', order: [
      { kind: 'scroll', nodeId: root.id }, { kind: 'native-layer', nodeId: behind.id },
      { kind: 'video', nodeId: video.id }, { kind: behaviour, nodeId: video.id },
      { kind: 'native-layer', nodeId: frame.id }, { kind: 'scroll', nodeId: frame.id }, { kind: behaviour, nodeId: frame.id },
      { kind: 'native-layer', nodeId: content.id }, { kind: 'native-layer', nodeId: cover.id },
    ], nativeLayerIds: [behind.id, frame.id, content.id, cover.id], coveredNodeIds: [] });
    expect(serializeGraph(graph)).toBe(source);
  } finally { editor.dispose(); }
});

it.each(['video', 'own-scroll'] as const)('retains fidelity refusals and validates positioning metadata on a mixed fixed %s', kind => {
  const editor = createEditor(), graph = editor.graph;
  const root = graph.createNode('FRAME', editor.state.currentPageId, { name: 'Live ancestor', width: 96, height: 64, fills: [] }); setPrototypeScroll(editor, root, { axis: 'vertical' });
  const node = graph.createNode(kind === 'video' ? 'RECTANGLE' : 'FRAME', root.id, { name: 'Mixed portal', width: 24, height: 16, fills: kind === 'video' ? [{ ...paint(), type: 'VIDEO' }] : [paint()] });
  if (kind === 'own-scroll') setPrototypeScroll(editor, node, { axis: 'vertical' }); setScrollBehaviour(editor, node, 'fixed');
  try {
    const source = serializeGraph(graph); expect(planNativeReactComposition(graph, root).mode).toBe('layers'); expect(serializeGraph(graph)).toBe(source);
    root.effects = [blur()]; expect(planNativeReactComposition(graph, root)).toMatchObject({ mode: 'unsupported', issue: expect.stringContaining('native effects cannot be split') }); root.effects = [];
    node.isMask = true; expect(planNativeReactComposition(graph, root)).toMatchObject({ mode: 'unsupported', issue: expect.stringContaining('cannot itself be a mask') }); node.isMask = false;
    root.effects = [{ ...blur(), type: 'BACKGROUND_BLUR' }]; expect(planNativeReactComposition(graph, root)).toMatchObject({ mode: 'unsupported', issue: expect.stringContaining('backdrop-dependent') }); root.effects = [];
    const mask = graph.createNode('RECTANGLE', root.id, { name: 'Ancestor mask run', width: 24, height: 16, isMask: true, fills: [paint()] });
    root.childIds = [mask.id, node.id]; const masked = serializeGraph(graph);
    expect(planNativeReactComposition(graph, root)).toMatchObject({ mode: 'unsupported', issue: expect.stringContaining('crosses a native mask region') }); expect(serializeGraph(graph)).toBe(masked);
    root.childIds = [node.id, mask.id]; mask.visible = false;
    node.fills[0]!.blendMode = 'MULTIPLY'; const blended = serializeGraph(graph);
    expect(planNativeReactComposition(graph, root)).toMatchObject({ mode: 'unsupported', issue: expect.stringContaining('backdrop-dependent') }); expect(serializeGraph(graph)).toBe(blended); delete node.fills[0]!.blendMode;
    const entry = node.pluginData.find(item => item.key === 'prototypeScrollBehaviour')!; entry.value = 'unsupported-import'; const malformed = serializeGraph(graph);
    expect(planNativeReactComposition(graph, root)).toMatchObject({ mode: 'unsupported', issue: expect.stringContaining('imported scrolling or fixed-layer behavior') }); expect(serializeGraph(graph)).toBe(malformed);
    entry.value = 'fixed';
    if (kind === 'own-scroll') { node.pluginData.find(item => item.key === 'prototypeScroll')!.value = '{"axis":"bad"}'; const malformedScroll = serializeGraph(graph); expect(planNativeReactComposition(graph, root).mode).toBe('unsupported'); expect(serializeGraph(graph)).toBe(malformedScroll); }
    else { node.strokes = [{ visible: true, opacity: 1, color: paint().color, weight: 1, align: 'INSIDE' }]; expect(planNativeReactComposition(graph, root)).toMatchObject({ mode: 'unsupported', issue: expect.stringContaining('keep live video on a leaf layer') }); }
  } finally { editor.dispose(); }
});

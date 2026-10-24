// @vitest-environment node
import { beforeAll, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneGraph } from '@open-pencil/scene-graph';
import { createNativeReactMotionGraph } from './nativeReactMotionGraph';
import { renderNativeSceneImage } from './nativeSceneArtwork';
import { serializeGraph } from './graphDocument';
import { setNativeMotionMaskRegion } from './nativeReactMotionMaskRegions';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
const fill = (r: number, g: number, b: number) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g, b, a: 1 } });
const link = { action: 'navigate' as const, transition: 'smart' as const, duration: 300, easing: 'linear' as const };

function scene(graph: SceneGraph, name: string, opacity: number, masked = true) {
  const root = graph.createNode('FRAME', graph.getPages()[0]!.id, { name, width: 3200, height: 3200, fills: [] });
  if (masked) graph.createNode('ELLIPSE', root.id, { name: `${name} mask`, x: 1808, y: 1683, width: 84, height: 66, rotation: 17, isMask: true, maskType: 'ALPHA', opacity, fills: [fill(1, 1, 1)] });
  graph.createNode('RECTANGLE', root.id, { name: 'Shared artwork', x: 1800, y: 1680, width: 112, height: 76, fills: [fill(.13, .52, .86)] });
  return root;
}

function pixels(bytes: Uint8Array) {
  const image = kit.MakeImageFromEncoded(bytes)!;
  try {
    const data = image.readPixels(0, 0, { width: image.width(), height: image.height(), colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB });
    if (!data) throw new Error('Missing coverage-bounds reference pixels.');
    return new Uint8Array(data);
  } finally { image.delete(); }
}

it.each(['change', 'insert'] as const)('renders small mask %s in a large empty frame without full-parent endpoint coverage or hit allocations', direction => {
  const editor = createEditor(), reference = createEditor();
  const from = scene(editor.graph, 'Source', .2, direction === 'change'), to = scene(editor.graph, 'Destination', .8);
  try {
    const before = serializeGraph(editor.graph), sampler = createNativeReactMotionGraph(editor.graph, from.id, editor.graph, to.id, link);
    const sampled = sampler.sample(.5), root = sampled.getNode(sampler.rootId)!;
    const allocations = vi.spyOn(kit, 'Malloc');
    let actual: ReturnType<typeof renderNativeSceneImage>, sizes: number[];
    try {
      actual = renderNativeSceneImage(kit, sampled, root, true);
      sizes = allocations.mock.calls.map(call => Number(call[1]));
    } finally { allocations.mockRestore(); }
    expect(sizes.filter(size => size >= 2048 * 2048 * 4)).toHaveLength(4);
    expect(sizes.filter(size => size === 2048 * 2048)).toHaveLength(1);
    expect(sizes.filter(size => size < 2048 * 2048 * 4 && size !== 2048 * 2048).every(size => size < 1024 * 1024)).toBe(true);
    const expectedFrom = renderNativeSceneImage(kit, reference.graph, scene(reference.graph, 'Independent source', .2, direction === 'change'), true);
    const expectedTo = renderNativeSceneImage(kit, reference.graph, scene(reference.graph, 'Independent destination', .8), true);
    const a = pixels(actual.bytes), bFrom = pixels(expectedFrom.bytes), bTo = pixels(expectedTo.bytes);
    const b = bFrom.map((value, index) => Math.round((value + bTo[index]!) / 2));
    expect(a.length).toBe(b.length);
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference = Math.max(difference, Math.abs(a[i]! - b[i]!));
    expect(difference).toBeLessThanOrEqual(2);
    expect(a.some((value, index) => index % 4 === 3 && value > 24)).toBe(true);
    expect(actual.maskRegions.get(root.id)?.[0]?.children).toHaveLength(1);
    expect(actual.maskRegions.get(root.id)?.[0]?.path).toBeTruthy();
    const again = sampler.sample(.5);
    expect(renderNativeSceneImage(kit, again, again.getNode(sampler.rootId)!, true).bytes).toEqual(actual.bytes);
    expect(serializeGraph(editor.graph)).toBe(before);
  } finally { editor.dispose(); reference.dispose(); }
}, 30_000);

it('keeps an empty private coverage region finite and transparent without changing its source', () => {
  const editor = createEditor(), graph = editor.graph;
  try {
    const root = graph.createNode('FRAME', graph.getPages()[0]!.id, { width: 64, height: 48, fills: [] });
    const mask = graph.createNode('RECTANGLE', root.id, { width: 1, height: 1, isMask: true, maskType: 'ALPHA', fills: [] });
    setNativeMotionMaskRegion(graph, mask.id, [], [], .5);
    const before = serializeGraph(graph), result = renderNativeSceneImage(kit, graph, root, true);
    expect(pixels(result.bytes).every(value => value === 0)).toBe(true);
    expect(result.maskRegions.get(root.id)?.[0]).toEqual({ masks: [mask.id], children: [], path: '' });
    expect(serializeGraph(graph)).toBe(before);
  } finally { editor.dispose(); }
});

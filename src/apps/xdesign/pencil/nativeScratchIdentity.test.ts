// @vitest-environment node
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { SceneGraph, generateId, type SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit, Image, Surface } from 'canvaskit-wasm';
import { serializeGraph } from './graphDocument';
import { createNativeReactMotionGraph } from './nativeReactMotionGraph';
import { setNativeMotionMaskRegion } from './nativeReactMotionMaskRegions';
import { renderNativeReactLayer, renderNativeSceneImage } from './nativeSceneArtwork';
import { createNativeScratchGraph } from './nativeScratchGraph';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
afterEach(() => vi.restoreAllMocks());
const ink = { type: 'SOLID' as const, visible: true, opacity: 1, color: { r: .12, g: .42, b: .78, a: 1 } };
const link = { action: 'navigate' as const, transition: 'smart' as const, duration: 320, easing: 'linear' as const };

function rename(graph: SceneGraph, node: SceneNode, id: string) {
  const old = node.id;
  expect(graph.nodes.has(id)).toBe(false);
  graph.nodes.delete(old); node.id = id; graph.nodes.set(id, node);
  for (const other of graph.nodes.values()) {
    if (other.parentId === old) other.parentId = id;
    other.childIds = other.childIds.map(child => child === old ? id : child);
  }
  graph.clearAbsPosCache();
}
function nextId(offset: number) { return `0:${Number(generateId().split(':')[1]) + offset}`; }
function assertAncestry(graph: SceneGraph) {
  for (const node of graph.nodes.values()) {
    const seen = new Set([node.id]); let parent = node.parentId;
    while (parent) {
      expect(seen.has(parent)).toBe(false); seen.add(parent);
      const ancestor = graph.getNode(parent); expect(ancestor).toBeDefined(); parent = ancestor!.parentId;
    }
  }
}
function regionFixture() {
  const graph = new SceneGraph(), page = graph.getPages()[0]!;
  const root = graph.createNode('FRAME', page.id, { name: 'Imported panel', width: 64, height: 48, fills: [] });
  const coverage = graph.createNode('RECTANGLE', root.id, { width: 1, height: 1, isMask: true, maskType: 'ALPHA', fills: [] });
  const art = graph.createNode('RECTANGLE', root.id, { name: 'Artwork', x: 8, y: 8, width: 32, height: 24, fills: [ink] });
  const mask = graph.createNode('ELLIPSE', page.id, { name: 'Endpoint', x: 12, y: 10, width: 28, height: 24, isMask: true, maskType: 'ALPHA', fills: [ink] });
  const install = () => {
    const a = structuredClone(mask), b = structuredClone(mask); a.opacity = .4; b.opacity = .8;
    setNativeMotionMaskRegion(graph, coverage.id, [{ rootId: a.id, nodes: [a] }], [{ rootId: b.id, nodes: [b] }], .5);
  };
  install(); return { graph, root, coverage, art, mask, install };
}

it('keeps private scaffolding disjoint from imported private-looking IDs without changing the caller reservation', () => {
  const reserved = new Set(['xdesign-native-document', 'xdesign-native-document:1', 'xdesign-native-page', 'xdesign-native-page:1']);
  const before = [...reserved], first = createNativeScratchGraph(reserved), second = createNativeScratchGraph(reserved);
  expect([...first.nodes.keys()].some(id => reserved.has(id))).toBe(false);
  expect(first.rootId).toBe('xdesign-native-document:2'); expect(first.getPages()[0]?.id).toBe('xdesign-native-page:2');
  expect([...second.nodes.keys()]).toEqual([...first.nodes.keys()]); expect([...reserved]).toEqual(before); assertAncestry(first);
});

it.each([1, 2])('samples an imported endpoint ID equal to the next scratch document/page ID (%s)', offset => {
  const graph = new SceneGraph(), page = graph.getPages()[0]!;
  const from = graph.createNode('FRAME', page.id, { name: 'From', width: 64, height: 48, fills: [] });
  const to = graph.createNode('FRAME', page.id, { name: 'To', width: 64, height: 48, fills: [] });
  graph.createNode('RECTANGLE', from.id, { name: 'Artwork', x: 8, y: 8, width: 24, height: 20, fills: [ink] });
  const child = graph.createNode('RECTANGLE', to.id, { name: 'Artwork', x: 20, y: 12, width: 24, height: 20, fills: [ink] });
  rename(graph, child, nextId(offset));
  const before = serializeGraph(graph), sampler = createNativeReactMotionGraph(graph, from.id, graph, to.id, { ...link, target: to.id });
  const sampled = sampler.sample(.5), sourceId = sampler.sourceNodeId(child.id)!;
  expect(sourceId).toBe(child.id); expect(sampled.getNode(sourceId)?.name).toBe('Artwork'); assertAncestry(sampled);
  expect(sampler.sample(.75).getNode(sourceId)?.id).toBe(sourceId);
  expect(sampler.sample(.5).getNode(sourceId)).toEqual(sampled.getNode(sourceId));
  expect(serializeGraph(graph)).toBe(before);
});

it.each(['parent-document', 'parent-page', 'mask-document', 'mask-page'] as const)('renders native coverage when an imported %s ID collides with endpoint scaffolding', collision => {
  const f = regionFixture(), expected = renderNativeSceneImage(kit, f.graph, f.root, true);
  const id = nextId(collision.endsWith('document') ? 3 : 4);
  rename(f.graph, collision.startsWith('parent') ? f.root : f.mask, id); f.install();
  const before = serializeGraph(f.graph), actual = renderNativeSceneImage(kit, f.graph, f.root, true);
  expect(actual.bytes).toEqual(expected.bytes); expect(actual.bounds).toEqual(expected.bounds);
  expect(actual.maskRegions.get(f.root.id)?.[0]?.children).toEqual([f.art.id]);
  expect(serializeGraph(f.graph)).toBe(before); assertAncestry(f.graph);
});

it.each([1, 2])('captures an imported leaf whose ID equals the next private document/page ID (%s)', offset => {
  const graph = new SceneGraph(), leaf = graph.createNode('RECTANGLE', graph.getPages()[0]!.id, { name: 'Imported leaf', width: 28, height: 20, fills: [ink] });
  const expected = renderNativeReactLayer(kit, graph, leaf.id); rename(graph, leaf, nextId(offset));
  const before = serializeGraph(graph), actual = renderNativeReactLayer(kit, graph, leaf.id);
  expect(actual.nodeId).toBe(leaf.id); expect(actual.bytes).toEqual(expected.bytes); expect(actual.style).toEqual(expected.style);
  expect(serializeGraph(graph)).toBe(before); assertAncestry(graph);
});

it.each([4, 6, 7])('releases native endpoint/coverage/blend resources after allocation %s fails and permits an exact retry', allocation => {
  const f = regionFixture(), before = serializeGraph(f.graph), expected = renderNativeSceneImage(kit, f.graph, f.root, true);
  const local = Object.create(kit) as CanvasKit, surfaces: Surface[] = [], images: Image[] = [];
  const malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free'); let calls = 0;
  Object.defineProperties(local, {
    MakeRasterDirectSurface: { value: (...args: Parameters<CanvasKit['MakeRasterDirectSurface']>) => {
      if (++calls === allocation) return null;
      const surface = kit.MakeRasterDirectSurface(...args)!; surfaces.push(surface); return surface;
    } },
    MakeImageFromEncoded: { value: (...args: Parameters<CanvasKit['MakeImageFromEncoded']>) => {
      const image = kit.MakeImageFromEncoded(...args); if (image) images.push(image); return image;
    } },
  });
  expect(() => renderNativeSceneImage(local, f.graph, f.root, true)).toThrow(allocation === 7 ? 'native composite' : 'supersampled scene surface');
  expect(calls).toBe(allocation); expect(surfaces.every(surface => surface.isDeleted())).toBe(true); expect(images.every(image => image.isDeleted())).toBe(true);
  expect(new Set(free.mock.calls.map(([value]) => value))).toEqual(new Set(malloc.mock.results.map(result => result.value)));
  malloc.mockRestore(); free.mockRestore();
  expect(renderNativeSceneImage(kit, f.graph, f.root, true).bytes).toEqual(expected.bytes); expect(serializeGraph(f.graph)).toBe(before);
});

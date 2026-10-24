// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit } from 'canvaskit-wasm';
import { serializeGraph } from './graphDocument';
import { createNativeReactMotionGraph } from './nativeReactMotionGraph';
import { renderNativeSceneImage } from './nativeSceneArtwork';
import { renderNativeReactModel } from './nativeReactRenderer';
import type { DesignNode } from './reactExportRuntime';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
const white = { type: 'SOLID' as const, visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 } };
const link = { action: 'navigate' as const, transition: 'smart' as const, duration: 320, easing: 'linear' as const };

function scene(graph: SceneGraph, target: boolean) {
  const root = graph.createNode('FRAME', graph.getPages()[0]!.id, { name: target ? 'To' : 'From', x: 150, y: 90, width: 192, height: 144, rotation: 13, flipX: true, fills: [] });
  const panel = graph.createNode('FRAME', root.id, { name: 'Reflected rotating panel', x: target ? 52 : 45, y: 35, width: 84, height: 64, rotation: target ? 19 : -23, flipY: true, fills: [] });
  graph.createNode('ELLIPSE', panel.id, { name: 'Moving mask', x: target ? 16 : 8, y: 10, width: 44, height: 32, opacity: target ? .75 : .35, fills: [white], isMask: true, maskType: 'ALPHA' });
  const art = graph.createNode('RECTANGLE', panel.id, { name: 'Covered art', x: -16, y: -12, width: 116, height: 92, fills: [white] });
  const container = graph.createNode('FRAME', panel.id, { name: 'Outside container', x: target ? 96 : 90, y: 8, width: 6, height: 6, fills: [], clipsContent: false });
  const overflow = graph.createNode('RECTANGLE', container.id, { name: 'Visible overflow', x: target ? -68 : -62, y: 4, width: 24, height: 18, fills: [white] });
  const hidden = graph.createNode('RECTANGLE', panel.id, { name: 'Fully hidden target', x: 110, y: 82, width: 10, height: 10, fills: [white] });
  return { root, panel, art, container, overflow, hidden };
}
function parentLocal(panel: SceneNode, x: number, y: number) {
  const cx = panel.width / 2, cy = panel.height / 2, angle = panel.rotation * Math.PI / 180;
  const dx = (x - panel.x - cx) * (panel.flipX ? -1 : 1), dy = (y - panel.y - cy) * (panel.flipY ? -1 : 1);
  return { x: Math.cos(angle) * dx + Math.sin(angle) * dy + cx, y: -Math.sin(angle) * dx + Math.cos(angle) * dy + cy };
}
function flatten(node: DesignNode): DesignNode[] { return [node, ...node.children.flatMap(flatten)]; }

it.each([.25, .5, .75])('aligns reflected, rotated sampled mask hits with independent painted interior/exterior pixels at %s', async progress => {
  const graph = new SceneGraph(), from = scene(graph, false), to = scene(graph, true), before = serializeGraph(graph);
  const sampler = createNativeReactMotionGraph(graph, from.root.id, graph, to.root.id, { ...link, target: to.root.id });
  const sampled = sampler.sample(progress), sampledBefore = serializeGraph(sampled), root = sampled.getNode(sampler.rootId)!, panel = sampled.getNode(sampler.sourceNodeId(to.panel.id)!)!;
  const artwork = renderNativeSceneImage(kit, sampled, root, true), region = artwork.maskRegions.get(panel.id)![0]!;
  const image = kit.MakeImageFromEncoded(artwork.bytes)!, path = kit.Path.MakeFromSVGString(region.path)!;
  try {
    const width = image.width(), height = image.height(), rgba = image.readPixels(0, 0, { width, height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!;
    const actual: number[] = [], expected: number[] = [];
    for (let y = 4; y < height - 4; y += 3) for (let x = 4; x < width - 4; x += 3) {
      let painted = true, empty = true;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const alpha = rgba[((y + dy) * width + x + dx) * 4 + 3]!;
        painted &&= alpha > 0; empty &&= alpha === 0;
      }
      if (!painted && !empty) continue;
      const local = parentLocal(panel, artwork.bounds.minX + (x + .5) / artwork.scale, artwork.bounds.minY + (y + .5) / artwork.scale);
      actual.push(Number(path.contains(local.x, local.y))); expected.push(Number(painted));
    }
    expect(expected.filter(value => value === 1).length).toBeGreaterThan(50);
    expect(expected.filter(value => value === 0).length).toBeGreaterThan(500);
    expect(actual).toEqual(expected);
  } finally { path.delete(); image.delete(); }
  const model = await renderNativeReactModel(kit, sampled, [root.id]), nodes = flatten(model.nodes[0]!);
  const semantic = (node: SceneNode) => nodes.find(candidate => candidate.sourceId === sampler.sourceNodeId(node.id))!;
  const exportedPanel = semantic(to.panel), wrapper = exportedPanel.children.find(child => child.maskPath !== undefined)!;
  expect(wrapper.maskPath).toBe(region.path); expect(wrapper.style.left).toBe(0); expect(wrapper.style.top).toBe(0);
  expect(semantic(to.hidden).hitHidden).toBe(true); expect(semantic(to.hidden).visible).toBe(false);
  expect(semantic(to.container).hitHidden).toBe(true); expect(semantic(to.container).visible).toBe(true);
  expect(semantic(to.overflow).hitHidden).toBe(false); expect(semantic(to.overflow).visible).toBe(true);
  expect(semantic(to.art).hitHidden).toBe(false);
  await sampler.sample(.75); await sampler.sample(.25);
  const again = sampler.sample(progress);
  expect(renderNativeSceneImage(kit, again, again.getNode(sampler.rootId)!, true).bytes).toEqual(artwork.bytes);
  expect(serializeGraph(graph)).toBe(before); expect(serializeGraph(sampled)).toBe(sampledBefore);
});

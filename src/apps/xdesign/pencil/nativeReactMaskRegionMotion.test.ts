// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { createNativeReactMotionGraph } from './nativeReactMotionGraph';
import { prepareNativeReactMotion } from './nativeReactMotion';
import { renderNativeReactModel } from './nativeReactRenderer';
import { serializeGraph } from './graphDocument';
import { renderNativeSceneImage } from './nativeSceneArtwork';
import { nativeMaskPath } from './nativeMaskPath';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
const link = { action: 'navigate' as const, transition: 'smart' as const, duration: 300, easing: 'linear' as const };
type MaskType = 'ALPHA' | 'LUMINANCE' | 'VECTOR';
type Paint = { r: number; g: number; b: number; a: number };
type MaskSpec = { name: string; type?: 'RECTANGLE' | 'ELLIPSE'; maskType: MaskType; x: number; y?: number; width: number; height: number; opacity: number; color?: Paint };
type ArtSpec = { name: string; x: number; y?: number; width?: number; height?: number; color?: Paint; opacity?: number };
type Segment = { masks: MaskSpec[]; artwork: ArtSpec[] } | { plain: ArtSpec[] };
type SceneSpec = { name: string; segments: Segment[] };
type BuiltScene = { root: SceneNode; nodes: Map<string, SceneNode> };

const fill = (color: Paint = { r: .08, g: .38, b: .9, a: 1 }, opacity = 1) => ({ type: 'SOLID' as const, visible: true, color, opacity });
function buildScene(graph: SceneGraph, spec: SceneSpec): BuiltScene {
  const root = graph.createNode('FRAME', graph.getPages()[0]!.id, { name: spec.name, width: 112, height: 82, fills: [] });
  const nodes = new Map<string, SceneNode>([[spec.name, root]]);
  const makeArt = (art: ArtSpec) => {
    const node = graph.createNode('RECTANGLE', root.id, {
      name: art.name, x: art.x, y: art.y ?? 12, width: art.width ?? 24, height: art.height ?? 25,
      fills: [fill(art.color, art.opacity ?? .85)],
    });
    nodes.set(art.name, node); return node;
  };
  for (const segment of spec.segments) {
    if ('plain' in segment) { segment.plain.forEach(makeArt); continue; }
    for (const maskSpec of segment.masks) {
      const mask = graph.createNode(maskSpec.type ?? 'RECTANGLE', root.id, {
        name: maskSpec.name, x: maskSpec.x, y: maskSpec.y ?? 8, width: maskSpec.width, height: maskSpec.height,
        isMask: true, maskType: maskSpec.maskType, opacity: maskSpec.opacity,
        fills: [fill(maskSpec.color ?? { r: 1, g: 1, b: 1, a: 1 })],
      });
      nodes.set(maskSpec.name, mask);
    }
    segment.artwork.forEach(makeArt);
  }
  return { root, nodes };
}

function lerp(a: number, b: number, p: number) { return a + (b - a) * p; }
function atProgress(spec: SceneSpec, end: SceneSpec, p: number): SceneSpec {
  const startArt = new Map(spec.segments.flatMap(segment => 'plain' in segment ? segment.plain : segment.artwork).map(node => [node.name, node] as const));
  const endArt = new Map(end.segments.flatMap(segment => 'plain' in segment ? segment.plain : segment.artwork).map(node => [node.name, node] as const));
  const mapArt = (art: ArtSpec): ArtSpec => {
    const a = startArt.get(art.name), b = endArt.get(art.name);
    return a && b ? {
      ...art, x: lerp(a.x, b.x, p), y: lerp(a.y ?? 12, b.y ?? 12, p),
      width: lerp(a.width ?? 24, b.width ?? 24, p), height: lerp(a.height ?? 25, b.height ?? 25, p),
    } : art;
  };
  const startMasks = new Map(spec.segments.flatMap(segment => 'plain' in segment ? [] : segment.masks).map(mask => [mask.name, mask] as const));
  const endMasks = new Map(end.segments.flatMap(segment => 'plain' in segment ? [] : segment.masks).map(mask => [mask.name, mask] as const));
  return {
    name: `reference-${p}`,
    segments: spec.segments.map(segment => {
      if ('plain' in segment) return { plain: segment.plain.map(mapArt) };
      return {
        masks: segment.masks.map(mask => {
          const a = startMasks.get(mask.name), b = endMasks.get(mask.name);
          return a && b ? {
            ...mask, x: lerp(a.x, b.x, p), y: lerp(a.y ?? 8, b.y ?? 8, p),
            width: lerp(a.width, b.width, p), height: lerp(a.height, b.height, p),
          } : mask;
        }),
        artwork: segment.artwork.map(mapArt),
      };
    }),
  };
}

function pixels(image: string) {
  const decoded = kit.MakeImageFromEncoded(new Uint8Array(Buffer.from(image.split(',')[1]!, 'base64')))!;
  try {
    const width = decoded.width(), height = decoded.height();
    const data = decoded.readPixels(0, 0, { width, height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB });
    if (!data) throw new Error('Missing native mask-region comparison pixels.');
    return new Uint8Array(data);
  } finally { decoded.delete(); }
}
function difference(a: Uint8Array, b: Uint8Array) {
  expect(a.length).toBe(b.length); let result = 0;
  for (let i = 0; i < a.length; i++) result = Math.max(result, Math.abs(a[i]! - b[i]!));
  return result;
}
function blend(a: Uint8Array, b: Uint8Array, progress: number) {
  expect(a.length).toBe(b.length);
  return a.map((value, index) => Math.round(value * (1 - progress) + b[index]! * progress));
}
async function rendered(kitGraph: SceneGraph, root: SceneNode) {
  const model = await renderNativeReactModel(kit, kitGraph, [root.id]);
  if (!model.nodes[0]?.image) throw new Error('Native mask-region reference has no rendered image.');
  return pixels(model.nodes[0].image);
}
function endpointMask(type: MaskType, opacity = .72): MaskSpec {
  return { name: 'Line mask', type: 'ELLIPSE', maskType: type, x: 17, y: 14, width: 54, height: 45, opacity,
    color: type === 'LUMINANCE' ? { r: .62, g: .62, b: .62, a: 1 } : { r: 1, g: 1, b: 1, a: 1 } };
}

it.each(['ALPHA', 'LUMINANCE', 'VECTOR'] as const)('interpolates %s mask insertion and deletion against a single-child native oracle', async maskType => {
  for (const direction of ['insert', 'delete'] as const) {
    const editor = createEditor(), refA = createEditor(), refB = createEditor();
    const plain: SceneSpec = { name: `plain-${direction}`, segments: [{ plain: [{ name: 'Artwork', x: 8, color: { r: .08, g: .38, b: .9, a: 1 } }] }] };
    const masked: SceneSpec = { name: `masked-${direction}`, segments: [{ masks: [endpointMask(maskType)], artwork: [{ name: 'Artwork', x: 26, color: { r: .08, g: .38, b: .9, a: 1 } }] }] };
    const startSpec = direction === 'insert' ? plain : masked, endSpec = direction === 'insert' ? masked : plain;
    const from = buildScene(editor.graph, startSpec), to = buildScene(editor.graph, endSpec);
    try {
      const before = serializeGraph(editor.graph), reference = new Map<number, Uint8Array>();
      const startPixels = await rendered(editor.graph, from.root), endPixels = await rendered(editor.graph, to.root);
      for (const p of [.25, .5, .75]) {
        const refStart = await rendered(refA.graph, buildScene(refA.graph, atProgress(startSpec, endSpec, p)).root);
        const refEnd = await rendered(refB.graph, buildScene(refB.graph, atProgress(endSpec, startSpec, 1 - p)).root);
        reference.set(p, blend(refStart, refEnd, p));
      }
      expect(difference(reference.get(.5)!, blend(startPixels, endPixels, .5))).toBeGreaterThan(0);
      const plan = await prepareNativeReactMotion(kit, editor.graph, { sessionId: 101, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id } });
      const sampler = createNativeReactMotionGraph(editor.graph, from.root.id, editor.graph, to.root.id, { ...link, target: to.root.id });
      const artworkSource = sampler.sourceNodeId(from.nodes.get('Artwork')!.id)!;
      expect(artworkSource).toBeTruthy();
      expect([...sampler.sample(.5).nodes.values()].filter(node => node.name === 'Artwork')).toHaveLength(1);
      expect(sampler.sourceNodeId(to.nodes.get('Artwork')!.id)).toBe(artworkSource);
      expect(difference(pixels((await plan.frame(0)).nodes[0]!.image!), startPixels)).toBe(0);
      expect(difference(pixels((await plan.frame(1)).nodes[0]!.image!), endPixels)).toBe(0);
      const retained = new Map<number, string>();
      for (const p of [.25, .5, .75]) {
        const frame = await plan.frame(p), actual = pixels(frame.nodes[0]!.image!);
        expect(difference(actual, reference.get(p)!)).toBeLessThanOrEqual(2);
        expect(actual.some((value, index) => index % 4 === 3 && value > 16)).toBe(true);
        retained.set(p, frame.nodes[0]!.image!);
      }
      await plan.frame(.75); await plan.frame(.25);
      expect((await plan.frame(.5)).nodes[0]!.image).toBe(retained.get(.5));
      expect(serializeGraph(editor.graph)).toBe(before);
    } finally { editor.dispose(); refA.dispose(); refB.dispose(); }
  }
});

it.each(['split', 'merge'] as const)('moves artwork across mask regions during %s while preserving each semantic child once', async direction => {
  const editor = createEditor(), refA = createEditor(), refB = createEditor();
  const merged: SceneSpec = { name: 'merged', segments: [{ masks: [
    { name: 'Wide mask', maskType: 'ALPHA', x: 5, y: 8, width: 50, height: 60, opacity: .85 },
  ], artwork: [
    { name: 'Artwork A', x: 10, width: 24, color: { r: .9, g: .1, b: .08, a: 1 } },
    { name: 'Artwork B', x: 72, width: 24, color: { r: .08, g: .75, b: .18, a: 1 } },
  ] }] };
  const split: SceneSpec = { name: 'split', segments: [
    { masks: [{ name: 'Wide mask', maskType: 'ALPHA', x: 10, y: 8, width: 50, height: 60, opacity: .85 }], artwork: [
      { name: 'Artwork A', x: 15, width: 24, color: { r: .9, g: .1, b: .08, a: 1 } },
    ] },
    { masks: [{ name: 'Narrow mask', type: 'ELLIPSE', maskType: 'LUMINANCE', x: 55, y: 8, width: 45, height: 60, opacity: .72, color: { r: .55, g: .55, b: .55, a: 1 } }], artwork: [
      { name: 'Artwork B', x: 78, width: 24, color: { r: .08, g: .75, b: .18, a: 1 } },
    ] },
  ] };
  const startSpec = direction === 'split' ? merged : split, endSpec = direction === 'split' ? split : merged;
  const from = buildScene(editor.graph, startSpec), to = buildScene(editor.graph, endSpec);
  try {
    const before = serializeGraph(editor.graph), refs = new Map<number, Uint8Array>();
    const startPixels = await rendered(editor.graph, from.root), endPixels = await rendered(editor.graph, to.root);
    for (const p of [.25, .5, .75]) {
      const atFrom = buildScene(refA.graph, atProgress(startSpec, endSpec, p));
      const atTo = buildScene(refB.graph, atProgress(endSpec, startSpec, 1 - p));
      refs.set(p, blend(await rendered(refA.graph, atFrom.root), await rendered(refB.graph, atTo.root), p));
    }
    const plan = await prepareNativeReactMotion(kit, editor.graph, { sessionId: 102, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id } });
    const sampler = createNativeReactMotionGraph(editor.graph, from.root.id, editor.graph, to.root.id, { ...link, target: to.root.id });
    for (const name of ['Artwork A', 'Artwork B']) {
      const sourceId = sampler.sourceNodeId(from.nodes.get(name)!.id)!;
      expect(sourceId).toBe(sampler.sourceNodeId(to.nodes.get(name)!.id));
      expect([...sampler.sample(.5).nodes.values()].filter(node => node.name === name)).toHaveLength(1);
    }
    expect(difference(blend(startPixels, endPixels, .5), refs.get(.5)!)).toBeGreaterThan(2);
    expect(difference(pixels((await plan.frame(0)).nodes[0]!.image!), startPixels)).toBe(0);
    expect(difference(pixels((await plan.frame(1)).nodes[0]!.image!), endPixels)).toBe(0);
    for (const p of [.25, .5, .75]) expect(difference(pixels((await plan.frame(p)).nodes[0]!.image!), refs.get(p)!)).toBeLessThanOrEqual(2);
    expect(serializeGraph(editor.graph)).toBe(before);
  } finally { editor.dispose(); refA.dispose(); refB.dispose(); }
});

it('blends complete two-mask intersections at shared sampled geometry instead of multiplying independently blended masks', async () => {
  const editor = createEditor(), fromRef = createEditor(), toRef = createEditor(), naiveRef = createEditor();
  const artwork = { name: 'Single artwork', x: 15, y: 18, width: 72, height: 48, color: { r: .8, g: .16, b: .05, a: 1 }, opacity: 1 };
  const pair = (name: string, a: number, b: number, xA: number, xB: number): SceneSpec => ({ name, segments: [{ masks: [
    { name: 'Intersection A', maskType: 'ALPHA', x: xA, y: 10, width: 80, height: 62, opacity: a },
    { name: 'Intersection B', type: 'ELLIPSE', maskType: 'ALPHA', x: xB, y: 13, width: 58, height: 56, opacity: b },
  ], artwork: [artwork] }] });
  const fromSpec = pair('two-mask-from', .2, .9, 10, 24), toSpec = pair('two-mask-to', .9, .2, 30, 52);
  const from = buildScene(editor.graph, fromSpec), to = buildScene(editor.graph, toSpec);
  try {
    const before = serializeGraph(editor.graph);
    const refs = new Map<number, Uint8Array>();
    for (const p of [.25, .5, .75]) {
      const fromAt = buildScene(fromRef.graph, atProgress(fromSpec, toSpec, p));
      const toAt = buildScene(toRef.graph, atProgress(toSpec, fromSpec, 1 - p));
      refs.set(p, blend(await rendered(fromRef.graph, fromAt.root), await rendered(toRef.graph, toAt.root), p));
    }
    const naive = await rendered(naiveRef.graph, buildScene(naiveRef.graph, pair('independently-interpolated', .55, .55, 20, 38)).root);
    expect(difference(refs.get(.5)!, naive)).toBeGreaterThan(8);
    const plan = await prepareNativeReactMotion(kit, editor.graph, { sessionId: 103, from: { rootId: from.root.id }, to: { rootId: to.root.id }, link: { ...link, target: to.root.id } });
    for (const p of [.25, .5, .75]) expect(difference(pixels((await plan.frame(p)).nodes[0]!.image!), refs.get(p)!)).toBeLessThanOrEqual(2);
    expect(serializeGraph(editor.graph)).toBe(before);
  } finally { editor.dispose(); fromRef.dispose(); toRef.dispose(); naiveRef.dispose(); }
});

it('uses one-sided mask coverage for added and removed layers without applying a second fade', async () => {
  const editor=createEditor(),reference=createEditor();
  const sourceMask:MaskSpec={name:'Source mask',maskType:'ALPHA',x:5,y:8,width:44,height:52,opacity:.7};
  const targetMask:MaskSpec={name:'Destination mask',maskType:'LUMINANCE',x:57,y:8,width:47,height:52,opacity:.6,color:{r:.7,g:.7,b:.7,a:1}};
  const removed:ArtSpec={name:'Removed artwork',x:12,opacity:.85},added:ArtSpec={name:'Added artwork',x:66,opacity:.9};
  const from=buildScene(editor.graph,{name:'From',segments:[{masks:[sourceMask],artwork:[removed]}]}),to=buildScene(editor.graph,{name:'To',segments:[{masks:[targetMask],artwork:[added]}]});
  try {
    const before=serializeGraph(editor.graph),plan=await prepareNativeReactMotion(kit,editor.graph,{sessionId:104,from:{rootId:from.root.id},to:{rootId:to.root.id},link:{...link,target:to.root.id}});
    const sampler=createNativeReactMotionGraph(editor.graph,from.root.id,editor.graph,to.root.id,link);
    for(const p of [.25,.5,.75]) {
      const expected=buildScene(reference.graph,{name:`Reference ${p}`,segments:[{masks:[sourceMask],artwork:[{...removed,opacity:.85*(1-p)}]},{masks:[targetMask],artwork:[{...added,opacity:.9*p}]}]});
      expect(difference(pixels((await plan.frame(p)).nodes[0]!.image!),await rendered(reference.graph,expected.root))).toBeLessThanOrEqual(2);
      const sample=sampler.sample(p);
      expect(sample.getNode(sampler.sourceNodeId(from.nodes.get(removed.name)!.id)!)!.opacity).toBeCloseTo(1-p);
      expect(sample.getNode(sampler.sourceNodeId(to.nodes.get(added.name)!.id)!)!.opacity).toBeCloseTo(p);
    }
    expect(serializeGraph(editor.graph)).toBe(before);
  } finally {editor.dispose();reference.dispose();}
});

it('uses the displayed combined alpha plane for native hit regions and bounds coverage allocation', async () => {
  const editor=createEditor();
  const artwork:ArtSpec={name:'Coverage reference',x:0,y:0,width:112,height:82,opacity:1,color:{r:1,g:1,b:1,a:1}};
  const from=buildScene(editor.graph,{name:'From',segments:[{masks:[{name:'Left ellipse',type:'ELLIPSE',maskType:'ALPHA',x:8,y:8,width:44,height:58,opacity:.7}],artwork:[artwork]}]});
  const to=buildScene(editor.graph,{name:'To',segments:[{masks:[{name:'Right rectangle',maskType:'LUMINANCE',x:61,y:12,width:44,height:54,opacity:.6,color:{r:.65,g:.65,b:.65,a:1}}],artwork:[artwork]}]});
  try {
    const sampler=createNativeReactMotionGraph(editor.graph,from.root.id,editor.graph,to.root.id,link),id=sampler.sourceNodeId(from.nodes.get(artwork.name)!.id)!;
    for(const p of [.25,.5,.75]) {
      const sample=sampler.sample(p),root=sample.getNode(sampler.rootId)!,result=renderNativeSceneImage(kit,sample,root,true);
      const displayed=pixels((await renderNativeReactModel(kit,sample,[root.id])).nodes[0]!.image!);
      const regions=result.maskRegions.get(root.id)!;expect(regions).toHaveLength(1);expect(regions[0]!.children).toEqual([id]);
      expect(regions[0]!.path).toBe(nativeMaskPath(displayed,224,164,2,0,0));
      const again=sampler.sample(p);expect(again.getNode(sampler.rootId)!.childIds).toEqual(root.childIds);
    }
    from.root.width=to.root.width=3200;from.root.height=to.root.height=3200;
    Object.assign(from.nodes.get('Left ellipse')!, { width: 3200, height: 3200 });
    Object.assign(to.nodes.get('Right rectangle')!, { width: 3200, height: 3200 });
    const large=createNativeReactMotionGraph(editor.graph,from.root.id,editor.graph,to.root.id,link),sample=large.sample(.5);
    expect(()=>renderNativeSceneImage(kit,sample,sample.getNode(large.rootId)!,true)).toThrow('16 megapixels');
  } finally {editor.dispose();}
});

import type { CanvasKit, ColorFilter, Image, MallocObj, Paint, Surface } from 'canvaskit-wasm';
import { getNodeLocalMatrix, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import { cloneDesignSubgraph } from './graphSubset';
import { freeNativeSurfacePixels, releaseNativeResources } from './nativeRendererLifecycle';
import { nativeAppearance, validNativeAppearance } from './prototypeNativeAppearance';
import { readPrototypeScroll, readScrollBehaviour } from './prototypeScroll';
import { inheritNativeMotionMasks } from './nativeReactMotionMasks';
import { inheritNativeMotionMaskRegions } from './nativeReactMotionMaskRegions';

type OwnPaint = Pick<SceneNode, 'fills' | 'strokes' | 'effects' | 'strokeCap' | 'strokeJoin' | 'strokeMiterLimit' | 'dashPattern' | 'independentStrokeWeights' | 'borderTopWeight' | 'borderRightWeight' | 'borderBottomWeight' | 'borderLeftWeight'> & { fillPathPaints: (SceneNode['fills'] | undefined)[]; strokePathPaints: (SceneNode['fills'] | undefined)[] };
type Mix = { from: OwnPaint; to: OwnPaint; progress: number };
export type MotionCompositeBounds = { minX: number; minY: number; width: number; height: number };
type Capture = { bytes: Uint8Array; width: number; height: number; scale: number; bounds: MotionCompositeBounds };
type Budget = { groups: number; pixels: number; bytes: number };
const composites = new WeakMap<SceneGraph, Map<string, Mix>>();
const ownPaint = (node: SceneNode): OwnPaint => structuredClone({ fills: node.fills, strokes: node.strokes, effects: node.effects, strokeCap: node.strokeCap, strokeJoin: node.strokeJoin, strokeMiterLimit: node.strokeMiterLimit, dashPattern: node.dashPattern, independentStrokeWeights: node.independentStrokeWeights, borderTopWeight: node.borderTopWeight, borderRightWeight: node.borderRightWeight, borderBottomWeight: node.borderBottomWeight, borderLeftWeight: node.borderLeftWeight, fillPathPaints: node.fillGeometry.map(path => path.fills), strokePathPaints: node.strokeGeometry.map(path => path.fills) });
function applyOwnPaint(node: SceneNode, paint: OwnPaint) {
  const { fillPathPaints, strokePathPaints, ...appearance } = structuredClone(paint);
  Object.assign(node, appearance);
  node.fillGeometry.forEach((path, index) => { path.fills = fillPathPaints[index]; });
  node.strokeGeometry.forEach((path, index) => { path.fills = strokePathPaints[index]; });
}

export function alignedNativeMotionBounds(a: MotionCompositeBounds, b: MotionCompositeBounds, supersampled = true): MotionCompositeBounds {
  const union = { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.minX + a.width, b.minX + b.width), maxY: Math.max(a.minY + a.height, b.minY + b.height) };
  const grid = (supersampled ? 2 : 1) * Math.min(2, 2048 / Math.max(union.maxX - union.minX, union.maxY - union.minY));
  const minX = Math.floor(union.minX * grid) / grid, minY = Math.floor(union.minY * grid) / grid;
  return { minX, minY, width: Math.ceil(union.maxX * grid) / grid - minX, height: Math.ceil(union.maxY * grid) / grid - minY };
}

export function nativeMotionCompositeEligible(node: SceneNode) {
  const stacks = [node.fills, ...node.fillGeometry.map(path => path.fills ?? []), ...node.strokeGeometry.map(path => path.fills ?? [])];
  return !node.isMask && ['NORMAL', 'PASS_THROUGH'].includes(node.blendMode) && stacks.every(fills => fills.length <= 64 && fills.every(fill => !fill.visible || (!fill.blendMode || fill.blendMode === 'NORMAL') && fill.type !== 'VIDEO')) && validNativeAppearance(nativeAppearance(node)) && node.effects.every(effect => !effect.visible || !effect.blendMode || effect.blendMode === 'NORMAL');
}
export function setNativeMotionComposite(graph: SceneGraph, nodeId: string, from: SceneNode, to: SceneNode, progress: number) {
  if (!Number.isFinite(progress) || Math.abs(progress) > 100) throw new Error('Native appearance progress must be finite and within -100 to 100.');
  if (!nativeMotionCompositeEligible(from) || !nativeMotionCompositeEligible(to)) throw new Error('This appearance change needs native mask, live media or external backdrop composition.');
  const mix = { from: ownPaint(from), to: ownPaint(to), progress: Math.max(0, Math.min(1, progress)) };
  const entries = composites.get(graph) ?? new Map<string, Mix>();
  entries.set(nodeId, mix);
  if (entries.size > 128 || new TextEncoder().encode(JSON.stringify([...entries])).byteLength > 4 * 1024 * 1024) throw new Error('Native appearance composition exceeds 128 groups or 4 MB of paint state.');
  composites.set(graph, entries);
}
export const hasNativeMotionComposite = (graph: SceneGraph, id: string) => composites.get(graph)?.has(id) ?? false;
export function inheritNativeMotionComposites(source: SceneGraph, target: SceneGraph) {
  inheritNativeMotionMasks(source, target);
  inheritNativeMotionMaskRegions(source, target);
  const entries = composites.get(source); if (!entries) return;
  const kept = new Map([...entries].filter(([id]) => target.getNode(id)));
  if (kept.size) {
    for (const mix of kept.values()) for (const fill of [mix.from, mix.to].flatMap(paint => [paint.fills, ...paint.fillPathPaints, ...paint.strokePathPaints].flatMap(fills => fills ?? []))) if (fill.visible && fill.imageHash && !target.images.has(fill.imageHash)) {
      const bytes = source.images.get(fill.imageHash); if (!bytes) throw new Error('Restore this native appearance image before interpolation.');
      target.images.set(fill.imageHash, bytes);
    }
    composites.set(target, kept);
  }
}

export function blendNativeMotionImages(kit: CanvasKit, a: Capture, b: Capture, progress: number, masks?: { from: { opacity: number; luminance: boolean }; to: { opacity: number; luminance: boolean } }): Uint8Array {
  if (a.width !== b.width || a.height !== b.height || a.scale !== b.scale) throw new Error('Native appearance endpoints need one aligned pixel surface.');
  let pixels: MallocObj | undefined, surface: Surface | null = null, from: Image | null = null, to: Image | null = null, output: Image | undefined, paint: Paint | undefined, luma: ColorFilter | null = null, failure: { reason: unknown } | undefined;
  try {
    pixels = kit.Malloc(Uint8Array, a.width * a.height * 4);
    surface = kit.MakeRasterDirectSurface({ width: a.width, height: a.height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, pixels, a.width * 4);
    from = kit.MakeImageFromEncoded(a.bytes); to = kit.MakeImageFromEncoded(b.bytes);
    if (!surface || !from || !to) throw new Error('This appearance could not allocate or decode its native composite.');
    paint = new kit.Paint(); paint.setBlendMode(kit.BlendMode.Plus);
    if (masks?.from.luminance || masks?.to.luminance) { luma = kit.ColorFilter.MakeLuma(); if (!luma) throw new Error('This native mask could not allocate its luminance coverage filter.'); }
    const canvas = surface.getCanvas(); canvas.clear(kit.TRANSPARENT);
    paint.setColorFilter(masks?.from.luminance ? luma : null); paint.setAlphaf((1 - progress) * (masks?.from.opacity ?? 1)); canvas.drawImage(from, 0, 0, paint);
    paint.setColorFilter(masks?.to.luminance ? luma : null); paint.setAlphaf(progress * (masks?.to.opacity ?? 1)); canvas.drawImage(to, 0, 0, paint); surface.flush();
    output = surface.makeImageSnapshot(); const bytes = output.encodeToBytes(kit.ImageFormat.PNG);
    if (!bytes) throw new Error('This appearance could not encode its native composite.');
    return new Uint8Array(bytes);
  } catch (error) { failure = { reason: error }; throw error; }
  finally { releaseNativeResources([() => output?.delete(), () => paint?.delete(), () => luma?.delete(), () => from?.delete(), () => to?.delete(), () => surface?.delete(), () => freeNativeSurfacePixels(kit, surface, pixels)], failure); }
}

export function materializeNativeMotionComposites(kit: CanvasKit, graph: SceneGraph, rootId: string, measure: (graph: SceneGraph, root: SceneNode) => MotionCompositeBounds, capture: (graph: SceneGraph, root: SceneNode, bounds: MotionCompositeBounds) => Capture, budget: Budget = { groups: 0, pixels: 0, bytes: 0 }, ownLayer = false, prepareVariant?: (graph: SceneGraph, root: SceneNode) => void, materialized?: Set<string>) {
  const entries = composites.get(graph); if (!entries?.size) return;
  const visit = (id: string, depth: number) => {
    if (depth > 128) throw new Error('Native appearance composition exceeds 128 layer levels.');
    const node = graph.getNode(id); if (!node || !node.visible || node.internalOnly) return;
    for (const child of [...node.childIds]) visit(child, depth + 1);
    const mix = entries.get(id); if (!mix) return;
    entries.delete(id);
    if (mix.progress <= 0 || mix.progress >= 1) { applyOwnPaint(node, mix.progress <= 0 ? mix.from : mix.to); return; }
    const pending = [node], seen = new Set<string>();
    while (pending.length) {
      const child = pending.pop()!; if (seen.has(child.id) || seen.size >= 20_000) throw new Error('Native appearance composition has recursive or excessive layers.');
      seen.add(child.id); if (!child.visible || child.internalOnly) continue;
      if (child.isMask && child.id === id || !['NORMAL', 'PASS_THROUGH'].includes(child.blendMode) || child.fills.some(fill => fill.visible && (fill.type === 'VIDEO' || fill.blendMode && fill.blendMode !== 'NORMAL')) || child.effects.some(effect => effect.visible && effect.type === 'BACKGROUND_BLUR') || !(ownLayer && child.id === rootId) && (readPrototypeScroll(child).settings.axis !== 'none' || readScrollBehaviour(child, graph).behaviour !== 'scroll')) throw new Error('This changing appearance crosses live content or an external scene backdrop.');
      pending.push(...graph.getChildren(child.id));
    }
    if (++budget.groups > 128) throw new Error('Native appearance composition exceeds 128 rendered groups.');
    const fromGraph = cloneDesignSubgraph(graph, [id]), toGraph = cloneDesignSubgraph(graph, [id]), fromNode = fromGraph.getNode(id)!, toNode = toGraph.getNode(id)!;
    fromGraph.images = new Map(graph.images); toGraph.images = new Map(graph.images);
    applyOwnPaint(fromNode, mix.from); applyOwnPaint(toNode, mix.to);
    prepareVariant?.(fromGraph, fromNode); prepareVariant?.(toGraph, toNode);
    const bounds = alignedNativeMotionBounds(measure(fromGraph, fromNode), measure(toGraph, toNode));
    const scale = Math.min(2, 2048 / Math.max(bounds.width, bounds.height));
    budget.pixels += 4 * Math.max(1, Math.min(2048, Math.ceil(bounds.width * scale))) * Math.max(1, Math.min(2048, Math.ceil(bounds.height * scale)));
    if (budget.pixels > 16 * 1024 * 1024) throw new Error('Native appearance composition exceeds 16 megapixels per frame.');
    const first = capture(fromGraph, fromNode, bounds), second = capture(toGraph, toNode, bounds);
    const bytes = blendNativeMotionImages(kit, first, second, mix.progress); budget.bytes += bytes.byteLength;
    if (budget.bytes > 24 * 1024 * 1024) throw new Error('Native appearance composition exceeds 24 MB of encoded group pixels.');
    const hash = `orion.native-motion/${id}`; if (graph.images.has(hash)) throw new Error('A native appearance resource identity is already in use.');
    graph.images.set(hash, bytes);
    if ([...graph.images.values()].reduce((total, image) => total + image.byteLength, 0) > 24 * 1024 * 1024) throw new Error('Native appearance composition exceeds 24 MB of retained image resources.');
    const transform = getNodeLocalMatrix(node);
    Object.assign(node, { type: 'RECTANGLE', width: first.width / first.scale, height: first.height / first.scale, childIds: [], fills: [{ type: 'IMAGE', visible: true, opacity: 1, imageHash: hash, imageScaleMode: 'FILL' }], strokes: [], effects: [], cornerRadius: 0, independentCorners: false, independentStrokeWeights: false, clipsContent: false, layoutMode: 'NONE' });
    const zero = getNodeLocalMatrix(node, { x: 0, y: 0 });
    node.x = transform[2]! + transform[0]! * bounds.minX + transform[1]! * bounds.minY - zero[2]!;
    node.y = transform[5]! + transform[3]! * bounds.minX + transform[4]! * bounds.minY - zero[5]!;
    materialized?.add(id);
    graph.clearAbsPosCache();
  };
  visit(rootId, 0);
}

import type { SkiaRenderer } from '@open-pencil/core/canvas';
import { computeAllLayouts, getTextMeasurer, setTextMeasurer } from '@open-pencil/core/layout';
import { fontManager } from '@open-pencil/core/text';
import type { SceneGraph } from '@open-pencil/scene-graph';
import type { CanvasKit, MallocObj, Surface, TypefaceFontProvider } from 'canvaskit-wasm';
import { attachNativeSceneFonts, nativeSceneFaceIssue, nativeSceneTextNodes } from './nativeSceneFonts';
import { createNativeRenderer, destroyNativeRenderer, freeNativeSurfacePixels, releaseNativeResources } from './nativeRendererLifecycle';
import { reconcilePrototypeGeometry, snapshotPrototypeGeometry } from './prototypeGeometry';

const prepared = new WeakSet<SceneGraph>();
export const hasNativeSceneLayout = (graph: SceneGraph) => prepared.has(graph);
/** Apply only to a private presentation graph. The measurer's global scope never crosses an await. */
export function prepareNativeSceneLayout(kit: CanvasKit, graph: SceneGraph, ids: readonly string[]): { needed: boolean; issue?: string } {
  if (![...graph.nodes.values()].some(node => node.layoutMode !== 'NONE' || node.layoutGrow)) return { needed: false };
  for (const node of graph.nodes.values()) if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width < 0 || node.height < 0) throw new Error('This presentation produced invalid native layout geometry.');
  const text = nativeSceneTextNodes(graph, ids);
  if (text.some(nativeSceneFaceIssue)) return { needed: true, issue: 'Wait for this presentation’s exact fonts before resolving native layout.' };
  let surface: Surface | null = null, pixels: MallocObj | undefined, renderer: SkiaRenderer | undefined, provider: TypefaceFontProvider | undefined, failure: { reason: unknown } | undefined;
  const previous = getTextMeasurer();
  try {
    pixels = kit.Malloc(Uint8Array, 64 * 64 * 4);
    surface = kit.MakeRasterDirectSurface({ width: 64, height: 64, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, pixels, 64 * 4);
    if (!surface) throw new Error('This presentation could not allocate its native layout surface.');
    renderer = createNativeRenderer(kit, surface); attachNativeSceneFonts(renderer, kit, text, value => { provider = value; });
    const ownedRenderer = renderer;
    let measurementFailure: { reason: unknown } | undefined;
    setTextMeasurer((node, width) => {
      try { const measured = ownedRenderer.measureTextNode(node, width); if (!measured) throw new Error(`${node.name}: native layout could not measure this text.`); return measured; }
      // Yoga must finish and free its native tree before a JavaScript measurement failure escapes.
      catch (error) { measurementFailure ??= { reason: error }; return { width: node.width, height: node.height }; }
    });
    let settled = false;
    for (let pass = 0; pass < 8; pass++) {
      const originals = snapshotPrototypeGeometry(graph);
      for (const id of new Set(ids)) computeAllLayouts(graph, id);
      if (measurementFailure) throw measurementFailure.reason;
      reconcilePrototypeGeometry(graph, originals);
      if ([...graph.nodes.values()].every(node => { const before = originals.get(node.id)!; return node.x === before.x && node.y === before.y && node.width === before.width && node.height === before.height; })) { settled = true; break; }
    }
    if (!settled) throw new Error('This presentation’s native layout did not settle.');
    for (const node of graph.nodes.values()) if (![node.x, node.y, node.width, node.height].every(Number.isFinite) || node.width < 0 || node.height < 0) throw new Error('This presentation produced invalid native layout geometry.');
    prepared.add(graph); return { needed: true };
  } catch (error) { failure = { reason: error }; throw error; }
  finally { releaseNativeResources([() => setTextMeasurer(previous), () => renderer?.textPreparationCache.clear(), () => renderer?.labelParagraphCache.clear(), () => renderer ? destroyNativeRenderer(renderer) : surface?.delete(), () => { if (provider && !provider.isDeleted()) provider.delete(); }, () => { if (provider) fontManager.detachProvider(provider); }, () => freeNativeSurfacePixels(kit, surface, pixels)], failure); }
}

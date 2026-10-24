import { createEditor, type Editor } from '@open-pencil/core/editor';
import type { SkiaRenderer } from '@open-pencil/core/canvas';
import { scaledGeometryChanges } from '@open-pencil/scene-graph/resize';
import type { SceneNode } from '@open-pencil/scene-graph';
import type { CanvasKit, MallocObj, Surface } from 'canvaskit-wasm';
import type { DesignMotion } from './reactExportRuntime';
import type { SmartLayerSnapshot } from './prototypeSmartSnapshot';
import type { SmartMotionTrack } from './prototypeSmartMotion';
import { smartRgbaAt } from './prototypeSmartColor';
import { prototypeMotionMetadata, prototypePaintMetadata } from './prototypeMotionMetadata';
import { artworkInsetStyle, nativeAppearance, nativeAppearanceTween, nativeArtworkInsets, validNativeAppearance, type NativeAppearance } from './prototypeNativeAppearance';
import { createNativeRenderer, destroyNativeRenderer, freeNativeSurfacePixels, releaseNativeResources } from './nativeRendererLifecycle';

type Paint = DesignMotion['paints'][number];
export type NativePaintState = { version: 1; paints: Paint[]; width: number; height: number; radii: DesignMotion['radii']; appearance?: NativeAppearance };
type Source = { node: SceneNode; kit: CanvasKit };
const gradients = new Set(['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']);
const allowed = (paint: Paint) => paint.type === 'SOLID' || gradients.has(paint.type);
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, progress: number) => a + (b - a) * progress;
let generation = 0;
const modelSources = new WeakMap<object, PrototypePaintSources>();
export const nativeSourcesFor = (model: object) => modelSources.get(model);
export function registerNativePaintSources(model: object, sources: PrototypePaintSources) { if (sources.bytes) modelSources.set(model, sources); }
export function nativePaintEligible(node: SceneNode) {
  const fills = node.fills.filter(fill => fill.visible), strokes = node.strokes.filter(stroke => stroke.visible), effects = node.effects.filter(effect => effect.visible);
  const appearance = nativeAppearance(node);
  return (fills.some(fill => gradients.has(fill.type)) || fills.length > 1 || strokes.length > 0 || effects.length > 0) && fills.length <= 64 && fills.map(prototypePaintMetadata).every(validPaint) && ['NORMAL', 'PASS_THROUGH'].includes(node.blendMode) && node.type !== 'TEXT' && !node.isMask && node.width > 0 && node.height > 0 && [node.width, node.height, ...nodeNativeRadii(node)].every(value => Number.isFinite(value) && value >= 0) && !(node.childIds.length && effects.length) && !effects.some(effect => effect.type === 'BACKGROUND_BLUR') && ![...node.fillGeometry, ...node.strokeGeometry].some(path => path.fills?.length) && validNativeAppearance(appearance);
}
const nodeNativeRadii = (node: SceneNode) => node.independentCorners ? [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] : [node.cornerRadius];
export function nodeNativePaintState(node: SceneNode): NativePaintState {
  const motion = prototypeMotionMetadata(node, true);
  return { version: 1, paints: motion.paints, width: node.width, height: node.height, radii: motion.radii, appearance: nativeAppearance(node) };
}
export class PrototypePaintSources {
  private sources = new Map<string, Source>();
  readonly prefix = `native-paint-${++generation}-`;
  bytes = 0;
  constructor(private kit: CanvasKit) {}
  add(node: SceneNode): string | undefined {
    if (!nativePaintEligible(node)) return;
    const key = this.prefix + this.sources.size + '-' + node.id;
    const bytes = new TextEncoder().encode(JSON.stringify(node)).byteLength;
    if (this.bytes + bytes > 32 * 1024 * 1024) throw new Error('This presentation exceeds the 32 MB native paint source allowance.');
    const copy = structuredClone(node); this.bytes += bytes; this.sources.set(key, { node: copy, kit: this.kit }); return key;
  }
  get(key?: string) { return key ? this.sources.get(key) : undefined; }
}
function validColor(value: unknown): value is Paint['color'] { return Array.isArray(value) && value.length === 4 && value.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1); }
function validPaint(paint: Paint) {
  if (!paint || typeof paint !== 'object' || !allowed(paint) || !validColor(paint.color) || !Number.isFinite(paint.opacity) || paint.opacity < 0 || paint.opacity > 1 || typeof paint.blend !== 'string' || paint.blend.length > 64) return false;
  const transform = paint.transform === undefined || Array.isArray(paint.transform) && paint.transform.length === 6 && paint.transform.every(Number.isFinite);
  const stops = paint.stops === undefined || Array.isArray(paint.stops) && paint.stops.length >= 2 && paint.stops.length <= 1024 && paint.stops.every((stop, index) => !!stop && Number.isFinite(stop.position) && stop.position >= 0 && stop.position <= 1 && (!index || stop.position >= paint.stops![index - 1]!.position) && validColor(stop.color));
  return transform && stops && (paint.type === 'SOLID' || !!paint.transform && !!paint.stops);
}
function validState(state: NativePaintState) { return state?.version === 1 && Array.isArray(state.paints) && state.paints.length <= 64 && state.paints.every(validPaint) && state.width > 0 && state.height > 0 && [state.width, state.height].every(Number.isFinite) && Array.isArray(state.radii) && state.radii.length === 4 && state.radii.every(value => Number.isFinite(value) && value >= 0) && (state.appearance === undefined || validNativeAppearance(state.appearance)); }
export function nativePaintState(layer: SmartLayerSnapshot, source?: SceneNode): NativePaintState | undefined {
  const proxies = [...layer.element.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute('data-xdesign-motion-paint'));
  if (proxies.length > 1) return;
  let state: NativePaintState;
  if (proxies.length) {
    const proxy = proxies[0]!, opacity = getComputedStyle(proxy).opacity, text = proxy.getAttribute('data-xdesign-native-paint');
    if (opacity && Number(opacity) !== 1 || !text || text.length > 16 * 1024 * 1024) return;
    try { state = JSON.parse(text) as NativePaintState; } catch { return; }
  } else state = { version: 1, paints: layer.motion.paints, width: layer.pose.width, height: layer.pose.height, radii: layer.pose.radii ?? layer.motion.radii, ...(source ? { appearance: nativeAppearance(source) } : {}) };
  return validState(state) ? state : undefined;
}
export function nativePaintTween(from: NativePaintState, to: NativePaintState): ((progress: number) => NativePaintState) | undefined {
  if (!validState(from) || !validState(to) || from.paints.length !== to.paints.length || !(from.paints.some(paint => gradients.has(paint.type)) || from.paints.length > 1 || from.appearance?.strokes.length || from.appearance?.effects.length) || from.paints.some((paint, index) => paint.type !== to.paints[index]!.type || paint.blend !== to.paints[index]!.blend || !!paint.transform !== !!to.paints[index]!.transform || (paint.stops?.length ?? 0) !== (to.paints[index]!.stops?.length ?? 0))) return;
  const appearance = nativeAppearanceTween(from.appearance, to.appearance); if (!appearance) return;
  const a = structuredClone(from), b = structuredClone(to);
  return progress => {
    if (!Number.isFinite(progress)) throw new Error('Choose a finite native paint position.');
    if (progress === 0) return structuredClone(a); if (progress === 1) return structuredClone(b);
    return { version: 1, width: Math.max(0.0001, lerp(a.width, b.width, progress)), height: Math.max(0.0001, lerp(a.height, b.height, progress)), radii: a.radii.map((radius, index) => Math.max(0, lerp(radius, b.radii[index]!, progress))) as NativePaintState['radii'], ...(a.appearance || b.appearance ? { appearance: appearance(progress) } : {}), paints: a.paints.map((paint, index) => {
      const end = b.paints[index]!;
      let position = 0;
      return { ...paint, color: smartRgbaAt(paint.color, end.color, progress), opacity: clamp(lerp(paint.opacity, end.opacity, progress)), ...(paint.transform ? { transform: paint.transform.map((value, index) => lerp(value, end.transform![index]!, progress)) as Paint['transform'] } : {}), ...(paint.stops ? { stops: paint.stops.map((stop, index) => { position = Math.max(position, clamp(lerp(stop.position, end.stops![index]!.position, progress))); return { position, color: smartRgbaAt(stop.color, end.stops![index]!.color, progress) }; }) } : {}) };
    }) };
  };
}
export class NativePaintRaster {
  private editor: Editor;
  private renderer: SkiaRenderer;
  private node: SceneNode;
  private original: SceneNode;
  private downsample: Surface;
  private highPixels: MallocObj;
  private lowPixels: MallocObj;
  private closed = false;
  constructor(private kit: CanvasKit, readonly surface: Surface, source: SceneNode, readonly width: number, readonly height: number) {
    let high: Surface | null = null, low: Surface | null = null, highPixels: MallocObj | undefined, lowPixels: MallocObj | undefined, editor: Editor | undefined;
    try {
      this.editor = editor = createEditor();
      this.original = structuredClone(source);
      const { id: _id, parentId: _parentId, childIds: _childIds, type, ...properties } = structuredClone(source);
      this.node = this.editor.graph.createNode(type, this.editor.state.currentPageId, { ...properties, x: 0, y: 0, childIds: [], rotation: 0, flipX: false, flipY: false, opacity: 1, boundVariables: {}, effects: [], strokes: [] });
      // Convenience software surfaces store unpremultiplied bytes; native PNG export uses premultiplied buffers at both rendering stages.
      highPixels = kit.Malloc(Uint8Array, width * height * 16);
      high = kit.MakeRasterDirectSurface({ width: width * 2, height: height * 2, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, highPixels, width * 8); if (!high) throw new Error('This gradient could not allocate its supersampled paint surface.');
      lowPixels = kit.Malloc(Uint8Array, width * height * 4);
      low = kit.MakeRasterDirectSurface({ width, height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB }, lowPixels, width * 4); if (!low) throw new Error('This artwork could not allocate its premultiplied downsample surface.');
      this.highPixels = highPixels; this.lowPixels = lowPixels; this.downsample = low;
      this.renderer = createNativeRenderer(kit, high);
    } catch (error) { releaseNativeResources([() => high?.delete(), () => low?.delete(), () => freeNativeSurfacePixels(kit, high, highPixels), () => freeNativeSurfacePixels(kit, low, lowPixels), () => editor?.dispose(), () => surface.dispose()], { reason: error }); throw error; }
  }
  draw(state: NativePaintState) {
    if (this.closed) throw new Error('This native paint raster was closed.');
    if (!validState(state)) throw new Error('This native paint has invalid geometry or paint values.');
    const fills = state.paints.map(paint => ({ type: paint.type as SceneNode['fills'][number]['type'], color: { r: paint.color[0], g: paint.color[1], b: paint.color[2], a: paint.color[3] }, opacity: paint.opacity, visible: true, blendMode: paint.blend as SceneNode['blendMode'], ...(paint.transform ? { gradientTransform: { m00: paint.transform[0], m10: paint.transform[1], m01: paint.transform[2], m11: paint.transform[3], m02: paint.transform[4], m12: paint.transform[5] } } : {}), ...(paint.stops ? { gradientStops: paint.stops.map(stop => ({ position: stop.position, color: { r: stop.color[0], g: stop.color[1], b: stop.color[2], a: stop.color[3] } })) } : {}) }));
    const appearance = state.appearance;
    this.editor.graph.updateNode(this.node.id, { ...scaledGeometryChanges(this.original, this.original.width, this.original.height, state.width, state.height), width: state.width, height: state.height, fills, strokes: appearance?.strokes ?? [], effects: appearance?.effects ?? [], ...(appearance ? { strokeCap: appearance.cap, strokeJoin: appearance.join, strokeMiterLimit: appearance.miter, dashPattern: appearance.dash, independentStrokeWeights: appearance.independent, borderTopWeight: appearance.borders[0], borderRightWeight: appearance.borders[1], borderBottomWeight: appearance.borders[2], borderLeftWeight: appearance.borders[3] } : {}), cornerRadius: state.radii.every(radius => radius === state.radii[0]) ? state.radii[0] : this.original.cornerRadius, independentCorners: true, topLeftRadius: state.radii[0], topRightRadius: state.radii[1], bottomRightRadius: state.radii[2], bottomLeftRadius: state.radii[3] });
    this.renderer.invalidateAllPictures(); this.renderer.invalidateVectorPath(this.node.id); this.renderer.worldViewport = { x: -1e9, y: -1e9, w: 2e9, h: 2e9 };
    // Resized geometry gets new blobs; the private raster must not retain every past frame's paths.
    for (const cache of [this.renderer.fillGeometryCache, this.renderer.strokeGeometryCache]) { for (const paths of cache.values()) paths.forEach(path => path.delete()); cache.clear(); }
    for (const cache of [this.renderer.imageFilterCache, this.renderer.maskFilterCache]) { for (const filter of cache.values()) filter?.delete(); cache.clear(); }
    const canvas = this.renderer.surface.getCanvas(); canvas.clear(this.kit.TRANSPARENT); canvas.save();
    const insets = nativeArtworkInsets(appearance, this.node.vectorNetwork), logicalWidth = state.width + insets.left + insets.right, logicalHeight = state.height + insets.top + insets.bottom;
    if (![logicalWidth, logicalHeight].every(value => Number.isFinite(value) && value > 0)) { canvas.restore(); throw new Error('This native artwork has invalid expanded bounds.'); }
    try { canvas.scale(2 * this.width / logicalWidth, 2 * this.height / logicalHeight); canvas.translate(insets.left, insets.top); this.renderer.renderNode(canvas, this.editor.graph, this.node.id, {}); }
    finally { canvas.restore(); }
    this.renderer.surface.flush();
    const image = this.renderer.surface.makeImageSnapshot(), low = this.downsample.getCanvas();
    try { low.clear(this.kit.TRANSPARENT); low.drawImageRectOptions(image, this.kit.LTRBRect(0, 0, this.width * 2, this.height * 2), this.kit.LTRBRect(0, 0, this.width, this.height), this.kit.FilterMode.Linear, this.kit.MipmapMode.None, null); }
    finally { image.delete(); }
    this.downsample.flush();
    const output = this.downsample.makeImageSnapshot(), display = this.surface.getCanvas();
    try { display.clear(this.kit.TRANSPARENT); display.drawImage(output, 0, 0); }
    finally { output.delete(); }
    this.surface.flush();
  }
  dispose() { if (this.closed) return; this.closed = true; releaseNativeResources([() => destroyNativeRenderer(this.renderer), () => this.downsample.delete(), () => freeNativeSurfacePixels(this.kit, this.renderer.surface, this.highPixels), () => freeNativeSurfacePixels(this.kit, this.downsample, this.lowPixels), () => this.surface.dispose(), () => this.editor.dispose()]); }
}
export function renderNativePaintImage(kit: CanvasKit, node: SceneNode) {
  const state = nodeNativePaintState(node), insets = nativeArtworkInsets(state.appearance, node.vectorNetwork), w = node.width + insets.left + insets.right, h = node.height + insets.top + insets.bottom, scale = Math.min(2, 2048 / Math.max(w, h));
  if (![w, h].every(value => Number.isFinite(value) && value > 0)) throw new Error('This native artwork has invalid expanded bounds.');
  const width = Math.max(1, Math.min(2048, Math.ceil(w * scale))), height = Math.max(1, Math.min(2048, Math.ceil(h * scale))), surface = kit.MakeSurface(width, height);
  if (!surface) throw new Error('This artwork could not allocate its native export surface.');
  const raster = new NativePaintRaster(kit, surface, node, width, height);
  let failure: { reason: unknown } | undefined;
  try { raster.draw(state); const image = surface.makeImageSnapshot(); try { const bytes = image.encodeToBytes(kit.ImageFormat.PNG); if (!bytes) throw new Error('This native artwork could not encode its PNG.'); return { bytes: new Uint8Array(bytes), style: artworkInsetStyle(node.width, node.height, insets) }; } finally { image.delete(); } }
  catch (error) { failure = { reason: error }; throw error; }
  finally { releaseNativeResources([() => raster.dispose()], failure); }
}
export type NativePaintPlan = { attach: (paint: HTMLElement) => { track: SmartMotionTrack; dispose: () => void } };
export class NativePaintContext {
  private pixels = 0;
  private stops = 0;
  private appearances = 0;
  constructor(private sources: readonly PrototypePaintSources[], private makeSurface: (kit: CanvasKit, canvas: HTMLCanvasElement) => Surface | null = (kit, canvas) => kit.MakeSWCanvasSurface(canvas)) {}
  plan(from: SmartLayerSnapshot, to: SmartLayerSnapshot): NativePaintPlan | undefined {
    const find = (key?: string) => this.sources.map(sources => sources.get(key)).find(Boolean), source = find(from.motion.artwork), target = find(to.motion.artwork);
    if (!source || !target) return;
    const a = nativePaintState(from, source.node), b = nativePaintState(to, target.node); if (!a || !b) return;
    const tween = nativePaintTween(a, b); if (!tween) return;
    const ai = nativeArtworkInsets(a.appearance, source.node.vectorNetwork), bi = nativeArtworkInsets(b.appearance, target.node.vectorNetwork), w = Math.max(a.width + ai.left + ai.right, b.width + bi.left + bi.right), h = Math.max(a.height + ai.top + ai.bottom, b.height + bi.top + bi.bottom);
    if (![w, h].every(value => Number.isFinite(value) && value > 0)) throw new Error('This native artwork has invalid expanded bounds.');
    const scale = Math.min(2, 2048 / Math.max(w, h)), width = Math.max(1, Math.min(2048, Math.ceil(w * scale))), height = Math.max(1, Math.min(2048, Math.ceil(h * scale)));
    const stopCount = a.paints.reduce((total, paint) => total + (paint.stops?.length ?? 1), 0);
    if (this.pixels + width * height > 16 * 1024 * 1024 || this.stops + stopCount > 16384) throw new Error('This transition exceeds the 16-megapixel or 16,384-stop native paint allowance.');
    const appearances = (a.appearance?.strokes.length ?? 0) + (a.appearance?.effects.length ?? 0);
    if (this.appearances + appearances > 4096) throw new Error('This transition exceeds the 4,096 native stroke/effect allowance.');
    this.pixels += width * height; this.stops += stopCount; this.appearances += appearances;
    return { attach: paint => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.setAttribute('data-xdesign-native-raster', ''); Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      const surface = this.makeSurface(target.kit, canvas); if (!surface) throw new Error('This gradient could not allocate its native paint surface.');
      const raster = new NativePaintRaster(target.kit, surface, target.node, width, height);
      const clips = [...to.element.children].filter((element): element is HTMLElement => typeof HTMLElement !== 'undefined' && element instanceof HTMLElement && (element.hasAttribute('data-xdesign-content-clip') || element.hasAttribute('data-xdesign-scroll') || element.hasAttribute('data-xdesign-fixed'))).map(element => ({ element, radius: element.style.borderRadius, applied: '' }));
      const restoreClips = () => clips.forEach(clip => { if (clip.element.style.borderRadius === clip.applied) clip.element.style.borderRadius = clip.radius; });
      const apply = (progress: number) => { const state = tween(progress); raster.draw(state); Object.assign(canvas.style, artworkInsetStyle(state.width, state.height, nativeArtworkInsets(state.appearance, target.node.vectorNetwork))); paint.setAttribute('data-xdesign-native-paint', JSON.stringify(state)); clips.forEach(clip => { clip.applied = `${state.radii.map(radius => `${radius * to.pose.width / state.width}px`).join(' ')} / ${state.radii.map(radius => `${radius * to.pose.height / state.height}px`).join(' ')}`; clip.element.style.borderRadius = clip.applied; clip.applied = clip.element.style.borderRadius; }); };
      try { paint.replaceChildren(canvas); apply(0); }
      catch (error) { releaseNativeResources([() => raster.dispose(), restoreClips], { reason: error }); throw error; }
      return { track: { element: paint, frame: () => ({}), apply }, dispose: () => releaseNativeResources([() => raster.dispose(), restoreClips]) };
    } };
  }
}
export function copyNativePaintRasters(source: HTMLElement, copy: HTMLElement) {
  const canvases = [...source.querySelectorAll<HTMLCanvasElement>('[data-xdesign-native-raster]')], clones = [...copy.querySelectorAll<HTMLCanvasElement>('[data-xdesign-native-raster]')];
  canvases.forEach((canvas, index) => { const image = document.createElement('img'); image.src = canvas.toDataURL('image/png'); image.alt = ''; image.style.cssText = clones[index]!.style.cssText; clones[index]!.replaceWith(image); });
}

import { SkiaRenderer } from '@open-pencil/core/canvas';
import type { Canvas, CanvasKit, MallocObj, Surface } from 'canvaskit-wasm';
import { installNativeLineStroke } from './nativeRendererLine';

type Handle = { delete: () => void; isDeleted: () => boolean };
type Failure = { reason: unknown };
const rendererHandles = new WeakMap<SkiaRenderer, readonly Handle[]>();
const rendererLineCleanup = new WeakMap<SkiaRenderer, () => void>();
const rendererOpacityCleanup = new WeakMap<SkiaRenderer, () => void>();
const rendererOpacityInstallations = new WeakMap<SkiaRenderer, () => void>();
const close = (handle: Handle) => () => { if (!handle.isDeleted()) handle.delete(); };

export function installNativeOpacityLayers(renderer: SkiaRenderer): () => void {
  if (rendererOpacityInstallations.has(renderer)) return () => {};
  const ownMethod = Object.getOwnPropertyDescriptor(renderer, 'renderNode'), original = renderer.renderNode;
  const canvases = new WeakMap<Canvas, Canvas>();
  const compatibleCanvas = (canvas: Canvas): Canvas => {
    const existing = canvases.get(canvas);
    if (existing) return existing;
    const methods = new Map<PropertyKey, { original: unknown; bound: unknown }>();
    const proxy = new Proxy(canvas, { get(target, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      const cached = methods.get(key);
      if (cached?.original === value) return cached.bound;
      const bound = key === 'saveLayer' ? (...args: Parameters<Canvas['saveLayer']>) => {
        // SDK opacity bounds use a transformed origin before applying that transform a second time.
        // Omitting only this hint lets Skia bound the layer by its actual device clip instead.
        if (args[0] === renderer.opacityPaint) args[1] = undefined;
        return Reflect.apply(value, target, args);
      } : value.bind(target);
      methods.set(key, { original: value, bound });
      return bound;
    } });
    canvases.set(canvas, proxy); canvases.set(proxy, proxy);
    return proxy;
  };
  const replacement: SkiaRenderer['renderNode'] = function (this: SkiaRenderer, ...args) {
    args[0] = compatibleCanvas(args[0]);
    return original.apply(this, args);
  };
  const descriptor = ownMethod && !ownMethod.configurable ? { ...ownMethod, value: replacement } : { value: replacement, configurable: true, writable: true, enumerable: ownMethod?.enumerable ?? false };
  Object.defineProperty(renderer, 'renderNode', descriptor);
  let installed = true;
  const restore = () => {
    if (!installed) return;
    installed = false;
    if (renderer.renderNode === replacement) {
      if (ownMethod) Object.defineProperty(renderer, 'renderNode', ownMethod);
      else delete (renderer as unknown as { renderNode?: SkiaRenderer['renderNode'] }).renderNode;
    }
    rendererOpacityInstallations.delete(renderer);
  };
  rendererOpacityInstallations.set(renderer, restore);
  return restore;
}

/** Core raster export allocates its own canvas; intercept the renderer entry rather than a caller's surface. */
export function withNativeOpacityLayers<T>(renderer: SkiaRenderer, render: () => T): T {
  const restore = rendererOpacityInstallations.has(renderer) ? undefined : installNativeOpacityLayers(renderer);
  try { return render(); } finally { restore?.(); }
}

export function releaseNativeResources(releases: readonly (() => void)[], failure?: Failure) {
  const errors: unknown[] = [];
  if (failure) errors.push(failure.reason);
  for (const release of releases) try { release(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, errors[0] instanceof Error ? errors[0].message : 'Native resource cleanup failed.', { cause: errors[0] });
}

export function freeNativeSurfacePixels(kit: CanvasKit, surface: Surface | null | undefined, pixels: MallocObj | undefined) {
  if (!pixels) return;
  if (surface && !surface.isDeleted()) throw new Error('Close the native surface before releasing its pixel buffer.');
  kit.Free(pixels);
}

export function destroyNativeRenderer(renderer: SkiaRenderer) {
  const restoreLineStroke = rendererLineCleanup.get(renderer), restoreOpacity = rendererOpacityCleanup.get(renderer);
  releaseNativeResources([() => renderer.destroy(), ...(restoreLineStroke ? [restoreLineStroke] : []), ...(restoreOpacity ? [restoreOpacity] : []), ...(rendererHandles.get(renderer) ?? []).map(close), close(renderer.surface)]);
  rendererHandles.delete(renderer);
  rendererLineCleanup.delete(renderer);
  rendererOpacityCleanup.delete(renderer);
}

export function createNativeRenderer(kit: CanvasKit, surface: Surface): SkiaRenderer {
  const owned: Handle[] = [], temporary: Handle[] = [];
  const constructor = <T extends CanvasKit['Paint'] | CanvasKit['Font']>(type: T): T => new Proxy(type, { construct(target, args) { const handle = Reflect.construct(target, args, target) as Handle; owned.push(handle); return handle; } });
  const effects = Object.create(kit.PathEffect) as CanvasKit['PathEffect'];
  effects.MakeDash = (...args) => { const effect = kit.PathEffect.MakeDash(...args); if (effect) temporary.push(effect); return effect; };
  const local = Object.create(kit) as CanvasKit;
  Object.defineProperties(local, { Paint: { value: constructor(kit.Paint), configurable: true }, Font: { value: constructor(kit.Font), configurable: true }, PathEffect: { value: effects, configurable: true } });
  try {
    const renderer = new SkiaRenderer(local, surface);
    rendererLineCleanup.set(renderer, installNativeLineStroke(renderer));
    rendererOpacityCleanup.set(renderer, installNativeOpacityLayers(renderer));
    // Paint retains its native path effect; the temporary JavaScript wrapper still needs release.
    releaseNativeResources(temporary.map(close));
    Object.defineProperties(local, { Paint: { value: kit.Paint }, Font: { value: kit.Font }, PathEffect: { value: kit.PathEffect } });
    rendererHandles.set(renderer, [...owned]);
    owned.length = 0; temporary.length = 0;
    return renderer;
  } catch (error) { releaseNativeResources([...owned, ...temporary].reverse().map(close), { reason: error }); throw error; }
}

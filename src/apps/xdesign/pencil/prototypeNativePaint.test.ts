// @vitest-environment node
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { SkiaRenderer } from '@open-pencil/core/canvas';
import type { CanvasKit } from 'canvaskit-wasm';
import type { Fill } from '@open-pencil/scene-graph';
import { NativePaintRaster, NativePaintContext, PrototypePaintSources, nativePaintTween, nativeSourcesFor, type NativePaintState } from './prototypeNativePaint';
import type { SmartLayerSnapshot } from './prototypeSmartSnapshot';
import { prototypeMotionMetadata } from './prototypeMotionMetadata';
import { selectionToDesignModel } from './reactExport';
import { serializeGraph } from './document';
import { renderDesignNodes } from './proceduralPaints';
let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function fill(type: Fill['type'], index: number): Fill { return { type, visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 }, gradientTransform: { m00: index ? .5 : 1, m01: 0, m02: index ? .25 : 0, m10: index ? .25 : 0, m11: 1, m12: 0 }, gradientStops: [{ position: index ? .2 : 0, color: { r: index ? 0 : 1, g: index ? 1 : 0, b: 0, a: 1 } }, { position: index ? .8 : 1, color: { r: index ? 1 : 0, g: index ? 1 : 0, b: 1, a: 1 } }] }; }
const state = (node: Parameters<typeof prototypeMotionMetadata>[0]): NativePaintState => ({ version: 1, paints: prototypeMotionMetadata(node, true).paints, width: node.width, height: node.height, radii: [0, 0, 0, 0] });
function pixels(surface: ReturnType<CanvasKit['MakeSurface']>) { const image = surface!.makeImageSnapshot(); try { return [...image.readPixels(0, 0, { width: 40, height: 40, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!]; } finally { image.delete(); } }
it.each(['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND'] as const)('renders %s endpoints and numeric matrix/stop midpoint with the actual native engine and no authored graph mutation', type => {
  const editor = createEditor(), expected = createEditor(), oracle = new SkiaRenderer(kit, kit.MakeSurface(40, 40)!);
  let raster: NativePaintRaster | undefined;
  try {
    const a = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [fill(type, 0)] }), b = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [fill(type, 1)] });
    const original = serializeGraph(editor.graph), tween = nativePaintTween(state(a), state(b))!, surface = kit.MakeSurface(40, 40)!; raster = new NativePaintRaster(kit, surface, b, 40, 40);
    const middle: Fill = { type, visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 }, gradientTransform: { m00: .75, m01: 0, m02: .125, m10: .125, m11: 1, m12: 0 }, gradientStops: [{ position: .1, color: { r: .5, g: .5, b: 0, a: 1 } }, { position: .9, color: { r: .5, g: .5, b: 1, a: 1 } }] };
    const samples: number[][] = [];
    for (const [progress, paint] of [[0, fill(type, 0)], [.5, middle], [1, fill(type, 1)]] as const) {
      raster.draw(tween(progress)); samples.push(pixels(surface));
      const node = expected.graph.createNode('RECTANGLE', expected.state.currentPageId, { width: 40, height: 40, fills: [paint] }); oracle.invalidateAllPictures();
      const encoded = renderDesignNodes(kit, oracle, expected.graph, expected.state.currentPageId, [node.id], { format: 'PNG', scale: 1 })!, image = kit.MakeImageFromEncoded(encoded)!;
      try { expect(samples.at(-1)).toEqual([...image.readPixels(0, 0, { width: 40, height: 40, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB })!]); } finally { image.delete(); }
    }
    expect(samples[0]).not.toEqual(samples[1]); expect(samples[1]).not.toEqual(samples[2]); expect(serializeGraph(editor.graph)).toBe(original);
  } finally { raster?.dispose(); oracle.destroy(); editor.dispose(); expected.dispose(); }
});
it('retains detached native sources with counted bytes while the public model stays serializable and portable export carries no source handle', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [fill('GRADIENT_DIAMOND', 0)] }), model = selectionToDesignModel(editor.graph, [node.id], kit, true), sources = nativeSourcesFor(model)!;
    expect(sources.bytes).toBeGreaterThan(0); expect(model.byteLength).toBeGreaterThan(sources.bytes); expect(() => JSON.stringify(model)).not.toThrow();
    const source = sources.get(model.nodes[0]!.motion!.artwork)!, original = JSON.stringify(source.node); editor.graph.updateNode(node.id, { fills: [fill('GRADIENT_DIAMOND', 1)] }); expect(JSON.stringify(source.node)).toBe(original);
    const portable = selectionToDesignModel(editor.graph, [node.id], kit); expect(nativeSourcesFor(portable)).toBeUndefined(); expect(portable.nodes[0]!.motion!.artwork).toBeUndefined();
  } finally { editor.dispose(); }
});
it('preserves float premultiplied stop colors and projects spring overshoot to ordered legal stops', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [fill('GRADIENT_LINEAR', 0)] }), a = state(node), b = structuredClone(a);
    a.paints[0]!.stops = [{ position: .2, color: [1, 0, 0, 0] }, { position: .4, color: [0, 0, 1, 1] }]; b.paints[0]!.stops = [{ position: .6, color: [0, 0, 1, 1] }, { position: .61, color: [1, 0, 0, 0] }];
    const tween = nativePaintTween(a, b)!; expect(tween(.5).paints[0]!.stops![0]!.color).toEqual([0, 0, 1, .5]); const stops = tween(2).paints[0]!.stops!; expect(stops[0]!.position).toBeLessThanOrEqual(stops[1]!.position); expect(() => tween(Infinity)).toThrow('finite');
    b.paints[0]!.stops!.push({ position: 1, color: [1, 1, 1, 1] }); expect(nativePaintTween(a, b)).toBeUndefined();
  } finally { editor.dispose(); }
});
const layer = (node: Parameters<typeof prototypeMotionMetadata>[0], artwork: string): SmartLayerSnapshot => ({ element: { children: [] } as unknown as HTMLElement, key: 'box', motion: { ...prototypeMotionMetadata(node, true), name: 'Box', artwork }, pose: { matrix: [1, 0, 0, 1, 0, 0], width: node.width, height: node.height, opacity: 1 } });
it.each(['MULTIPLY', 'SCREEN'] as const)('retains the original backdrop-dependent image crossfade for %s layers', blendMode => {
  const editor = createEditor();
  try { const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [fill('GRADIENT_RADIAL', 0)], blendMode }), sources = new PrototypePaintSources(kit); expect(sources.add(node)).toBeUndefined(); expect(sources.bytes).toBe(0); }
  finally { editor.dispose(); }
});
it('pins each capture of a reused variant node to its own native geometry instead of reusing an earlier capture by node ID', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [fill('GRADIENT_RADIAL', 0)] }), sources = new PrototypePaintSources(kit), first = sources.add(node)!;
    editor.graph.updateNode(node.id, { width: 80, cornerRadius: 12 }); const second = sources.add(node)!; expect(second).not.toBe(first); expect(sources.get(first)!.node.width).toBe(40); expect(sources.get(second)!.node.width).toBe(80); expect(sources.get(second)!.node.cornerRadius).toBe(12);
  } finally { editor.dispose(); }
});
it('admits all native paint pixels and stops before allocating surfaces', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 2048, height: 2048, fills: [fill('GRADIENT_RADIAL', 0)] }), sources = new PrototypePaintSources(kit), key = sources.add(node)!, snapshot = layer(node, key), allocate = vi.fn(), context = new NativePaintContext([sources], allocate);
    for (let index = 0; index < 4; index++) expect(context.plan(snapshot, snapshot)).toBeDefined(); expect(() => context.plan(snapshot, snapshot)).toThrow('16-megapixel'); expect(allocate).not.toHaveBeenCalled();
    const dense = fill('GRADIENT_LINEAR', 0); dense.gradientStops = Array.from({ length: 1024 }, (_, index) => ({ position: index / 1023, color: { r: 1, g: 0, b: 0, a: 1 } })); editor.graph.updateNode(node.id, { width: 40, height: 40, fills: Array.from({ length: 17 }, () => structuredClone(dense)) }); const next = layer(node, sources.add(node)!);
    expect(() => new NativePaintContext([sources], allocate).plan(next, next)).toThrow('16,384-stop'); expect(allocate).not.toHaveBeenCalled();
  } finally { editor.dispose(); }
});
it('attaches actual native paint, updates interruption state and frees both raster surfaces exactly once', () => {
  const editor = createEditor();
  try {
    const a = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [fill('GRADIENT_LINEAR', 0)] }), b = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 40, height: 40, fills: [fill('GRADIENT_LINEAR', 1)] }), sources = new PrototypePaintSources(kit), from = layer(a, sources.add(a)!), to = layer(b, sources.add(b)!);
    const canvas = { width: 0, height: 0, style: {}, setAttribute: vi.fn() }, attributes = new Map<string, string>(), paint = { replaceChildren: vi.fn(), setAttribute: (key: string, value: string) => attributes.set(key, value) } as unknown as HTMLElement;
    vi.stubGlobal('document', { createElement: () => canvas, addEventListener: vi.fn(), removeEventListener: vi.fn() }); let surface!: NonNullable<ReturnType<CanvasKit['MakeSurface']>>;
    const context = new NativePaintContext([sources], (kit, canvas) => surface = kit.MakeSurface(canvas.width, canvas.height)!), plan = context.plan(from, to)!, attached = plan.attach(paint), original = pixels(surface);
    attached.track.apply!(.5); const current = JSON.parse(attributes.get('data-xdesign-native-paint')!) as NativePaintState; expect(current.paints[0]!.transform).toEqual([.75, .125, 0, 1, .125, 0]); expect(pixels(surface)).not.toEqual(original); expect(paint.replaceChildren).toHaveBeenCalledWith(canvas);
    const close = vi.spyOn(surface, 'delete'); attached.dispose(); attached.dispose(); expect(close).toHaveBeenCalledOnce(); expect(() => attached.track.apply!(.6)).toThrow('closed');
  } finally { editor.dispose(); }
});

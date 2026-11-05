// @vitest-environment node
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { SkiaRenderer } from '@open-pencil/core/canvas';
import type { CanvasKit } from 'canvaskit-wasm';
import type { SceneNode } from '@open-pencil/scene-graph';
import { NativePaintContext, NativePaintRaster, PrototypePaintSources, nativePaintEligible, nativeSourcesFor, nodeNativePaintState } from './prototypeNativePaint';
import type { SmartLayerSnapshot } from './prototypeSmartSnapshot';
import { prototypeMotionMetadata } from './prototypeMotionMetadata';
import { selectionToDesignModel } from './reactExport';
import { serializeGraph } from './document';
import { renderDesignNodes } from './proceduralPaints';
vi.mock('@open-pencil/core/editor', async () => { const actual = await vi.importActual<typeof import('@open-pencil/core/editor')>('@open-pencil/core/editor'); return { ...actual, createEditor: vi.fn(actual.createEditor) }; });
let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const red = { r: 1, g: 0, b: 0, a: 1 }, blue = { r: 0, g: 0, b: 1, a: 1 };
it.each(['transform', 'stops'] as const)('retains the SDK export fallback for a gradient missing %s without authoring mutation or a native motion handle', missing => {
  const editor = createEditor(), oracle = new SkiaRenderer(kit, kit.MakeSurface(8, 8)!);
  try {
    const fill: SceneNode['fills'][number] = { type: 'GRADIENT_LINEAR', visible: true, opacity: 1, color: red, gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, gradientStops: [{ position: 0, color: red }, { position: 1, color: blue }] }; if (missing === 'transform') delete fill.gradientTransform; else delete fill.gradientStops;
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 8, height: 8, fills: [fill] }), before = serializeGraph(editor.graph), malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free'), model = selectionToDesignModel(editor.graph, [node.id], kit, true), allocated = malloc.mock.results.map(result => result.value);
    expect(nativePaintEligible(node)).toBe(false); expect(model.nodes[0]!.motion!.artwork).toBeUndefined(); expect(nativeSourcesFor(model)).toBeUndefined(); expect(serializeGraph(editor.graph)).toBe(before); expect(free.mock.calls.map(([value]) => value)).toEqual(expect.arrayContaining(allocated)); expect(free.mock.calls).toHaveLength(allocated.length);
    const expected = renderDesignNodes(kit, oracle, editor.graph, editor.state.currentPageId, [node.id], { format: 'PNG', scale: 2 })!, actual = new Uint8Array(Buffer.from(model.nodes[0]!.image!.split(',')[1]!, 'base64')); expect(actual).toEqual(expected);
  } finally { oracle.destroy(); editor.dispose(); }
});
it('renders a clipped frame own stroke outside its content box with exact native export pixels', () => {
  const editor = createEditor(), oracle = new SkiaRenderer(kit, kit.MakeSurface(48, 48)!); let raster: NativePaintRaster | undefined;
  try {
    const node = editor.graph.createNode('FRAME', editor.state.currentPageId, { width: 40, height: 40, clipsContent: true, cornerRadius: 6, fills: [{ type: 'SOLID', visible: true, opacity: 1, color: red }], strokes: [{ visible: true, align: 'OUTSIDE', weight: 4, opacity: 1, color: blue }] }); expect(nativePaintEligible(node)).toBe(true);
    raster = new NativePaintRaster(kit, kit.MakeSurface(48, 48)!, node, 48, 48); raster.draw(nodeNativePaintState(node)); const image = raster.surface.makeImageSnapshot(), bytes = renderDesignNodes(kit, oracle, editor.graph, editor.state.currentPageId, [node.id], { format: 'PNG', scale: 1 })!, expected = kit.MakeImageFromEncoded(bytes)!;
    try { const info = { width: 48, height: 48, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB }; expect([...image.readPixels(0, 0, info)!]).toEqual([...expected.readPixels(0, 0, info)!]); } finally { image.delete(); expected.delete(); }
  } finally { raster?.dispose(); oracle.destroy(); editor.dispose(); }
});
it('disposes the supplied display if private editor initialization fails before native allocation', () => {
  const editor = createEditor();
  try { const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 8, height: 8 }), surface = kit.MakeSurface(8, 8)!, close = vi.spyOn(surface, 'dispose'), malloc = vi.spyOn(kit, 'Malloc'); vi.mocked(createEditor).mockImplementationOnce(() => { throw new Error('editor failed'); }); expect(() => new NativePaintRaster(kit, surface, node, 8, 8)).toThrow('editor failed'); expect(close).toHaveBeenCalledOnce(); expect(malloc).not.toHaveBeenCalled(); }
  finally { editor.dispose(); }
});
it('releases the legacy export renderer buffer when its native surface allocation fails', () => {
  const editor = createEditor();
  try {
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { width: 8, height: 8, fills: [{ type: 'GRADIENT_LINEAR', visible: true, opacity: 1, color: red }] }), before = serializeGraph(editor.graph), malloc = vi.spyOn(kit, 'Malloc'), free = vi.spyOn(kit, 'Free'); vi.spyOn(kit, 'MakeRasterDirectSurface').mockReturnValueOnce(null);
    expect(() => selectionToDesignModel(editor.graph, [node.id], kit)).toThrow('native renderer surface'); expect(free.mock.calls.map(([value]) => value)).toEqual(malloc.mock.results.map(result => result.value)); expect(serializeGraph(editor.graph)).toBe(before);
  } finally { editor.dispose(); }
});
const layer = (node: SceneNode, artwork: string): SmartLayerSnapshot => ({ element: { children: [] } as unknown as HTMLElement, key: 'box', motion: { ...prototypeMotionMetadata(node, true), name: 'Box', artwork }, pose: { matrix: [1, 0, 0, 1, 0, 0], width: node.width, height: node.height, opacity: 1 } });
it.each([false, true])('keeps numeric content/scroll/fixed clip radii aligned with resized own paint and preserves control changes (interrupted=%s)', interrupted => {
  const editor = createEditor();
  class Clip { style = { borderRadius: 'inherit' }; constructor(private name: string) {} hasAttribute(name: string) { return name === this.name; } }
  vi.stubGlobal('HTMLElement', Clip); vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, style: {}, setAttribute: vi.fn() }), addEventListener: vi.fn(), removeEventListener: vi.fn() }); vi.stubGlobal('getComputedStyle', () => ({ opacity: '1' }));
  try {
    const properties = { clipsContent: true, fills: [{ type: 'SOLID' as const, visible: true, opacity: 1, color: red }], strokes: [{ visible: true, align: 'OUTSIDE' as const, weight: 2, opacity: 1, color: blue }] }, a = editor.graph.createNode('FRAME', editor.state.currentPageId, { ...properties, width: 40, height: 20, cornerRadius: 4 }), b = editor.graph.createNode('FRAME', editor.state.currentPageId, { ...properties, width: 80, height: 60, cornerRadius: 8 }), sources = new PrototypePaintSources(kit), from = layer(a, sources.add(a)!), to = layer(b, sources.add(b)!), clips = ['data-xdesign-content-clip', 'data-xdesign-scroll', 'data-xdesign-fixed'].map(name => new Clip(name));
    to.element = { children: clips } as unknown as HTMLElement; const attributes = new Map<string, string>(), paint = { replaceChildren: vi.fn(), setAttribute: (key: string, value: string) => attributes.set(key, value) } as unknown as HTMLElement, context = new NativePaintContext([sources], (kit, canvas) => kit.MakeSurface(canvas.width, canvas.height)), first = context.plan(from, to)!.attach(paint);
    expect(clips[0]!.style.borderRadius).toBe('8px 8px 8px 8px / 12px 12px 12px 12px'); first.track.apply!(.5); expect(clips[1]!.style.borderRadius).toBe('8px 8px 8px 8px / 9px 9px 9px 9px');
    if (interrupted) {
      class Proxy extends Clip { getAttribute(name: string) { return attributes.get(name) ?? null; } } const proxy = new Proxy('data-xdesign-motion-paint'); to.element = { children: [proxy] } as unknown as HTMLElement;
      const c = editor.graph.createNode('FRAME', editor.state.currentPageId, { ...properties, width: 100, height: 80, cornerRadius: 10 }), next = layer(c, sources.add(c)!), boundary = new Clip('data-xdesign-content-clip'); next.element = { children: [boundary] } as unknown as HTMLElement;
      const second = new NativePaintContext([sources], (kit, canvas) => kit.MakeSurface(canvas.width, canvas.height)).plan(to, next)!.attach(paint); expect(boundary.style.borderRadius).toBe('10px 10px 10px 10px / 12px 12px 12px 12px'); second.dispose(); expect(boundary.style.borderRadius).toBe('inherit');
    }
    clips[2]!.style.borderRadius = '3px'; first.dispose(); expect(clips[0]!.style.borderRadius).toBe('inherit'); expect(clips[1]!.style.borderRadius).toBe('inherit'); expect(clips[2]!.style.borderRadius).toBe('3px');
  } finally { editor.dispose(); }
});

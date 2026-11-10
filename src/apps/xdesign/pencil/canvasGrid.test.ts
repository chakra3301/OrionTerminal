// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type Editor } from "@open-pencil/core/editor";
import { SkiaRenderer } from "@open-pencil/core/canvas";
import { getCanvasKit } from "@open-pencil/core/canvaskit";
import { renderNodesToImage } from "@open-pencil/core/io";
import type { CanvasKit, Image } from "canvaskit-wasm";
import { installCanvasGrid } from "./canvasGrid";
import { createNativeRenderer, destroyNativeRenderer } from "./nativeRendererLifecycle";
import { serializeGraph } from "./document";

let ck: CanvasKit, editor: Editor, renderer: SkiaRenderer, restore: () => void, background: string;
const pixel = (image: Image, x: number, y: number) => [...image.readPixels(x, y, {
  width: 1, height: 1, alphaType: ck.AlphaType.Unpremul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB,
})!];
const viewportPixel = (x: number, y: number) => {
  const image = renderer.surface.makeImageSnapshot();
  try { return pixel(image, x, y); } finally { image.delete(); }
};
const render = () => renderer.renderFromEditorState(editor.state, editor.graph, editor.textEditor, 160, 160, false);
beforeAll(async () => { ck = await getCanvasKit(); });
beforeEach(() => {
  background = "#1e1e1e";
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => background }));
  editor = createEditor();
  restore = installCanvasGrid(editor, {} as HTMLElement);
  renderer = new SkiaRenderer(ck, ck.MakeSurface(160, 160)!);
  editor.setCanvasKit(ck, renderer);
  expect(renderer.drawNodeStroke).not.toBe(SkiaRenderer.prototype.drawNodeStroke);
});
afterEach(() => { renderer.destroy(); restore(); editor.dispose(); vi.unstubAllGlobals(); });

describe("workspace grid on the actual Skia viewport", () => {
  it("paints the original dark 40-pixel grid and retains it through pan and zoom", () => {
    const savedColor = { ...editor.state.pageColor };
    render();
    expect(viewportPixel(20, 20)).toEqual([30, 30, 30, 255]);
    expect(viewportPixel(40, 20)[0]).toBeGreaterThan(30);
    const line = viewportPixel(40, 20);
    editor.state.panX = 17; editor.state.panY = 29; editor.state.zoom = 2;
    render();
    expect(viewportPixel(40, 20)).toEqual(line);
    expect(editor.state.pageColor).toEqual(savedColor);
    expect(renderer.pageColor).toEqual(savedColor);
  });
  it("paints the grid underneath artwork and leaves transparent raster exports clean", () => {
    const node = editor.graph.createNode("RECTANGLE", editor.state.currentPageId, { x: 20, y: 20, width: 80, height: 80,
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, opacity: .5, visible: true }],
    });
    render();
    expect(viewportPixel(40, 40)[0]).toBeGreaterThan(128);
    const bytes = renderNodesToImage(ck, renderer, editor.graph, editor.state.currentPageId, [node.id], { format: "PNG", scale: 1 })!;
    const image = ck.MakeImageFromEncoded(bytes)!;
    try {
      expect(pixel(image, 20, 20)).toEqual([255, 0, 0, 128]);
      expect(pixel(image, 21, 21)).toEqual(pixel(image, 20, 20));
    } finally { image.delete(); }
    editor.graph.updateNode(node.id, { fills: [{ ...node.fills[0]!, opacity: 1 }] });
    render();
    expect(viewportPixel(40, 40)).toEqual([255, 0, 0, 255]);
  });
  it("adapts to a light theme and is reinstalled when the renderer is recreated", () => {
    renderer.destroy();
    expect(renderer.drawNodeStroke).toBe(SkiaRenderer.prototype.drawNodeStroke);
    renderer = new SkiaRenderer(ck, ck.MakeSurface(160, 160)!);
    editor.setCanvasKit(ck, renderer);
    expect(renderer.drawNodeStroke).not.toBe(SkiaRenderer.prototype.drawNodeStroke);
    background = "#eeeeee"; render();
    expect(viewportPixel(20, 20)).toEqual([238, 238, 238, 255]);
    expect(viewportPixel(40, 20)[0]).toBeLessThan(238);
    restore();
    expect(renderer.drawNodeStroke).toBe(SkiaRenderer.prototype.drawNodeStroke);
    render();
    expect(viewportPixel(40, 20)).toEqual(viewportPixel(20, 20));
  });
  it("restores the native clear even when presentation throws", () => {
    const getCanvas = renderer.surface.getCanvas;
    const failure = vi.spyOn(renderer, "syncFontGeneration").mockImplementationOnce(() => { throw new Error("lost surface"); });
    expect(render).toThrow("lost surface");
    expect(renderer.surface.getCanvas).toBe(getCanvas);
    failure.mockRestore(); render();
    expect(viewportPixel(40, 20)[0]).toBeGreaterThan(30);
  });
});

function viewportOpacityFixture() {
  const solid = (r: number, g: number, b: number) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r, g, b, a: 1 } });
  const root = editor.graph.createNode('FRAME', editor.state.currentPageId, { name: 'Viewport opacity scene', x: 20, y: 20, width: 64, height: 48, fills: [solid(1, 1, 1)], clipsContent: true });
  const group = editor.graph.createNode('FRAME', root.id, { x: 4, y: 8, width: 24, height: 20, flipX: true, opacity: .75, fills: [solid(0, 0, 1)], clipsContent: true });
  const inner = editor.graph.createNode('FRAME', group.id, { x: 6, y: 4, width: 12, height: 8, rotation: 90, opacity: .5, fills: [solid(1, 0, 0)], clipsContent: true });
  editor.graph.createNode('RECTANGLE', inner.id, { x: 2, y: 2, width: 4, height: 2, fills: [solid(0, 1, 0)] });
  editor.graph.createNode('RECTANGLE', root.id, { name: 'Authored later foreground', x: 12, y: 14, width: 10, height: 6, fills: [solid(1, 1, 0)] });
  return root;
}
function expectViewportOpacity(zoom = 1, panX = 0, panY = 0) {
  for (const [x, y, expected] of [[22, 22, [255, 255, 255, 255]], [25, 29, [64, 64, 255, 255]], [33, 31, [160, 64, 159, 255]], [35, 33, [64, 160, 159, 255]], [35, 35, [255, 255, 0, 255]]] as const) {
    const actual = viewportPixel(x * zoom + panX, y * zoom + panY);
    for (let channel = 0; channel < 4; channel++) expect(Math.abs(actual[channel]! - expected[channel]!), `viewport${x},${y} zoom${zoom} RGBA${actual}`).toBeLessThanOrEqual(1);
  }
}
it('keeps live and retained viewport opacity, reflection, rotation and authored foreground order over the original workspace grid', () => {
  viewportOpacityFixture(); const source = serializeGraph(editor.graph), original = SkiaRenderer.prototype.renderNode;
  expect(renderer.renderNode).not.toBe(original);
  render(); expectViewportOpacity(); expect(viewportPixel(100, 100)).toEqual([30, 30, 30, 255]); expect(viewportPixel(120, 100)[0]).toBeGreaterThan(30);
  render(); expectViewportOpacity();
  editor.state.panX = 7; editor.state.panY = 11; editor.state.zoom = 2; render(); expectViewportOpacity(2, 7, 11);
  expect(serializeGraph(editor.graph)).toBe(source);
});
it('reinstalls live opacity compatibility on renderer recreation and restores each renderer exactly once', () => {
  viewportOpacityFixture(); const original = SkiaRenderer.prototype.renderNode, first = renderer, firstWrapper = renderer.renderNode;
  render(); expectViewportOpacity(); first.destroy(); expect(first.renderNode).toBe(original); expect(Object.hasOwn(first, 'renderNode')).toBe(false);
  renderer = new SkiaRenderer(ck, ck.MakeSurface(160, 160)!); editor.setCanvasKit(ck, renderer);
  expect(renderer.renderNode).not.toBe(original); expect(renderer.renderNode).not.toBe(firstWrapper); render(); expectViewportOpacity();
  restore(); restore(); expect(renderer.renderNode).toBe(original); expect(Object.hasOwn(renderer, 'renderNode')).toBe(false);
});
it('leaves an already-owned opacity installation active after grid attach and repeated detach', () => {
  renderer.destroy(); renderer = createNativeRenderer(ck, ck.MakeSurface(160, 160)!); const owned = renderer.renderNode, original = SkiaRenderer.prototype.renderNode;
  try {
    expect(owned).not.toBe(original); editor.setCanvasKit(ck, renderer); expect(renderer.renderNode).toBe(owned);
    viewportOpacityFixture(); render(); expectViewportOpacity(); restore(); restore();
    expect(renderer.renderNode).toBe(owned); destroyNativeRenderer(renderer); expect(renderer.renderNode).toBe(original); expect(Object.hasOwn(renderer, 'renderNode')).toBe(false);
  } finally { destroyNativeRenderer(renderer); }
});

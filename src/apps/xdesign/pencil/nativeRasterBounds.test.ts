// @vitest-environment node
import { afterEach, beforeAll, expect, it } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { computeContentBounds, renderNodesToImage } from '@open-pencil/core/io';
import { getNodeLocalMatrix, getWorldMatrix, TransformMatrix } from '@open-pencil/scene-graph';
import type { CanvasKit, Surface } from 'canvaskit-wasm';
import { createNativeRenderer, destroyNativeRenderer } from './nativeRendererLifecycle';
import { expandRasterBounds, withRasterBoundsPadding } from './nativeRasterBounds';

let kit: CanvasKit;
const cleanups: Array<() => void> = [];
beforeAll(async () => { kit = await getCanvasKit(); });
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function pixels(surface: Surface, width: number, height: number) {
  const image = surface.makeImageSnapshot();
  try {
    const data = image.readPixels(0, 0, { width, height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB });
    if (!data) throw new Error('CanvasKit did not return raster pixels.');
    return new Uint8Array(data);
  } finally { image.delete(); }
}

function decoded(bytes: Uint8Array, width: number, height: number) {
  const image = kit.MakeImageFromEncoded(bytes)!;
  try {
    expect([image.width(), image.height()]).toEqual([width, height]);
    const data = image.readPixels(0, 0, { width, height, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Premul, colorSpace: kit.ColorSpace.SRGB });
    if (!data) throw new Error('CanvasKit could not decode raster export.');
    return new Uint8Array(data);
  } finally { image.delete(); }
}

function makeLine(cap: 'SQUARE' | 'ROUND', parent = false) {
  const editor = createEditor();
  const pageId = editor.state.currentPageId;
  let parentId = pageId;
  if (parent) parentId = editor.graph.createNode('FRAME', pageId, { x: 7, y: 9, width: 36, height: 35, rotation: 17, clipsContent: false, fills: [], strokes: [] }).id;
  const line = editor.graph.createNode('LINE', parentId, { x: 3, y: 4, width: 24, height: 21, fills: [], strokes: [{ color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, weight: 8, align: 'CENTER', cap }], strokeCap: cap });
  return { editor, pageId, line };
}

function rendererFor() {
  const surface = kit.MakeSurface(128, 128)!;
  const renderer = createNativeRenderer(kit, surface);
  cleanups.push(() => destroyNativeRenderer(renderer));
  return renderer;
}

function directSurface(width: number, height: number) {
  const data = kit.Malloc(Uint8Array, width * height * 4), surface = kit.MakeRasterDirectSurface({ width, height, alphaType: kit.AlphaType.Premul, colorType: kit.ColorType.RGBA_8888, colorSpace: kit.ColorSpace.SRGB }, data, width * 4)!;
  return { surface, close: () => { surface.delete(); kit.Free(data); } };
}

it.each([{ cap: 'ROUND' as const, parent: false }, { cap: 'SQUARE' as const, parent: false }, { cap: 'SQUARE' as const, parent: true }])('direct raster output preserves diagonal $cap caps against an independent CanvasKit line (parent=$parent)', ({ cap, parent }) => {
  const { editor, pageId, line } = makeLine(cap, parent), selected = parent ? line.parentId! : line.id;
  cleanups.push(() => editor.dispose());
  const before = JSON.stringify([...editor.graph.nodes.values()]);
  const renderer = rendererFor(), base = computeContentBounds(editor.graph, [selected])!;
  const expanded = expandRasterBounds(editor.graph, [selected], base);
  const encoded = withRasterBoundsPadding(editor.graph, pageId, [selected], base, expanded, ids => renderNodesToImage(kit, renderer, editor.graph, pageId, ids, { format: 'PNG', scale: 1 })!);
  const width = Math.ceil(expanded.maxX - expanded.minX), height = Math.ceil(expanded.maxY - expanded.minY);
  const actual = decoded(encoded, width, height);

  const low = directSurface(width, height), high = directSurface(width * 2, height * 2), reference = low.surface, supersampled = high.surface;
  try {
    const canvas = supersampled.getCanvas(), paint = new kit.Paint();
    try {
      canvas.clear(kit.TRANSPARENT); canvas.scale(2, 2);
      canvas.translate(-expanded.minX, -expanded.minY);
      if (parent) { const frame = editor.graph.getNode(line.parentId!)!; canvas.translate(frame.x, frame.y); canvas.concat(getNodeLocalMatrix(frame, { x: 0, y: 0 })); }
      canvas.translate(line.x, line.y); paint.setAntiAlias(true); paint.setStyle(kit.PaintStyle.Stroke); paint.setStrokeWidth(8); paint.setStrokeCap(cap === 'SQUARE' ? kit.StrokeCap.Square : kit.StrokeCap.Round); paint.setColor(kit.RED); canvas.drawLine(0, 0, line.width, line.height, paint); supersampled.flush();
      const image = supersampled.makeImageSnapshot();
      try { const low = reference.getCanvas(); low.clear(kit.TRANSPARENT); low.drawImageRectOptions(image, kit.LTRBRect(0, 0, width * 2, height * 2), kit.LTRBRect(0, 0, width, height), kit.FilterMode.Linear, kit.MipmapMode.None, null); reference.flush(); }
      finally { image.delete(); }
      const expected = pixels(reference, width, height);
      expect(expected.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
      if (parent) { let max = 0; for (let i = 0; i < actual.length; i++) max = Math.max(max, Math.abs(actual[i]! - expected[i]!)); expect(max).toBeLessThanOrEqual(2); }
      else expect(actual).toEqual(expected);
    } finally { paint.delete(); }
  } finally { low.close(); high.close(); }
  expect(JSON.stringify([...editor.graph.nodes.values()])).toBe(before);
});

it('expands through rotated parent transforms and leaves private padding out of graph serialization, including render failure', () => {
  const { editor, pageId, line } = makeLine('SQUARE', true);
  cleanups.push(() => editor.dispose());
  const base = computeContentBounds(editor.graph, [line.parentId!])!;
  const expanded = expandRasterBounds(editor.graph, [line.parentId!], base);
  expect(expanded.minX).toBeLessThanOrEqual(base.minX);
  expect(expanded.minY).toBeLessThanOrEqual(base.minY);
  expect(expanded.maxX).toBeGreaterThanOrEqual(base.maxX);
  expect(expanded.maxY).toBeGreaterThanOrEqual(base.maxY);
  const matrix = getWorldMatrix(line, editor.graph), origin = TransformMatrix.mapPoint(matrix, { x: 0, y: 0 });
  expect(origin.x).not.toBe(line.x);

  const before = JSON.stringify([...editor.graph.nodes.values()]);
  expect(() => withRasterBoundsPadding(editor.graph, pageId, [line.parentId!], base, expanded, ids => {
    expect(ids).toHaveLength(2);
    expect(computeContentBounds(editor.graph, ids)).toMatchObject({ minX: expanded.minX, minY: expanded.minY, maxX: expanded.maxX, maxY: expanded.maxY });
    throw new Error('simulated image encoder failure');
  })).toThrow('simulated image encoder failure');
  expect(JSON.stringify([...editor.graph.nodes.values()])).toBe(before);
});

it('adds no crop padding for a round cap while square diagonal endpoints need more bounds', () => {
  const square = makeLine('SQUARE'), round = makeLine('ROUND');
  cleanups.push(() => square.editor.dispose(), () => round.editor.dispose());
  const squareBase = computeContentBounds(square.editor.graph, [square.line.id])!, roundBase = computeContentBounds(round.editor.graph, [round.line.id])!;
  const squareExpanded = expandRasterBounds(square.editor.graph, [square.line.id], squareBase), roundExpanded = expandRasterBounds(round.editor.graph, [round.line.id], roundBase);
  expect(squareExpanded.minX).toBeLessThan(roundExpanded.minX);
  expect(squareExpanded.maxY).toBeGreaterThan(roundExpanded.maxY);
  expect(roundExpanded).toEqual(roundBase);
});

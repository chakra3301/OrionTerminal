// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import type { CanvasKit, Image } from 'canvaskit-wasm';
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { nativeMaskPath, nativeMaskAlphaPath } from './nativeMaskPath';
import * as maskPathModule from './nativeMaskPath';
import { renderNativeSceneImage } from './nativeSceneArtwork';
import { serializeGraph } from './graphDocument';

let kit: CanvasKit;
beforeAll(async () => { kit = await getCanvasKit(); });
afterAll(() => { vi.restoreAllMocks(); });

const white = { type: 'SOLID' as const, visible: true, opacity: 1, color: { r: 1, g: 1, b: 1, a: 1 } };
const solid = (value: number) => ({ type: 'SOLID' as const, visible: true, opacity: 1, color: { r: value, g: value, b: value, a: 1 } });

function scene(graph: SceneGraph, maskType: SceneNode['maskType'] = 'ALPHA', width = 128, height = 96) {
  const root = graph.createNode('FRAME', graph.getPages()[0]!.id, { name: 'Local scene', width, height, fills: [] });
  graph.createNode('ELLIPSE', root.id, { name: 'Rotated soft mask', x: width * .2, y: height * .2, width: width * .5, height: height * .5, rotation: 23, flipX: true, opacity: .73, isMask: true, maskType, fills: [maskType === 'LUMINANCE' ? solid(.76) : white] });
  if (maskType === 'ALPHA') graph.createNode('RECTANGLE', root.id, { name: 'Nested chain mask', x: width * .27, y: height * .19, width: width * .44, height: height * .55, rotation: -11, flipY: true, opacity: .82, isMask: true, maskType: 'LUMINANCE', fills: [solid(.68)] });
  graph.createNode('RECTANGLE', root.id, { name: 'Opaque scene cover', x: 0, y: 0, width, height, fills: [white] });
  return root;
}

function decodedPixels(bytes: Uint8Array) {
  const image = kit.MakeImageFromEncoded(bytes);
  if (!image) throw new Error('Unable to decode native scene PNG.');
  try {
    const data = image.readPixels(0, 0, { width: image.width(), height: image.height(), colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB });
    if (!data) throw new Error('Unable to read native scene reference pixels.');
    return { width: image.width(), height: image.height(), pixels: new Uint8Array(data) };
  } finally { image.delete(); }
}

function expectAllFreed(allocations: { mock: { results: { value: unknown }[] } }, releases: { mock: { calls: unknown[][] } }) {
  const freed = releases.mock.calls.map(call => call[0]);
  expect(allocations.mock.results.every(result => freed.includes(result.value))).toBe(true);
}

it.each(['ALPHA', 'LUMINANCE', 'VECTOR'] as const)('matches the displayed native PNG hit alpha exactly for a transformed %s mask region', maskType => {
  const editor = createEditor();
  try {
    const root = scene(editor.graph, maskType), before = serializeGraph(editor.graph);
    const artwork = renderNativeSceneImage(kit, editor.graph, root, true), region = artwork.maskRegions.get(root.id)![0]!;
    const pixels = decodedPixels(artwork.bytes);
    const expected = nativeMaskPath(pixels.pixels, pixels.width, pixels.height, artwork.scale, artwork.bounds.minX, artwork.bounds.minY);
    expect(pixels.width).toBe(root.width * artwork.scale);
    expect(pixels.height).toBe(root.height * artwork.scale);
    expect(pixels.pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(new Set(Array.from(pixels.pixels).filter((_, index) => index % 4 === 3)).size).toBeGreaterThan(8);
    expect(region.children).toHaveLength(1);
    expect(region.path).toBe(expected);
    const alpha = Uint8Array.from({ length: pixels.width * pixels.height }, (_, index) => pixels.pixels[index * 4 + 3]!);
    expect(nativeMaskAlphaPath(alpha, pixels.width, pixels.height, artwork.scale, artwork.bounds.minX, artwork.bounds.minY)).toBe(expected);
    expect(serializeGraph(editor.graph)).toBe(before);
  } finally { editor.dispose(); }
});

it('uses one Alpha_8 destination readback for a large region, skips hit-only PNG encoding, and frees every temporary buffer', () => {
  const editor = createEditor();
  try {
    const root = scene(editor.graph, 'VECTOR', 1024, 768), before = serializeGraph(editor.graph), baseline = renderNativeSceneImage(kit, editor.graph, root, true);
    const seed = kit.MakeImageFromEncoded(baseline.bytes)!;
    const prototype = Object.getPrototypeOf(seed) as Image;
    seed.delete();
    const readPixels = vi.spyOn(prototype, 'readPixels');
    const encode = vi.spyOn(prototype, 'encodeToBytes');
    const allocations = vi.spyOn(kit, 'Malloc');
    const releases = vi.spyOn(kit, 'Free');
    let actual: ReturnType<typeof renderNativeSceneImage>;
    try {
      actual = renderNativeSceneImage(kit, editor.graph, root, true);
      const imageCalls = readPixels.mock.calls;
      expect(imageCalls).toHaveLength(1);
      expect(imageCalls[0]![2].colorType).toBe(kit.ColorType.Alpha_8);
      expect(imageCalls[0]![3]).toBeDefined();
      expect(imageCalls[0]![4]).toBe(actual!.width);
      expect(imageCalls.every(call => call[2].colorType !== kit.ColorType.RGBA_8888)).toBe(true);
      const alphaIndex = allocations.mock.results.findIndex(result => result.value === imageCalls[0]![3]);
      expect(alphaIndex).toBeGreaterThanOrEqual(0);
      expect(allocations.mock.calls[alphaIndex]![0]).toBe(Uint8Array);
      expect(allocations.mock.calls[alphaIndex]![1]).toBe(actual!.width * actual!.height);
      expect(encode).toHaveBeenCalledTimes(2);
      expectAllFreed(allocations, releases);
    } finally { encode.mockRestore(); readPixels.mockRestore(); allocations.mockRestore(); releases.mockRestore(); }
    expect(actual!.bytes).toEqual(baseline.bytes);
    expect(actual!.maskRegions.get(root.id)?.[0]?.path).toBe(baseline.maskRegions.get(root.id)?.[0]?.path);
    expect(serializeGraph(editor.graph)).toBe(before);
  } finally { editor.dispose(); }
}, 30_000);

it.each(['read', 'path'] as const)('releases alpha/readback and renderer resources after hit capture %s failure, then retries exactly', mode => {
  const editor = createEditor();
  try {
    const root = scene(editor.graph), before = serializeGraph(editor.graph), expected = renderNativeSceneImage(kit, editor.graph, root, true);
    const seed = kit.MakeImageFromEncoded(expected.bytes)!;
    const prototype = Object.getPrototypeOf(seed) as Image;
    seed.delete();
    const allocations = vi.spyOn(kit, 'Malloc');
    const releases = vi.spyOn(kit, 'Free');
    const originalReadPixels = prototype.readPixels;
    const readPixels = vi.spyOn(prototype, 'readPixels');
    const path = vi.spyOn(maskPathModule, 'nativeMaskAlphaPath');
    const failure = new Error(`injected ${mode} failure`);
    if (mode === 'read') readPixels.mockImplementation(function (this: Image, x, y, info, destination, bytesPerRow) {
      if (info.colorType === kit.ColorType.Alpha_8) return null;
      return originalReadPixels!.call(this, x, y, info, destination, bytesPerRow);
    });
    else path.mockImplementation(() => { throw failure; });
    try { expect(() => renderNativeSceneImage(kit, editor.graph, root, true)).toThrow(mode === 'path' ? failure : /mask hit-region|alpha/i); }
    finally {
      try { expectAllFreed(allocations, releases); }
      finally { path.mockRestore(); readPixels.mockRestore(); allocations.mockRestore(); releases.mockRestore(); }
    }
    const retry = renderNativeSceneImage(kit, editor.graph, root, true);
    expect(retry.bytes).toEqual(expected.bytes);
    expect(retry.maskRegions.get(root.id)?.[0]?.path).toBe(expected.maskRegions.get(root.id)?.[0]?.path);
    expect(serializeGraph(editor.graph)).toBe(before);
  } finally { editor.dispose(); }
});

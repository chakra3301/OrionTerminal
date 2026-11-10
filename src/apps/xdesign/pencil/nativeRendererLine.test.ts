// @vitest-environment node
import { afterEach, beforeAll, expect, it } from 'vitest';
import { SkiaRenderer } from '@open-pencil/core/canvas';
import { createEditor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import type { CanvasKit, Surface } from 'canvaskit-wasm';
import { installNativeLineStroke } from './nativeRendererLine';

let kit: CanvasKit;
const owned: Array<() => void> = [];
beforeAll(async () => { kit = await getCanvasKit(); });
afterEach(() => { while (owned.length) owned.pop()!(); });

function rgba(surface: Surface) {
  const image = surface.makeImageSnapshot();
  try {
    const pixels = image.readPixels(0, 0, { width: 32, height: 32, colorType: kit.ColorType.RGBA_8888, alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB });
    if (!pixels) throw new Error('CanvasKit did not return line pixels.');
    return new Uint8Array(pixels);
  } finally { image.delete(); }
}

function render(cap: 'ROUND' | 'SQUARE', patched: boolean) {
  const editor = createEditor(), surface = kit.MakeSurface(32, 32)!, renderer = new SkiaRenderer(kit, surface);
  owned.push(() => { renderer.destroy(); editor.dispose(); });
  const node = editor.graph.createNode('LINE', editor.state.currentPageId, { width: 20, height: 20, fills: [], strokes: [{ color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, weight: 6, align: 'CENTER', cap }], strokeCap: cap });
  if (patched) owned.push(installNativeLineStroke(renderer));
  const canvas = surface.getCanvas(); canvas.clear(kit.TRANSPARENT); canvas.translate(6, 6);
  renderer.strokePaint.setAntiAlias(true); renderer.strokePaint.setStyle(kit.PaintStyle.Stroke); renderer.strokePaint.setStrokeWidth(6); renderer.strokePaint.setStrokeCap(cap === 'ROUND' ? kit.StrokeCap.Round : kit.StrokeCap.Square); renderer.strokePaint.setColor(kit.RED);
  renderer.drawNodeStroke(canvas, node, kit.LTRBRect(0, 0, node.width, node.height), false);
  surface.flush();
  return rgba(surface);
}

it.each(['ROUND', 'SQUARE'] as const)('draws centered diagonal %s line pixels equal to independent CanvasKit drawLine', cap => {
  const actual = render(cap, true), surface = kit.MakeSurface(32, 32)!;
  try {
    const canvas = surface.getCanvas(), paint = new kit.Paint();
    try {
      canvas.clear(kit.TRANSPARENT); canvas.translate(6, 6); paint.setAntiAlias(true); paint.setStyle(kit.PaintStyle.Stroke); paint.setStrokeWidth(6); paint.setStrokeCap(cap === 'ROUND' ? kit.StrokeCap.Round : kit.StrokeCap.Square); paint.setColor(kit.RED); canvas.drawLine(0, 0, 20, 20, paint); surface.flush();
      const expected = rgba(surface);
      expect(expected.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
      expect(actual).toEqual(expected);
    } finally { paint.delete(); }
  } finally { surface.delete(); }
});

it('keeps round and square diagonal endpoint pixels distinct and restores the renderer method idempotently', () => {
  const round = render('ROUND', true), square = render('SQUARE', true);
  expect(round).not.toEqual(square);

  const editor = createEditor(), renderer = new SkiaRenderer(kit, kit.MakeSurface(8, 8)!);
  owned.push(() => { renderer.destroy(); editor.dispose(); });
  const original = renderer.drawNodeStroke, restore = installNativeLineStroke(renderer);
  expect(renderer.drawNodeStroke).not.toBe(original);
  expect(installNativeLineStroke(renderer)).toBe(restore);
  restore(); restore();
  expect(renderer.drawNodeStroke).toBe(original);
});

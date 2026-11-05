// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createEditor, type Editor } from "@open-pencil/core/editor";
import { SkiaRenderer } from "@open-pencil/core/canvas";
import { getCanvasKit } from "@open-pencil/core/canvaskit";
import { parseFigFile, renderNodesToImage, renderThumbnail } from "@open-pencil/core/io";
import type { CanvasKit, Image } from "canvaskit-wasm";
import type { Fill, GradientTransform } from "@open-pencil/scene-graph";
import { deserializeGraph, serializeGraph } from "./document";
import { convertFigImageModes, exportFigImageCompatible } from "./figPaintCompatibility";
import { centerPaint, flipPaint, initialImageTransform, paintAngle, paintCenter, rotatePaint, sizePaintAxis, validPaintTransform } from "./fillGeometry";

let ck: CanvasKit, editor: Editor, renderer: SkiaRenderer;
beforeAll(async () => { ck = await getCanvasKit(); });
beforeEach(() => { editor = createEditor(); renderer = new SkiaRenderer(ck, ck.MakeSurface(100, 100)!); editor.setCanvasKit(ck, renderer); });
afterEach(() => { renderer.destroy(); editor.dispose(); });
const pixel = (image: Image, x: number, y: number) => [...image.readPixels(x, y, { width: 1, height: 1, alphaType: ck.AlphaType.Unpremul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB })!];
const matrix: GradientTransform = { m00: 1.7, m01: .4, m02: -.2, m10: .6, m11: .8, m12: .3 };
const color = { r: 0, g: 0, b: 0, a: 1 };
function sourceImage() {
  const surface = ck.MakeSurface(40, 20)!, canvas = surface.getCanvas(), paint = new ck.Paint();
  paint.setColor(ck.Color(255, 0, 0, 1)); canvas.drawRect(ck.LTRBRect(0, 0, 20, 20), paint);
  paint.setColor(ck.Color(0, 0, 255, 1)); canvas.drawRect(ck.LTRBRect(20, 0, 40, 20), paint); paint.delete();
  const image = surface.makeImageSnapshot(); try { return image.encodeToBytes()!; } finally { image.delete(); surface.delete(); }
}
function renderFill(fill: Fill, width = 40, height = 40) {
  const node = editor.graph.createNode("RECTANGLE", editor.state.currentPageId, { width, height, fills: [fill] });
  const bytes = renderNodesToImage(ck, renderer, editor.graph, editor.state.currentPageId, [node.id], { format: "PNG", scale: 1 })!;
  return { node, image: ck.MakeImageFromEncoded(bytes)! };
}

describe("affine fill geometry through the installed design renderer", () => {
  it("rotates imported scale and skew around its existing center and preserves handedness", () => {
    const rotated = rotatePaint(matrix, 90);
    expect(paintAngle(rotated)).toBeCloseTo(90); expect(paintCenter(rotated)).toEqual(paintCenter(matrix).map(value => expect.closeTo(value, 12)));
    expect(Math.hypot(rotated.m00, rotated.m10)).toBeCloseTo(Math.hypot(matrix.m00, matrix.m10));
    expect(Math.hypot(rotated.m01, rotated.m11)).toBeCloseTo(Math.hypot(matrix.m01, matrix.m11));
    expect(rotated.m00 * rotated.m01 + rotated.m10 * rotated.m11).toBeCloseTo(matrix.m00 * matrix.m01 + matrix.m10 * matrix.m11);
    expect(rotated.m00 * rotated.m11 - rotated.m01 * rotated.m10).toBeCloseTo(matrix.m00 * matrix.m11 - matrix.m01 * matrix.m10);
    const resized = sizePaintAxis(matrix, "y", 2.5); expect(Math.hypot(resized.m01, resized.m11)).toBeCloseTo(2.5); expect(paintCenter(resized)).toEqual(paintCenter(matrix).map(value => expect.closeTo(value, 12)));
    const flipped = flipPaint(matrix, "x"); expect(paintCenter(flipped)).toEqual(paintCenter(matrix).map(value => expect.closeTo(value, 12))); expect(validPaintTransform(flipped)).toBe(true);
    expect(validPaintTransform({ ...matrix, m00: 0, m10: 0 })).toBe(false);
    expect(centerPaint(matrix, [.2, .3])).toMatchObject({ m00: matrix.m00, m01: matrix.m01, m10: matrix.m10, m11: matrix.m11 });
  });
  it("matches the renderer's implicit Fill crop before adding source transform controls", () => {
    editor.graph.images.set("0123456789abcdef0123456789abcdef01234567", sourceImage());
    const fill: Fill = { type: "IMAGE", imageHash: "0123456789abcdef0123456789abcdef01234567", imageScaleMode: "CROP", color, opacity: 1, visible: true };
    const transform = initialImageTransform(fill, { width: 40, height: 40 }, { width: 40, height: 20 });
    expect(transform).toEqual({ m00: .5, m01: 0, m02: .25, m10: 0, m11: 1, m12: 0 });
    const implicit = renderFill(fill), explicit = renderFill({ ...fill, imageTransform: transform });
    try { for (const x of [2, 10, 30, 38]) expect(pixel(implicit.image, x, 20)).toEqual(pixel(explicit.image, x, 20)); } finally { implicit.image.delete(); explicit.image.delete(); }
  });
  it("matches pixel-size tiling and renders crop translation and flip as real image edits", () => {
    editor.graph.images.set("0123456789abcdef0123456789abcdef01234567", sourceImage());
    const fill: Fill = { type: "IMAGE", imageHash: "0123456789abcdef0123456789abcdef01234567", imageScaleMode: "TILE", color, opacity: 1, visible: true };
    const transform = initialImageTransform(fill, { width: 80, height: 40 }, { width: 40, height: 20 });
    const implicit = renderFill(fill, 80, 40), explicit = renderFill({ ...fill, imageTransform: transform }, 80, 40);
    try { for (const x of [5, 25, 45, 65]) expect(pixel(implicit.image, x, 5)).toEqual(pixel(explicit.image, x, 5)); } finally { implicit.image.delete(); explicit.image.delete(); }
    const crop = initialImageTransform({ ...fill, imageScaleMode: "CROP" }, { width: 40, height: 40 }, { width: 40, height: 20 });
    const flipped = renderFill({ ...fill, imageScaleMode: "CROP", imageTransform: flipPaint(crop, "x") });
    try { expect(pixel(flipped.image, 5, 20)).toEqual([0, 0, 255, 255]); expect(pixel(flipped.image, 35, 20)).toEqual([255, 0, 0, 255]); } finally { flipped.image.delete(); }
    const shifted = renderFill({ ...fill, imageScaleMode: "CROP", imageTransform: centerPaint(crop, [.75, .5]) });
    try { expect(pixel(shifted.image, 10, 20)).toEqual([0, 0, 255, 255]); } finally { shifted.image.delete(); }
  });
  it("persists exact affine paint data, blend modes and effects through project and real .fig roundtrips", async () => {
    editor.graph.images.set("0123456789abcdef0123456789abcdef01234567", sourceImage());
    const node = editor.graph.createNode("RECTANGLE", editor.state.currentPageId, { name: "Crop geometry", width: 100, height: 80, fills: [{ type: "IMAGE", imageHash: "0123456789abcdef0123456789abcdef01234567", imageScaleMode: "CROP", imageTransform: matrix, color, opacity: .8, visible: true, blendMode: "MULTIPLY" }, { type: "GRADIENT_RADIAL", gradientTransform: rotatePaint(matrix, 35), gradientStops: [{ position: 0, color }, { position: 1, color: { ...color, r: 1 } }], color, opacity: .7, visible: true, blendMode: "SCREEN" }], effects: [{ type: "DROP_SHADOW", radius: 4, spread: 2, offset: { x: 2, y: 3 }, color, visible: true, blendMode: "MULTIPLY", showShadowBehindNode: false }] });
    const project = deserializeGraph(serializeGraph(editor.graph)); expect(project.getNode(node.id)!.fills).toEqual(node.fills); expect(project.getNode(node.id)!.effects).toEqual(node.effects);
    const expectedThumbnail=renderThumbnail(ck,renderer,editor.graph,editor.state.currentPageId,512,512)!;
    const exported=deserializeGraph(serializeGraph(editor.graph));
    const bytes=await exportFigImageCompatible(exported,ck,renderer,editor.state.currentPageId);
    const {default:JSZip}=await import("jszip"),archive=await JSZip.loadAsync(bytes);
    expect(await archive.file("thumbnail.png")!.async("uint8array")).toEqual(expectedThumbnail);
    const restored = await parseFigFile(new Uint8Array(bytes).buffer, { populate: "all" });convertFigImageModes(restored,"import");
    expect(node.fills[0]!.imageScaleMode).toBe("CROP");
    const imported = [...restored.nodes.values()].find(node => node.name === "Crop geometry")!;
    expect(imported.fills[0]).toMatchObject({ type: "IMAGE", imageScaleMode: "CROP", blendMode: "MULTIPLY", opacity: expect.closeTo(.8, 6) });
    expect(imported.fills[0]!.imageTransform).toEqual(Object.fromEntries(Object.entries(matrix).map(([key, value]) => [key, expect.closeTo(value, 6)])));
    expect(imported.fills[1]).toMatchObject({ type: "GRADIENT_RADIAL", blendMode: "SCREEN" }); expect(imported.effects[0]).toMatchObject({ blendMode: "MULTIPLY", showShadowBehindNode: false });
  });
});

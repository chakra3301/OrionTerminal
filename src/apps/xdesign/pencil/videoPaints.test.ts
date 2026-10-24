// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createEditor, type Editor } from '@open-pencil/core/editor';
import { getCanvasKit } from '@open-pencil/core/canvaskit';
import { SkiaRenderer } from '@open-pencil/core/canvas';
import type { CanvasKit } from 'canvaskit-wasm';
import { SceneGraph } from '@open-pencil/scene-graph';
import { renderDesignNodes } from './proceduralPaints';
import { deserializeGraph, serializeGraph } from './document';
import { cloneDesignSubgraph } from './graphSubset';
import { selectionToDesignModel } from './reactExport';
import { createPublicationRevision, materializePublicationAsset } from './libraryDependencies';
import { bakeVideoPosters, installVideoPaints, placePreparedVideo, updateVideoAsset, videoAsset, type PreparedVideo } from './videoPaints';
let ck: CanvasKit, editor: Editor, renderer: SkiaRenderer, prepared: PreparedVideo;
beforeAll(async () => {
  ck = await getCanvasKit(); installVideoPaints(); const surface = ck.MakeSurface(16, 16)!;
  try { surface.getCanvas().clear(ck.Color4f(0, .5, 1, 1)); const image = surface.makeImageSnapshot(); try { prepared = { bytes: new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112]), poster: image.encodeToBytes()!, name: 'Clip.mp4', mime: 'video/mp4', width: 16, height: 16, duration: 2 }; } finally { image.delete(); } } finally { surface.delete(); }
});
beforeEach(() => { editor = createEditor(); renderer = new SkiaRenderer(ck, ck.MakeSurface(64, 64)!); editor.setCanvasKit(ck, renderer); });
afterEach(() => { renderer.destroy(); editor.dispose(); });
it('renders video posters through the native renderer and retains media through undo, save and bounded selection cloning', () => {
  const id = placePreparedVideo(editor, prepared, 12, 20), node = editor.graph.getNode(id)!;
  const before = serializeGraph(editor.graph), bytes = renderDesignNodes(ck, renderer, editor.graph, editor.state.currentPageId, [id], { format: 'PNG', scale: 1 })!;
  const image = ck.MakeImageFromEncoded(bytes)!; try { expect([...image.readPixels(8, 8, { width: 1, height: 1, alphaType: ck.AlphaType.Unpremul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB })!]).toEqual([0, 128, 255, 255]); } finally { image.delete(); }
  const reopened = deserializeGraph(before), privateGraph = cloneDesignSubgraph(reopened, [id]), asset = videoAsset(node, node.fills[0]!)!;
  expect(privateGraph.images.get(asset.videoHash)).toEqual(prepared.bytes); expect(privateGraph.images.get(asset.posterHash)).toEqual(prepared.poster);
  editor.undoAction(); expect(editor.graph.getNode(id)).toBeUndefined(); editor.redoAction(); expect(videoAsset(editor.graph.getNode(id)!, editor.graph.getNode(id)!.fills[0]!)?.videoHash).toBe(asset.videoHash);
  expect(serializeGraph(editor.graph)).toBe(before);
  bakeVideoPosters(privateGraph); expect(privateGraph.getNode(id)!.fills[0]!.type).toBe('IMAGE'); expect(editor.graph.getNode(id)!.fills[0]!.type).toBe('VIDEO');
});
it('makes standalone playback media, respects Fit and corner radii, and refuses missing or unsupported live paints', () => {
  const id = placePreparedVideo(editor, prepared, 0, 0), node = editor.graph.getNode(id)!;
  editor.graph.updateNode(id, { cornerRadius: 8, fills: [{ ...node.fills[0]!, imageScaleMode: 'FIT', opacity: .5 }] });
  const before = serializeGraph(editor.graph), model = selectionToDesignModel(editor.graph, [id]);
  expect(model.nodes[0]!.video).toMatchObject({ src: expect.stringMatching(/^data:video\/mp4;base64,/), poster: expect.stringMatching(/^data:image\/png;base64,/), controls: true, style: { objectFit: 'contain', opacity: .5, borderRadius: 8 } }); expect(serializeGraph(editor.graph)).toBe(before);
  editor.graph.updateNode(id, { effects: [{ type: 'LAYER_BLUR', color: { r: 0, g: 0, b: 0, a: 1 }, offset: { x: 0, y: 0 }, radius: 4, spread: 0, visible: true }] }); expect(() => selectionToDesignModel(editor.graph, [id])).toThrow('single Fit or Fill');
  editor.graph.updateNode(id, { effects: [] }); editor.graph.images.delete(videoAsset(node, node.fills[0]!)!.videoHash); expect(() => selectionToDesignModel(editor.graph, [id])).toThrow('missing');
});
it('keeps muted autoplay deterministic and restores playback settings with undo', () => {
  const id = placePreparedVideo(editor, prepared, 0, 0), node = editor.graph.getNode(id)!, fill = node.fills[0]!;
  updateVideoAsset(editor, node, videoAsset(node, fill)!, { autoplay: true }); expect(videoAsset(node, fill)).toMatchObject({ autoplay: true, muted: true });
  updateVideoAsset(editor, node, videoAsset(node, fill)!, { muted: false }); expect(videoAsset(node, fill)).toMatchObject({ autoplay: false, muted: false });
  editor.undoAction(); expect(videoAsset(node, fill)).toMatchObject({ autoplay: true, muted: true });
});
it('publishes and materializes all video resources with a library component', async () => {
  const component = editor.graph.createNode('COMPONENT', editor.state.currentPageId, { name: 'Media', componentKey: 'media', width: 32, height: 32 });
  const id = placePreparedVideo(editor, prepared, 0, 0, component.id), node = editor.graph.getNode(id)!, asset = videoAsset(node, node.fills[0]!)!;
  const revision = await createPublicationRevision({ graph: editor.graph, libraryId: 'test-media', name: 'Media', assetNodeIds: [component.id] });
  expect(revision.graph.images.get(asset.videoHash)).toEqual(prepared.bytes); expect(revision.graph.images.get(asset.posterHash)).toEqual(prepared.poster);
  const consumer = new SceneGraph(); materializePublicationAsset(consumer, revision, 'media'); expect(consumer.images.get(asset.videoHash)).toEqual(prepared.bytes); expect(consumer.images.get(asset.posterHash)).toEqual(prepared.poster);
});
it('refuses oversized or invalid resources before changing the document', () => {
  const before = serializeGraph(editor.graph);
  expect(() => placePreparedVideo(editor, { ...prepared, bytes: new Uint8Array(8 * 1024 * 1024 + 1) }, 0, 0)).toThrow('limit');
  expect(() => placePreparedVideo(editor, { ...prepared, duration: Infinity }, 0, 0)).toThrow('Invalid'); expect(serializeGraph(editor.graph)).toBe(before);
});

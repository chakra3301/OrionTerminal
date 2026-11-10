import { afterEach, expect, it, vi } from 'vitest';
import { createEditor } from '@open-pencil/core/editor';
import { placePreparedVideo, videoAsset } from './videoPaints';
import { clearPencilClipboard, copyPencilSelection, pastePencilData } from './clipboard';
import { usePencilWorkspace } from './runtime';
import { withClipboardVideoResources } from './videoClipboard';
afterEach(() => { clearPencilClipboard(); vi.restoreAllMocks(); usePencilWorkspace.setState({ editor: null, busy: false }); });
it('copies and pastes complete video resources between native canvas sessions through the clipboard snapshot', async () => {
  const source = createEditor(), destination = createEditor(), write = vi.fn(async () => {});
  vi.stubGlobal('navigator', { clipboard: { writeText: write } });
  try {
    usePencilWorkspace.setState({ busy: false });
    const id = placePreparedVideo(source, { bytes: new Uint8Array([1, 2, 3]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/mp4', name: 'Clip', width: 16, height: 16, duration: 2 }, 0, 0);
    const node = source.graph.getNode(id)!, asset = videoAsset(node, node.fills[0]!)!;
    await copyPencilSelection(source); expect(write).toHaveBeenCalledWith('Clip');
    await pastePencilData(destination, { html: '', text: 'Clip', files: [] });
    const pasted = destination.getSelectedNodes()[0]!; expect(pasted.fills[0]!.type).toBe('VIDEO'); expect(videoAsset(pasted, pasted.fills[0]!)?.videoHash).toBe(asset.videoHash); expect(destination.graph.images.get(asset.videoHash)).toEqual(new Uint8Array([1, 2, 3]));
    destination.undoAction(); expect(destination.graph.getNode(pasted.id)).toBeUndefined(); destination.redoAction(); expect(destination.graph.getNode(pasted.id)?.fills[0]?.type).toBe('VIDEO');
  } finally { source.dispose(); destination.dispose(); vi.unstubAllGlobals(); }
});
it('keeps video pixels and bytes in HTML after the source session and snapshot cache close', async () => {
  const source = createEditor(), destination = createEditor();
  try {
    const id = placePreparedVideo(source, { bytes: new Uint8Array([5, 6, 7]), poster: new Uint8Array([137, 80, 78, 71]), mime: 'video/webm', name: 'Across projects', width: 16, height: 16, duration: 2 }, 0, 0), node = source.graph.getNode(id)!, asset = videoAsset(node, node.fills[0]!)!;
    const payload = await source.prepareCopy(); withClipboardVideoResources(source.graph, payload); clearPencilClipboard();
    await destination.pasteFromHTML(payload.html);
    const pasted = destination.getSelectedNodes()[0]!; expect(pasted.fills[0]?.type).toBe('VIDEO'); expect(destination.graph.images.get(asset.videoHash)).toEqual(new Uint8Array([5, 6, 7])); expect(destination.graph.images.get(asset.posterHash)).toEqual(new Uint8Array([137, 80, 78, 71]));
  } finally { source.dispose(); destination.dispose(); }
});

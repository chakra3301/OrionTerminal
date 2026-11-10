import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { SceneGraph } from '@open-pencil/scene-graph';
import { RoomImageControls } from './RoomImageControls';
import { usePencilWorkspace } from './runtime';
import { useXDesign } from '../store';
import type { CanvasRoomSession, RoomUiState } from './roomSession';
import { roomImagePluginData } from './roomImageReferences';
import { imageFixture, imageOrigin, imageDocument, imageActor } from './roomImages.testSupport';
const host = vi.hoisted(() => ({ binding: null as import('./roomImageBindings').RoomImageBinding | null, candidates: [] as import('./roomImageBindings').RoomImageBinding[], edit: vi.fn() }));
vi.mock('./runtime', async original => ({ ...await original<typeof import('./runtime')>(), pencilPhotoDocumentId: () => host.binding?.photo.id ?? null, pencilRoomImageBinding: () => host.binding, pencilRoomImageCandidates: () => host.candidates, editPencilImage: host.edit }));
let root: Root, container: HTMLDivElement, f: Awaited<ReturnType<typeof imageFixture>>, room: CanvasRoomSession, state: RoomUiState;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('crypto', webcrypto); f = await imageFixture(); host.binding = null; host.candidates = []; host.edit.mockReset(); useXDesign.getState().hydrate(null); usePencilWorkspace.setState({ busy: false, readOnly: false });
  room = { hydrateRoomImage: vi.fn(async () => f.source), reviewCanvasImage: vi.fn(async () => ({ transferId: 'transfer_identity_001', manifest: f.manifest, epoch: 1 })), publishCanvasImage: vi.fn(async () => {}), recoverCanvasImage: vi.fn(async () => null), dismissCanvasImage: vi.fn(async () => {}) } as unknown as CanvasRoomSession;
  room.reviewImagePlacement = vi.fn(async () => ({ name: f.source.name, width: 24, height: 24, placements: 2, revisionId: f.reference.revisionId }));
  room.applyImagePlacement = vi.fn(async () => {});
  state = { connection: { phase: 'online', actor: imageActor } as RoomUiState['connection'], preference: { serverUrl: imageOrigin, documentId: imageDocument, revision: 1, role: 'editor' }, opening: false, creation: null, error: null, presence: null, images: { phase: 'ready', pending: null, actor: null, error: null, completedChunks: 0, totalChunks: 0 } };
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === text)!;
async function render(linked = false) {
  const graph = new SceneGraph(), node = graph.createNode('RECTANGLE', graph.getPages()[0]!.id, { fills: [{ type: 'IMAGE', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, imageHash: f.reference.previewHash }], pluginData: [roomImagePluginData(f.reference)] });
  if (linked) { host.binding = { serverUrl: imageOrigin, documentId: imageDocument, reference: f.reference, photo: f.source }; useXDesign.setState({ photoDocuments: { [f.source.id]: f.source } }); }
  await act(async () => root.render(<RoomImageControls room={room} state={state} node={node}/>)); return node;
}
it('ties explicit editable download to the selected shared image and does not publish or download on rendering', async () => {
  const node = await render(); expect(room.hydrateRoomImage).not.toHaveBeenCalled(); expect(room.publishCanvasImage).not.toHaveBeenCalled(); expect(button('Review image publication')).toBeUndefined();
  await act(async () => button('Download editable contents').click()); expect(room.hydrateRoomImage).toHaveBeenCalledWith(node.id);
  state.connection = null; await render(); expect(button('Download editable contents').disabled).toBe(true);
});
it('shows and publishes the original reviewed dimensions only after the explicit publication button', async () => {
  await render(true); await act(async () => useXDesign.setState({ photoDocuments: { [f.source.id]: { ...f.source, version: '01ARZ3NDEKTSV4RRFFQ69G5FAW' } } }));
  await act(async () => button('Review image publication').click()); expect(room.reviewCanvasImage).toHaveBeenCalledOnce(); expect(room.publishCanvasImage).not.toHaveBeenCalled(); expect(container.querySelector('[role="dialog"]')?.textContent).toContain('24 × 24 pixels');
  await act(async () => button('Publish image').click()); expect(room.publishCanvasImage).toHaveBeenCalledWith({ transferId: 'transfer_identity_001', manifest: f.manifest, epoch: 1 }); expect(container.querySelector('[role="dialog"]')).toBeNull();
});
it('allows viewer recovery while disabling Image editing and revision publication', async () => {
  usePencilWorkspace.setState({ readOnly: true }); state.images!.pending = { projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', serverUrl: imageOrigin, documentId: imageDocument, actorId: imageActor.id, transferId: 'transfer_identity_001', acknowledged: false, direction: 'download', imageId: f.reference.imageId, revisionId: f.reference.revisionId, name: f.source.name, approved: true, complete: true };
  await render(true); expect(button('Finish image transfer').disabled).toBe(false); expect(button('Dismiss transfer').disabled).toBe(true);
  await act(async () => button('Finish image transfer').click()); expect(room.recoverCanvasImage).toHaveBeenCalledOnce();
  state.images!.pending = null; await render(true); expect(button('Open in Image').disabled).toBe(true); expect(button('Review image publication').disabled).toBe(true);
});
it('keeps failed recovery visible and blocks controls during an active transfer', async () => {
  state.images!.pending = { projectId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', serverUrl: imageOrigin, documentId: imageDocument, actorId: imageActor.id, transferId: 'transfer_identity_001', acknowledged: false, direction: 'upload', imageId: f.reference.imageId, revisionId: f.reference.revisionId, name: f.source.name, approved: false, complete: false };
  vi.mocked(room.recoverCanvasImage).mockRejectedValueOnce(new Error('Reconnect the original member')); await render();
  await act(async () => button('Review prepared image').click()); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Reconnect the original member');
  state.images!.phase = 'transferring'; state.images!.completedChunks = 1; state.images!.totalChunks = 2; await render(); expect(button('Review prepared image').disabled).toBe(true); expect(button('Dismiss transfer').disabled).toBe(true); expect(container.querySelector('progress')?.value).toBe(1);
});
it('reviews the accepted revision and affected placements before explicitly applying without publication', async () => {
  host.candidates = [{ serverUrl: imageOrigin, documentId: imageDocument, reference: f.reference, photo: f.source }];
  const node = await render(true); expect(room.reviewImagePlacement).not.toHaveBeenCalled();
  await act(async () => button('Review published image').click());
  expect(room.reviewImagePlacement).toHaveBeenCalledWith(node.id, f.reference); expect(room.applyImagePlacement).not.toHaveBeenCalled();
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('2 linked placements');
  await act(async () => button('Use published image').click()); expect(room.applyImagePlacement).toHaveBeenCalledOnce(); expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(room.publishCanvasImage).not.toHaveBeenCalled();
});
it('disambiguates saved revisions and preserves the review after a failed apply or fresh viewer restriction', async () => {
  host.candidates = ['a', 'b'].map(letter => ({ serverUrl: imageOrigin, documentId: imageDocument, reference: { ...f.reference, revisionId: letter.repeat(64) }, photo: f.source }));
  await render(true); const select = container.querySelector('select')!; expect(select.getAttribute('aria-label')).toBe('Published image revision');
  await act(async () => { select.value = select.options[1]!.value; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => button('Review published image').click()); expect(room.reviewImagePlacement).toHaveBeenLastCalledWith(expect.any(String), host.candidates[1]!.reference);
  vi.mocked(room.applyImagePlacement).mockRejectedValueOnce(new Error('Review changed placements again'));
  await act(async () => button('Use published image').click()); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Review changed placements again'); expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => usePencilWorkspace.setState({ readOnly: true })); expect(button('Use published image').disabled).toBe(true); expect(button('Review published image').disabled).toBe(true);
});

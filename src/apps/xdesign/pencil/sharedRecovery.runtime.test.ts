import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
import { SceneGraph } from '@open-pencil/scene-graph';
import { useXDesign } from '../store';
import { emptyDoc, loadDoc, saveDoc, snapshotActiveDoc, useXDProjects } from '../projectsStore';
import { useHtmlArtifact } from '../htmlArtifactStore';
import { openPencilSession, startPencilSession, startSharedPencilSession, currentPencilSnapshot, persistPencil, usePencilWorkspace, commitPencilPhoto, placePencilAsset, placePencilVideo, runPencilLibraryAction } from './runtime';
import { SharedDesign } from './sharedDesign';
import { decodeSharedCheckpoint, encodeSharedCheckpoint, restoreSharedDesign } from './sharedCheckpoint';
import { deserializeGraph, serializeGraph, validatePencilDocument, type PencilDocument } from './document';
import { readRoomRequest, roomBinary, type RoomRequest } from './sharedRoomProtocol';
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn(), convertFileSrc: (path: string) => path }));
const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/db', () => ({
  getAppState: vi.fn(async (key: string) => memory.has(key) ? JSON.parse(JSON.stringify(memory.get(key))) : null),
  setAppState: vi.fn(async (key: string, value: unknown) => { memory.set(key, JSON.parse(JSON.stringify(value))); }),
}));
let session: ReturnType<typeof startPencilSession> | undefined;
const replicas: SharedDesign[] = [];
beforeEach(() => {
  memory.clear(); useXDesign.getState().hydrate(emptyDoc()); const id = ulid();
  useXDProjects.setState({ activeId: id, transitioning: false, ready: true, registry: [{ id, name: 'Recovery', createdAt: 0, updatedAt: 0 }] });
  useHtmlArtifact.getState().setProject(id);
  usePencilWorkspace.setState({ editor: null, busy: false, error: null });
});
afterEach(() => { session?.dispose(); session = undefined; replicas.splice(0).forEach(replica => replica.dispose()); });
function setup() {
  const graph = new SceneGraph(), page = graph.getPages()[0]!, node = graph.createNode('RECTANGLE', page.id, { name: 'Saved', x: 10 });
  const document: PencilDocument = { formatVersion: 1, graph: serializeGraph(graph), pageId: page.id, panX: 12, panY: 24, zoom: 1.5, photoLinks: {} };
  const replica = SharedDesign.fromGraph(graph), peer = SharedDesign.fromUpdate(replica.update()); replicas.push(replica, peer); useXDesign.setState({ pencilDocument: document });
  return { document, replica, peer, node, page: page.id };
}
it('saves through project storage, reopens the normal canvas session and merges offline changes with the original peer', async () => {
  const { document: data, replica, peer, node, page } = setup(); const project = useXDProjects.getState().activeId!;
  session = await startSharedPencilSession(document.createElement('div'), data, replica, () => {});
  const documentId = useXDesign.getState().pencilDocument!.shared!.documentId;
  session.editor.updateNodeWithUndo(node.id, { x: 300 });
  peer.receive(session.shared!.replica.update(peer.stateVector()));
  await session.shared!.receive(peer.edit('Peer width', graph => graph.updateNode(node.id, { width: 270 })).update);
  await saveDoc(project, snapshotActiveDoc()); const stored = await loadDoc(project); expect(stored!.pencilDocument!.shared!.documentId).toBe(documentId); validatePencilDocument(stored!.pencilDocument!);
  session.dispose(); session = undefined; useXDesign.getState().hydrate(stored!);
  session = await openPencilSession(globalThis.document.createElement('div'), stored!.pencilDocument!, () => {});
  expect(session.shared).toBeDefined(); expect(session.shared!.replica.peerId).not.toBe(replica.peerId); expect(session.editor.undo.canUndo).toBe(false);
  const restored = session.editor.graph.getNode(node.id)!; expect(restored).toMatchObject({ x: 300, width: 270 }); expect(session.editor.state).toMatchObject({ panX: 12, panY: 24, zoom: 1.5 });
  session.editor.updateNodeWithUndo(node.id, { y: 90 }); peer.edit('Offline peer layer', graph => graph.createNode('TEXT', page, { text: 'From peer' }));
  await session.shared!.receive(peer.update(session.shared!.replica.stateVector())); peer.receive(session.shared!.replica.update(peer.stateVector()));
  expect(serializeGraph(session.shared!.replica.graph)).toBe(serializeGraph(peer.graph)); session.editor.undoAction(); expect(restored.y).toBe(0); expect(session.editor.graph.getChildren(page).some(child => child.text === 'From peer')).toBe(true);
  validatePencilDocument(currentPencilSnapshot()!); expect(currentPencilSnapshot()!.shared!.documentId).toBe(documentId);
});
it('persists invisible shared changes even when the projected artwork is identical', async () => {
  const { document: data, replica, peer, page } = setup(); session = await startSharedPencilSession(document.createElement('div'), data, replica, () => {});
  const before = currentPencilSnapshot()!; let removed = '';
  peer.edit('Temporary', graph => { removed = graph.createNode('RECTANGLE', page).id; }); peer.edit('Remove temporary', graph => graph.deleteNode(removed));
  await session.shared!.receive(peer.update(replica.stateVector())); const after = useXDesign.getState().pencilDocument!;
  expect(after.graph).toBe(before.graph); expect(after.shared!.checkpoint).not.toBe(before.shared!.checkpoint);
  const restored = restoreSharedDesign(after); try { expect(restored.graph.nodes.has(removed)).toBe(false); const vector = restored.stateVector(); restored.receive(peer.update(vector)); expect(restored.stateVector()).toEqual(vector); } finally { restored.dispose(); }
});
it('keeps accepted graph and checkpoint together while a new page or interactive move is provisional', async () => {
  const { document: data, replica, node } = setup(); session = await startSharedPencilSession(document.createElement('div'), data, replica, () => {}); const editor = session.editor;
  editor.undo.beginBatch('Draft page'); const page = editor.graph.addPage('Draft'); editor.state.currentPageId = page.id; editor.graph.updateNode(node.id, { x: 99 });
  const provisional = currentPencilSnapshot()!; validatePencilDocument(provisional); expect(provisional.pageId).toBe(data.pageId); expect(deserializeGraph(provisional.graph).getNode(page.id)).toBeUndefined(); editor.undo.rollbackBatch();
  const finish = editor.beginInteractiveEdit(); editor.graph.updateNodePositionPreview(node.id, 88, 0); persistPencil(); const preview = currentPencilSnapshot()!; validatePencilDocument(preview); expect(deserializeGraph(preview.graph).getNode(node.id)!.x).toBe(10); editor.graph.updateNodePositionPreview(node.id, 10, 0); finish();
});
it('preserves unsupported or mismatched checkpoint data and refuses a local downgrade', async () => {
  const { document: data, replica } = setup(); const saved = { ...data, shared: encodeSharedCheckpoint(ulid(), replica.update()) }; useXDesign.setState({ pencilDocument: saved });
  expect(() => startPencilSession(document.createElement('div'), saved, () => {})).toThrow('checkpoint was preserved');
  const future = { ...saved, shared: { ...saved.shared, version: 2 } } as unknown as PencilDocument; useXDesign.setState({ pencilDocument: future });
  await expect(openPencilSession(document.createElement('div'), future, () => {})).rejects.toThrow('newer application'); expect(useXDesign.getState().pencilDocument).toBe(future); expect(usePencilWorkspace.getState().editor).toBeNull();
  await expect(openPencilSession(document.createElement('div'), { ...saved, graph: data.graph.replace('Saved', 'Altered') }, () => {})).rejects.toThrow('do not match'); expect(useXDesign.getState().pencilDocument).toBe(future);
});
it('refuses canceled recovery before constructing an editor and leaves an existing session intact', async () => {
  const { document: data, replica } = setup(); session = startPencilSession(document.createElement('div'), data, () => {}); const editor = session.editor;
  const saved = { ...data, shared: encodeSharedCheckpoint(ulid(), replica.update()) };
  await expect(openPencilSession(document.createElement('div'), saved, () => {}, { isCurrent: () => false })).rejects.toThrow('changed while loading'); expect(usePencilWorkspace.getState().editor).toBe(editor); expect(editor.graph.getPages()).toHaveLength(1);
});
it('releases owned recovery replicas and retains the checkpoint when its canvas session closes', async () => {
  const { document: data, replica } = setup(); const saved = { ...data, shared: encodeSharedCheckpoint(ulid(), replica.update()) }; useXDesign.setState({ pencilDocument: saved });
  session = await openPencilSession(document.createElement('div'), saved, () => {}); const owned = session.shared!.replica; session.dispose(); session = undefined;
  expect(() => owned.update()).toThrow(); expect(usePencilWorkspace.getState().editor).toBeNull(); expect(decodeSharedCheckpoint(useXDesign.getState().pencilDocument!.shared!)).toEqual(decodeSharedCheckpoint(saved.shared));
});
it('restores the previous saved record when a local or peer publisher fails after writing its candidate', async () => {
  const { document: data, replica, peer, node } = setup(); let fail = false;
  session = await startSharedPencilSession(document.createElement('div'), data, replica, () => {}, { publish: () => { persistPencil(); if (fail) throw new Error('Publication failed'); } });
  const previous = useXDesign.getState().pencilDocument; fail = true;
  expect(() => session!.editor.updateNodeWithUndo(node.id, { x: 44 })).toThrow('Publication failed'); expect(useXDesign.getState().pencilDocument).toBe(previous); expect(session.editor.graph.getNode(node.id)!.x).toBe(10); expect(session.editor.undo.canUndo).toBe(false);
  await expect(session.shared!.receive(peer.edit('Peer', graph => graph.updateNode(node.id, { y: 90 })).update)).rejects.toThrow('Publication failed'); expect(useXDesign.getState().pencilDocument).toBe(previous); validatePencilDocument(previous!);
});
it('recovers a valid checkpoint after failed undo publication without losing the local history entry', async () => {
  const { document: data, replica, node } = setup(); let fail = false;
  session = await startSharedPencilSession(document.createElement('div'), data, replica, () => {}, { publish: () => { persistPencil(); if (fail) throw new Error('Undo publication failed'); } });
  session.editor.updateNodeWithUndo(node.id, { x: 60 }); const previous = useXDesign.getState().pencilDocument; fail = true;
  expect(() => session!.editor.undoAction()).toThrow('Undo publication failed'); expect(useXDesign.getState().pencilDocument).toBe(previous); expect(session.editor.graph.getNode(node.id)!.x).toBe(60); expect(session.editor.undo.canUndo).toBe(true); validatePencilDocument(currentPencilSnapshot()!);
  fail = false; session.editor.undoAction(); expect(session.editor.graph.getNode(node.id)!.x).toBe(10); validatePencilDocument(currentPencilSnapshot()!);
});
it('keeps a newer editor and its snapshot provider active when an older session finishes disposing', () => {
  const { document: data } = setup(); const previous = startPencilSession(document.createElement('div'), data, () => {}); session = startPencilSession(document.createElement('div'), data, () => {});
  const created = session.editor.graph.createNode('RECTANGLE', data.pageId, { name: 'New session' }); previous.dispose(); persistPencil(); expect(usePencilWorkspace.getState().editor).toBe(session.editor); expect(deserializeGraph(currentPencilSnapshot()!.graph).getNode(created.id)?.name).toBe('New session');
});
it('reuses checkpoint encoding for ordinary view changes and re-encodes accepted artwork', async () => {
  const { document: data, replica, node } = setup(); session = await startSharedPencilSession(document.createElement('div'), data, replica, () => {}); const encoder = vi.spyOn(globalThis, 'btoa');
  try {
    session.editor.state.panX = 80; currentPencilSnapshot(); session.editor.state.zoom = 2; persistPencil(); expect(encoder).not.toHaveBeenCalled();
    session.editor.updateNodeWithUndo(node.id, { x: 30 }); expect(encoder).toHaveBeenCalledOnce(); currentPencilSnapshot(); expect(encoder).toHaveBeenCalledOnce();
  } finally { encoder.mockRestore(); }
});
it('rejects asynchronous publishers at startup, consumes rejection and restores their synchronous candidate write', async () => {
  const { document: data, replica, node } = setup(); const previous = useXDesign.getState().pencilDocument;
  await expect(startSharedPencilSession(document.createElement('div'), data, replica, () => {}, { publish: async () => { persistPencil(); throw new Error('Late rejection'); } })).rejects.toThrow('must be synchronous');
  expect(useXDesign.getState().pencilDocument).toBe(previous); expect(usePencilWorkspace.getState().editor).toBeNull(); expect(replica.graph.getNode(node.id)!.x).toBe(10); validatePencilDocument(data);
});
it('aborts readiness failures without retaining an editor or publishing a new shared record', async () => {
  const { document: data, replica } = setup(); const previous = useXDesign.getState().pencilDocument;
  await expect(startSharedPencilSession(document.createElement('div'), data, replica, () => { throw new Error('Ready failed'); })).rejects.toThrow('Ready failed');
  expect(usePencilWorkspace.getState().editor).toBeNull(); expect(useXDesign.getState().pencilDocument).toBe(previous);
  session = startPencilSession(document.createElement('div'), data, () => {}); session.dispose(); session.dispose(); session = undefined;
  expect(usePencilWorkspace.getState().editor).toBeNull(); expect(useXDesign.getState().pencilDocument).toBe(previous);
});
it('owns an explicit room connection with the canvas session and saves peer state with its checkpoint', async () => {
  const { document: data, replica, peer, node } = setup(), documentId = ulid(), saved = { ...data, shared: encodeSharedCheckpoint(documentId, replica.update()) };
  const request = vi.fn(async (packet: Readonly<RoomRequest>) => {
    const parsed = readRoomRequest(packet); if (parsed.update) peer.receive(parsed.update);
    return { ...packet, type: packet.type === 'update' ? 'ack' : 'sync', revision: 2, actor: { id: 'member_identity_001', name: 'Designer', role: 'editor' }, vector: roomBinary(peer.stateVector(), true), update: roomBinary(peer.update(parsed.vector)), ...(packet.type === 'update' ? { acceptedRevision: 2 } : {}) };
  });
  peer.edit('Peer', graph => graph.updateNode(node.id, { width: 222 })); const opened = await openPencilSession(document.createElement('div'), saved, () => {}, { room: { request } }); session = opened;
  const room = 'room' in opened ? opened.room : undefined; expect(room).toBeDefined(); await vi.waitFor(() => expect(room!.state.phase).toBe('online'));
  const restored = restoreSharedDesign(currentPencilSnapshot()!); replicas.push(restored);
  expect(session.editor.graph.getNode(node.id)!.width).toBe(222); expect(restored.graph.getNode(node.id)!.width).toBe(222);
  const persisted = useXDesign.getState().pencilDocument; session.dispose(); session = undefined; expect(room!.state.phase).toBe('closed'); expect(useXDesign.getState().pencilDocument).toEqual(persisted);
});
it('aborts a room request and suppresses stale state callbacks when a newer project owns the canvas', async () => {
  const { document: data, replica, peer, node } = setup(), state = vi.fn(); let release!: (value: unknown) => void, signal!: AbortSignal;
  const request = vi.fn((packet: Readonly<RoomRequest>, abort: AbortSignal) => { signal = abort; const parsed = readRoomRequest(packet); return new Promise(resolve => { release = () => resolve({ ...packet, type: 'sync', revision: 2, actor: { id: 'member_identity_001', name: 'Designer', role: 'viewer' }, vector: roomBinary(peer.stateVector(), true), update: roomBinary(peer.update(parsed.vector)) }); }); });
  const opened = await startSharedPencilSession(document.createElement('div'), data, replica, () => {}, { room: { request, onState: state } }); session = opened;
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce()); const count = state.mock.calls.length; useXDProjects.setState({ activeId: ulid() }); peer.edit('Late peer', graph => graph.updateNode(node.id, { x: 999 })); opened.dispose(); session = undefined; expect(signal.aborted).toBe(true); release(undefined); await Promise.resolve(); await Promise.resolve();
  expect(state).toHaveBeenCalledTimes(count); expect(replica.graph.getNode(node.id)!.x).toBe(10);
});

it('saves accepted shared state while a project transition makes the editor inactive', async () => {
  const { document: data, replica, node } = setup(); session = await startSharedPencilSession(document.createElement('div'), data, replica, () => {}); session.editor.updateNodeWithUndo(node.id, { x: 90 });
  const previous = currentPencilSnapshot(); useXDProjects.setState({ transitioning: true }); const snapshot = snapshotActiveDoc().pencilDocument!; expect(snapshot.graph).toBe(previous!.graph); expect(snapshot.shared).toEqual(previous!.shared); validatePencilDocument(snapshot);
  useXDProjects.setState({ transitioning: false });
});

it('rejects viewer external image and library work before starting side effects', async () => {
  const { document: data, replica } = setup(); session = await startSharedPencilSession(document.createElement('div'), data, replica, () => {}); session.shared!.setReadOnly(true); usePencilWorkspace.setState({ readOnly: true }); const work = vi.fn();
  await expect(runPencilLibraryAction(work)).rejects.toThrow('viewer'); await expect(placePencilAsset('data:', 'image.png', 0, 0)).rejects.toThrow('viewer'); await expect(placePencilVideo(new File([], 'video.mp4'))).rejects.toThrow('viewer'); expect(work).not.toHaveBeenCalled(); expect(usePencilWorkspace.getState().busy).toBe(false);
});
it('refuses an image reply that arrives after viewer access without storing pixels or photo metadata', async () => {
  const { document: data, replica, node } = setup(); session = await startSharedPencilSession(document.createElement('div'), data, replica, () => {}); let release!: (bytes: ArrayBuffer) => void;
  const fetcher = vi.fn(async () => ({ ok: true, arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { release = resolve; }) })); vi.stubGlobal('fetch', fetcher); const store = vi.spyOn(session.editor, 'storeImage'); const images = [...session.editor.graph.images.keys()];
  try {
    const work = commitPencilPhoto({ id: 'photo', previewPath: '/preview.png' } as import('../photo/types').PhotoDocument, node.id); await vi.waitFor(() => expect(release).toBeDefined()); session.shared!.setReadOnly(true); usePencilWorkspace.setState({ readOnly: true }); release(new ArrayBuffer(4));
    await expect(work).rejects.toThrow('viewer'); expect(store).not.toHaveBeenCalled(); expect([...session.editor.graph.images.keys()]).toEqual(images); expect(useXDesign.getState().photoDocuments).toEqual({}); expect(session.editor.graph.getNode(node.id)!.x).toBe(10);
  } finally { store.mockRestore(); vi.unstubAllGlobals(); }
});

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ulid } from 'ulid';
import { webcrypto } from 'node:crypto';
import { SceneGraph } from '@open-pencil/scene-graph';
import { useXDesign } from '../store';
import { emptyDoc, useXDProjects } from '../projectsStore';
import { useHtmlArtifact } from '../htmlArtifactStore';
import { openPencilSession, currentPencilSnapshot, usePencilWorkspace } from './runtime';
import { CanvasRoomSession, consumeRoomJoinIntent, consumeRoomCreationIntent, joinSharedRoom, prepareSharedRoom } from './roomSession';
import { SharedDesign } from './sharedDesign';
import { encodeSharedCheckpoint, restoreSharedDesign } from './sharedCheckpoint';
import { deserializeGraph, serializeGraph, type PencilDocument } from './document';
import { readRoomRequest, roomBinary, type RoomRequest } from './sharedRoomProtocol';
import { loadRoomGrants, roomGrantKey, type PendingRoomCreation, type PendingRoomInvitation, type PendingRoomAuthorGrant } from './roomGrants';
import { readPresenceRequest, type PresencePeer, type PresenceRequest } from './roomPresenceProtocol';
import { usePhotoWorkspace } from '../photo/runtime';
import { readRoomCommentRequest, type RoomCommentRequest } from './roomCommentProtocol';
import { applyRoomCommentCommand } from './roomCommentCommands';
import { allComments, createCommentAnchor } from './comments';
import { loadPendingRoomComment } from './roomCommentPending';
import { commentHistorySnapshot, replayCommentHistory, type CommentHistoryRecord } from './roomCommentHistory';
import type { RoomCommentHistoryEntry, RoomCommentResult } from './roomCommentProtocol';
const host = vi.hoisted(() => ({ invoke: vi.fn(), atomic: vi.fn(), save: vi.fn(), data: new Map<string, unknown>() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: host.invoke, convertFileSrc: (path: string) => path }));
vi.mock('@/lib/db', () => ({
  getAppState: async (key: string) => structuredClone(host.data.get(key) ?? null),
  setAppState: async (key: string, value: unknown) => { await host.save(key); host.data.set(key, structuredClone(value)); },
  setXDesignStateAtomic: async (writes: { key: string; value: unknown }[]) => { await host.atomic(); for (const write of writes) host.data.set(write.key, structuredClone(write.value)); },
}));
const server = 'https://rooms.example.test/', documentId = 'document_identity_001', member = 'membership_identity_001', credential = `${member}.${'a'.repeat(43)}`;
let session: Awaited<ReturnType<typeof openPencilSession>> | undefined, controller: CanvasRoomSession | undefined, peer: SharedDesign;
let nodeId: string, projectId: string, revision: number, role: 'owner' | 'editor' | 'viewer', handle: number;
const presenceRoots: HTMLElement[] = [];
const commands = () => host.invoke.mock.calls.map(call => call[0]);
function commentBridge(lose = false) {
  const original = host.invoke.getMockImplementation()!, receipts = new Map<string, { threadId: string; messageId: string }>();
  host.invoke.mockImplementation(async (command, args) => {
    if (command !== 'xdesign_room_request' || args.operation.kind !== 'comment') return original(command, args);
    const packet = readRoomCommentRequest(args.operation.message as RoomCommentRequest).packet; let result = receipts.get(packet.requestId);
    if (!result) {
      if (args.operation.recoverOnly) throw { status: 404, code: 'receipt' };
      expect((await loadPendingRoomComment(projectId))!.packet).toEqual(packet);
      result = { threadId: `thread_${packet.requestId}`, messageId: `message_${packet.requestId}` };
      peer.edit('Service comment', graph => applyRoomCommentCommand(graph, packet.command, { id: member, name: 'Designer', role }, result!, 1000)); receipts.set(packet.requestId, result); revision++;
      if (lose) { lose = false; throw { status: 504, code: 'timeout' }; }
    }
    return { version: 1, type: 'comment', documentId, clientId: packet.clientId, requestId: packet.requestId, revision, acceptedRevision: 4, actor: { id: member, name: 'Designer', role }, vector: roomBinary(peer.stateVector(), true), update: roomBinary(peer.update()), result };
  }); return receipts;
}
it('sends viewer comments on their own native handle and durably saves the admitted checkpoint without allowing artwork', async () => {
  role = 'viewer'; const room = await canvas('viewer'); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('readonly')); await vi.waitFor(() => expect(room.snapshot.comments?.phase).toBe('ready')); commentBridge();
  const editor = session!.editor, pageId = editor.state.currentPageId;
  const result = await room.submitComment({ type: 'add', pageId, anchor: createCommentAnchor(editor.graph, pageId, [{ x: 20, y: 30 }]), body: 'Viewer feedback' });
  expect(allComments(editor.graph)[0]!.id).toBe(result.threadId); expect(allComments(editor.graph)[0]!.messages[0]!.createdAt).toBe(1000); expect(editor.undo.canUndo).toBe(false); expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(() => editor.updateNodeWithUndo(nodeId, { x: 777 })).toThrow('viewer');
  const saved = host.data.get(`xdesign.project.${projectId}`) as { pencilDocument: PencilDocument }; expect(allComments(deserializeGraph(saved.pencilDocument.graph))).toHaveLength(1); expect(await loadPendingRoomComment(projectId)).toBeNull();
  const sync = host.invoke.mock.calls.find(call => call[1]?.operation?.kind === 'sync')![1], comment = host.invoke.mock.calls.find(call => call[1]?.operation?.kind === 'comment')![1]; expect(comment.handle).not.toBe(sync.handle);
});
it('recovers a lost native comment reply after reopening without replaying the accepted command', async () => {
  role = 'viewer'; let room = await canvas('viewer'); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('readonly')); await vi.waitFor(() => expect(room.snapshot.comments?.phase).toBe('ready')); commentBridge(true);
  const editor = session!.editor, pageId = editor.state.currentPageId;
  await expect(room.submitComment({ type: 'add', pageId, anchor: createCommentAnchor(editor.graph, pageId, [{ x: 20, y: 30 }]), body: 'Recover me' })).rejects.toThrow('unknown'); const pending = await loadPendingRoomComment(projectId); expect(pending).not.toBeNull();
  controller!.dispose(); session!.dispose(); room = await canvas('viewer'); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('readonly')); await vi.waitFor(() => expect(room.snapshot.comments?.phase).toBe('pending'));
  expect((await room.recoverComment()).threadId).toBe(allComments(peer.graph)[0]!.id); expect(allComments(session!.editor.graph)).toHaveLength(1); expect(await loadPendingRoomComment(projectId)).toBeNull(); expect(host.invoke.mock.calls.filter(call => call[1]?.operation?.kind === 'comment' && !call[1].operation.recoverOnly)).toHaveLength(1);
});
function reply(packet: RoomRequest) { const parsed = readRoomRequest(packet); if (parsed.update) peer.receive(parsed.update); return { ...packet, type: packet.type === 'update' ? 'ack' : 'sync', revision, actor: { id: member, name: 'Designer', role }, vector: roomBinary(peer.stateVector(), true), update: roomBinary(peer.update(parsed.vector)), ...(packet.type === 'update' ? { acceptedRevision: revision } : {}) }; }
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  host.data.clear(); host.atomic.mockReset(); host.save.mockReset(); host.invoke.mockReset(); role = 'editor'; revision = 3; handle = 0;
  usePhotoWorkspace.setState({ shapeId: null });
  const graph = new SceneGraph(), page = graph.getPages()[0]!.id; nodeId = graph.createNode('RECTANGLE', page, { name: 'Original', x: 10, width: 100 }).id; peer = SharedDesign.fromGraph(graph);
  projectId = ulid(); useXDesign.getState().hydrate(emptyDoc()); useXDesign.setState({ pencilDocument: { formatVersion: 1, graph: serializeGraph(graph), pageId: page, panX: 0, panY: 0, zoom: 1, photoLinks: {}, shared: encodeSharedCheckpoint(documentId, peer.update()) } });
  useXDProjects.setState({ activeId: projectId, transitioning: false, ready: true, registry: [{ id: projectId, name: 'Original project', createdAt: 0, updatedAt: 0 }] }); useHtmlArtifact.getState().setProject(projectId); usePencilWorkspace.setState({ editor: null, busy: false, error: null, readOnly: false });
  host.invoke.mockImplementation(async (command: string, args: { operation?: { kind: string; message: RoomRequest } }) => {
    if (command === 'xdesign_room_open') return `transport_handle_${String(++handle).padStart(3, '0')}`;
    if (command === 'xdesign_room_key_status') return true;
    if (command === 'xdesign_room_request') { if (args.operation?.kind === 'sync') return reply(args.operation.message); if (args.operation?.kind === 'members') return { version: 1, documentId, members: [{ id: member, name: 'Designer', role: 'owner', revoked: false }] }; return { version: 1, documentId }; }
  });
});
async function preparedCopy(): Promise<PendingRoomCreation> {
  await canvas(); session!.editor.updateNodeWithUndo(nodeId, { x: 77 });
  const id = await prepareSharedRoom(server, 'Shared copy', 'Owner', new AbortController().signal);
  controller!.dispose(); session!.dispose(); controller = undefined;
  session = await openPencilSession(document.createElement('div'), useXDesign.getState().pencilDocument!, () => {});
  const creation = (await loadRoomGrants(id))[0] as PendingRoomCreation;
  controller = new CanvasRoomSession(session.editor, session.shared!, creation.documentId, id, null, creation); return creation;
}
const ownerGrant = (pending: PendingRoomCreation) => ({ version: 1, revision: 1, documentId: pending.documentId, actor: { id: member, name: 'Owner', role: 'owner' }, credential, requestId: pending.requestId });
it('prepares a pinned shared copy and pending creation atomically without any native dispatch', async () => {
  await canvas(); const editor = session!.editor; editor.updateNodeWithUndo(nodeId, { x: 77 });
  host.atomic.mockRejectedValueOnce(new Error('Disk full'));
  await expect(prepareSharedRoom(server, 'Another copy', 'Owner', new AbortController().signal)).rejects.toThrow('Disk full'); expect(useXDProjects.getState().activeId).toBe(projectId);
  expect([...host.data.keys()].filter(key => key.startsWith('xdesign.roomGrants.'))).toEqual([]);
  const id = await prepareSharedRoom(server, 'Shared copy', 'Owner', new AbortController().signal), creation = (await loadRoomGrants(id))[0] as PendingRoomCreation;
  expect(commands()).toEqual([]); expect(host.atomic).toHaveBeenCalledTimes(2); expect(consumeRoomCreationIntent(id)).toBe(true); expect(consumeRoomCreationIntent(id)).toBe(false);
  expect(creation.documentId).not.toBe(documentId); expect(creation.checkpointSha256).toMatch(/^[a-f0-9]{64}$/); expect(JSON.stringify(creation)).not.toContain(credential);
  expect((host.data.get(`xdesign.project.${projectId}`) as { pencilDocument: PencilDocument }).pencilDocument.shared!.documentId).toBe(documentId);
  expect(editor.undo.canUndo).toBe(true); expect(deserializeGraph(useXDesign.getState().pencilDocument!.graph).getNode(nodeId)!.x).toBe(77);
  expect([...host.data.keys()].filter(key => key.startsWith('xdesign.roomGrants.'))).toEqual([roomGrantKey(id)]);
});
it('locks a reopened pending copy and recovers the original owner grant before enabling edits', async () => {
  const creation = await preparedCopy(); expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(() => session!.editor.updateNodeWithUndo(nodeId, { x: 2 })).toThrow('viewer'); await expect(controller!.connect(server)).rejects.toThrow('Finish creating');
  const original = host.invoke.getMockImplementation()!; host.invoke.mockImplementation((command, args) => command === 'xdesign_room_request' ? Promise.resolve(ownerGrant(creation)) : original(command, args));
  await controller!.publishCreation('z'.repeat(40), new AbortController().signal);
  expect(host.invoke).toHaveBeenCalledWith('xdesign_room_key_set', { serverUrl: server, documentId: null, secret: 'z'.repeat(40) });
  expect(host.invoke).toHaveBeenCalledWith('xdesign_room_key_set', { serverUrl: server, documentId: creation.documentId, secret: credential });
  expect(host.invoke.mock.calls.some(call => call[1]?.operation?.kind === 'create')).toBe(false); expect(await loadRoomGrants(creation.projectId)).toEqual([]); expect(controller!.snapshot.creation).toBeNull(); expect(usePencilWorkspace.getState().readOnly).toBe(false);
});
it('retains an accepted creation across owner keychain failure, profile failure and pending-removal failure', async () => {
  const creation = await preparedCopy(), original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command, args) => command === 'xdesign_room_request' ? Promise.resolve(ownerGrant(creation)) : command === 'xdesign_room_key_set' && args.documentId !== null ? Promise.reject({ status: 503, code: 'credential' }) : original(command, args));
  await expect(controller!.publishCreation('', new AbortController().signal)).rejects.toThrow('credential'); expect(await loadRoomGrants(creation.projectId)).toHaveLength(1); expect(usePencilWorkspace.getState().readOnly).toBe(true);
  host.invoke.mockImplementation((command, args) => command === 'xdesign_room_request' ? Promise.resolve(ownerGrant(creation)) : original(command, args));
  host.save.mockImplementationOnce(async () => { throw new Error('Profile disk full'); }); await expect(controller!.publishCreation('', new AbortController().signal)).rejects.toThrow('Profile disk full'); expect(await loadRoomGrants(creation.projectId)).toHaveLength(1);
  host.save.mockImplementation(async key => { if (key.startsWith('xdesign.roomGrants.')) throw new Error('Pending disk full'); }); await expect(controller!.publishCreation('', new AbortController().signal)).rejects.toThrow('Pending disk full'); expect(usePencilWorkspace.getState().readOnly).toBe(true);
  host.save.mockReset(); await controller!.publishCreation('', new AbortController().signal); expect(await loadRoomGrants(creation.projectId)).toEqual([]); expect(host.invoke.mock.calls.some(call => call[1]?.operation?.kind === 'create')).toBe(false);
});
it('only issues the pinned creation after a recognized missing receipt and preserves unknown outcomes', async () => {
  const creation = await preparedCopy(), original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command, args) => command === 'xdesign_room_request' ? args.operation.kind === 'recover' ? Promise.reject({ status: 404, code: 'http' }) : Promise.resolve(ownerGrant(creation)) : original(command, args));
  await expect(controller!.publishCreation('', new AbortController().signal)).rejects.toThrow('refused'); expect(host.invoke.mock.calls.some(call => call[1]?.operation?.kind === 'create')).toBe(false);
  host.invoke.mockImplementation((command, args) => command === 'xdesign_room_request' ? args.operation.kind === 'recover' ? Promise.reject({ status: 404, code: 'receipt' }) : Promise.reject({ status: 504, code: 'timeout' }) : original(command, args));
  await expect(controller!.publishCreation('', new AbortController().signal)).rejects.toThrow('unknown'); expect(await loadRoomGrants(creation.projectId)).toHaveLength(1);
  const sent = host.invoke.mock.calls.find(call => call[1]?.operation?.kind === 'create')![1].operation; expect(sent).toMatchObject({ requestId: creation.requestId, name: creation.name, ownerName: creation.ownerName, checkpoint: useXDesign.getState().pencilDocument!.shared!.checkpoint });
});
it('does not issue a changed saved checkpoint or a late creation on a different project', async () => {
  const creation = await preparedCopy(), original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command, args) => command === 'xdesign_room_request' ? Promise.reject({ status: 404, code: 'receipt' }) : original(command, args));
  peer.edit('Changed', graph => graph.updateNode(nodeId, { x: 999 })); const old = host.data.get(`xdesign.project.${creation.projectId}`) as { pencilDocument: PencilDocument };
  host.data.set(`xdesign.project.${creation.projectId}`, { ...old, pencilDocument: { ...old.pencilDocument, graph: serializeGraph(peer.graph), shared: encodeSharedCheckpoint(creation.documentId, peer.update()) } });
  await expect(controller!.publishCreation('', new AbortController().signal)).rejects.toThrow('changed'); expect(host.invoke.mock.calls.some(call => call[1]?.operation?.kind === 'create')).toBe(false);
  let release!: (value: string) => void; host.invoke.mockImplementation((command, args) => command === 'xdesign_room_open' ? new Promise(resolve => { release = resolve; }) : original(command, args));
  const work = controller!.publishCreation('', new AbortController().signal); await vi.waitFor(() => expect(release).toBeDefined()); useXDProjects.setState({ activeId: ulid() }); release('management_handle_001'); await expect(work).rejects.toThrow('no longer active'); expect(commands()).toContain('xdesign_room_close');
});
it('persists invitation identity before dispatch and recovers a lost reply without another membership', async () => {
  role = 'owner'; const room = await canvas(); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('online')); const original = host.invoke.getMockImplementation()!; let accepted: unknown;
  host.invoke.mockImplementation(async (command, args) => {
    if (command === 'xdesign_room_request' && args.operation.kind === 'invite') {
      const pending = (await loadRoomGrants(projectId))[0] as PendingRoomInvitation; expect(pending.requestId).toBe(args.operation.requestId);
      accepted = { version: 1, documentId, requestId: pending.requestId, actor: { id: member, name: 'Reviewer', role: 'viewer' }, credential }; throw { status: 504, code: 'timeout' };
    }
    if (command === 'xdesign_room_request' && args.operation.kind === 'recover') return accepted;
    return original(command, args);
  });
  await expect(room.invite('Reviewer', 'viewer')).rejects.toThrow('unknown'); const pending = (await loadRoomGrants(projectId))[0] as PendingRoomInvitation; expect(JSON.stringify(pending)).not.toContain(credential);
  await expect(room.invite('Reviewer', 'viewer')).rejects.toThrow('Recover or dismiss'); const grant = await room.recoverInvitation(pending); expect(grant.credential).toBe(credential);
  expect(host.invoke.mock.calls.filter(call => call[1]?.operation?.kind === 'invite')).toHaveLength(1); expect(commands().filter(command => command === 'xdesign_room_key_set')).toHaveLength(0); expect(await loadRoomGrants(projectId)).toHaveLength(1);
});
it('keeps revoked or changed invitations pending and rejects foreign recovery before dispatch', async () => {
  role = 'owner'; const room = await canvas(); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('online')); const original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command, args) => command === 'xdesign_room_request' && args.operation.kind === 'invite' ? Promise.resolve({ version: 1, documentId, requestId: args.operation.requestId, actor: { id: member, name: 'Reviewer', role: 'editor' }, credential }) : original(command, args));
  const result = await room.invite('Reviewer', 'editor'); host.invoke.mockImplementation((command, args) => command === 'xdesign_room_request' && args.operation.kind === 'recover' ? Promise.reject({ status: 410, code: 'http' }) : original(command, args));
  await expect(room.recoverInvitation(result.pending)).rejects.toThrow('refused'); await expect(room.recoverInvitation({ ...result.pending, ownerId: ulid() })).rejects.toThrow('another room owner'); expect(await loadRoomGrants(projectId)).toHaveLength(1);
});
it('refuses invitation dispatch when the pending save fails or finishes on a different active project', async () => {
  role = 'owner'; const room = await canvas(); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('online'));
  host.save.mockImplementation(async key => { if (key.startsWith('xdesign.roomGrants.')) throw new Error('Disk full'); });
  await expect(room.invite('Reviewer', 'viewer')).rejects.toThrow('Disk full'); expect(await loadRoomGrants(projectId)).toEqual([]);
  let release!: () => void; host.save.mockImplementation(key => key.startsWith('xdesign.roomGrants.') ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve());
  const pending = room.invite('Reviewer', 'viewer'); await vi.waitFor(() => expect(release).toBeDefined()); useXDProjects.setState({ activeId: ulid() }); release(); await expect(pending).rejects.toThrow('no longer active');
  expect(host.invoke.mock.calls.some(call => call[1]?.operation?.kind === 'invite')).toBe(false); expect(await loadRoomGrants(projectId)).toHaveLength(1);
});
async function linkedPhotoCanvas() {
  const photoId = ulid(), version = ulid();
  const photo = { id: photoId, version, name: 'Layered PSD', width: 20, height: 20, previewWidth: 20, previewHeight: 20, bundlePath: `/source/${projectId}/${photoId}/${version}.pcraft`, previewPath: `/source/${projectId}/${photoId}/${version}.png`, originalPath: '/original.psd' };
  peer.edit('Linked PSD', graph => graph.updateNode(nodeId, { pluginData: [{ pluginId: 'orion.xdesign', key: 'photoDocumentId', value: photoId }] }));
  const old = useXDesign.getState().pencilDocument!; useXDesign.setState({ photoDocuments: { [photoId]: photo }, pencilDocument: { ...old, graph: serializeGraph(peer.graph), shared: encodeSharedCheckpoint(documentId, peer.update()), photoLinks: { [nodeId]: photoId } } });
  await canvas(); return photo;
}
it('copies project-scoped layered assets before committing the shared copy and preserves the original PSD link', async () => {
  const photo = await linkedPhotoCanvas(), original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command, args) => {
    if (command === 'xdesign_project_clone') { const doc = structuredClone(args.document); doc.photoDocuments[photo.id] = { ...photo, bundlePath: `/copy/${args.projectId}/${photo.id}/${photo.version}.pcraft`, previewPath: `/copy/${args.projectId}/${photo.id}/${photo.version}.png`, originalPath: null }; return Promise.resolve({ document: doc }); }
    return original(command, args);
  });
  const id = await prepareSharedRoom(server, 'Shared PSD', 'Owner', new AbortController().signal);
  expect(host.invoke).toHaveBeenCalledWith('xdesign_project_clone', expect.objectContaining({ sourceProjectId: projectId, projectId: id }));
  expect(useXDesign.getState().pencilDocument!.photoLinks[nodeId]).toBe(photo.id); expect(useXDesign.getState().photoDocuments[photo.id]!.bundlePath).toContain(`/copy/${id}/`);
  expect((host.data.get(`xdesign.project.${projectId}`) as { photoDocuments: unknown }).photoDocuments).toEqual({ [photo.id]: photo }); expect(await loadRoomGrants(id)).toHaveLength(1);
  expect(host.invoke.mock.calls.some(call => call[1]?.operation)).toBe(false);
});
it('preserves the source project and creates no pending handoff when layered asset copying fails', async () => {
  const photo = await linkedPhotoCanvas(), original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command, args) => command === 'xdesign_project_clone' ? Promise.reject(new Error('Layered asset missing')) : original(command, args));
  await expect(prepareSharedRoom(server, 'Shared PSD', 'Owner', new AbortController().signal)).rejects.toThrow('Layered asset missing');
  expect(useXDProjects.getState().activeId).toBe(projectId); expect(useXDesign.getState().photoDocuments[photo.id]).toEqual(photo); expect(host.atomic).not.toHaveBeenCalled(); expect([...host.data.keys()].some(key => key.startsWith('xdesign.roomGrants.'))).toBe(false);
});
afterEach(async () => { controller?.dispose(); controller = undefined; session?.dispose(); session = undefined; peer.dispose(); for (let i = 0; i < 20; i++) await Promise.resolve(); for (const root of presenceRoots.splice(0)) root.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function canvas(savedRole: 'owner' | 'editor' | 'viewer' = 'editor', element?: HTMLElement) {
  session = await openPencilSession(element ?? document.createElement('div'), useXDesign.getState().pencilDocument!, () => {});
  controller = new CanvasRoomSession(session.editor, session.shared!, documentId, projectId, { documentId, serverUrl: server, revision: 1, role: savedRole }, null, element); return controller;
}
it('keeps saved shared opening local and applies the viewer role before any native operation', async () => {
  await canvas('viewer'); expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(commands()).toEqual([]);
  expect(() => session!.editor.updateNodeWithUndo(nodeId, { x: 99 })).toThrow('viewer'); expect(session!.editor.graph.getNode(nodeId)!.x).toBe(10);
});
it('joins into an atomic new project after saving the accepted shared source, with a one-use connection intent', async () => {
  await canvas(); session!.editor.updateNodeWithUndo(nodeId, { x: 88 }); peer.edit('Remote', graph => graph.updateNode(nodeId, { width: 220 }));
  const imported = await joinSharedRoom(server, documentId, 'Joined project', credential, new AbortController().signal);
  expect(imported).not.toBe(projectId); expect(useXDProjects.getState().activeId).toBe(imported); expect(host.atomic).toHaveBeenCalledOnce();
  const old = host.data.get(`xdesign.project.${projectId}`) as { pencilDocument: PencilDocument }; expect(deserializeGraph(old.pencilDocument.graph).getNode(nodeId)!.x).toBe(88);
  const joined = useXDesign.getState().pencilDocument!; expect(deserializeGraph(joined.graph).getNode(nodeId)!.width).toBe(220); const restored = restoreSharedDesign(joined); try { expect(restored.graph.getNode(nodeId)!.width).toBe(220); } finally { restored.dispose(); }
  expect(JSON.stringify(joined)).not.toContain(credential); expect(consumeRoomJoinIntent(imported)).toBe(true); expect(consumeRoomJoinIntent(imported)).toBe(false); expect(commands()).toContain('xdesign_room_close');
});
it('preserves the active document and registry when the new project transaction fails', async () => {
  const original = useXDesign.getState().pencilDocument; host.atomic.mockRejectedValueOnce(new Error('Disk full'));
  await expect(joinSharedRoom(server, documentId, 'Joined project', '', new AbortController().signal)).rejects.toThrow('Disk full');
  expect(useXDProjects.getState().activeId).toBe(projectId); expect(useXDProjects.getState().registry).toHaveLength(1); expect(useXDesign.getState().pencilDocument).toBe(original); expect(useXDProjects.getState().transitioning).toBe(false);
});
it('rejects a server rollback before importing or changing its saved role', async () => {
  host.data.set('xdesign.rooms', { version: 1, rooms: [{ documentId, serverUrl: server, revision: 8, role: 'viewer' }] });
  await expect(joinSharedRoom(server, documentId, 'Joined project', '', new AbortController().signal)).rejects.toThrow('older revision'); expect(host.atomic).not.toHaveBeenCalled(); expect(useXDProjects.getState().activeId).toBe(projectId); expect((host.data.get('xdesign.rooms') as { rooms: { role: string }[] }).rooms[0]!.role).toBe('viewer');
});
async function rejectedUpload(room = controller!) {
  await room.connect(server);await vi.waitFor(()=>expect(room.snapshot.connection?.phase).toBe('online'));
  const original=host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command,args)=>command==='xdesign_room_request'&&args.operation?.kind==='sync'&&args.operation.message.type==='update'?Promise.reject({status:403,code:'comments',message:'Upload rejected'}):original(command,args));
  session!.editor.updateNodeWithUndo(nodeId,{x:99});await vi.waitFor(()=>expect(room.snapshot.connection?.phase).toBe('error'));expect(room.snapshot.connection?.unsent).toBe(true);
  return room;
}
it('saves an independent editable recovery project and preserves the original shared checkpoint and pending requests',async()=>{
  const room=await rejectedUpload(await canvas()),pendingKey=`xdesign.roomComments.${projectId}`,pending={version:999,unrecognized:'preserved'};host.data.set(pendingKey,pending);
  const id=await room.recoverProject('local',new AbortController().signal),local=useXDesign.getState().pencilDocument!;
  expect(id).not.toBe(projectId);expect(local.shared).toBeUndefined();expect(deserializeGraph(local.graph).getNode(nodeId)!.x).toBe(99);expect(consumeRoomJoinIntent(id)).toBe(false);
  const old=host.data.get(`xdesign.project.${projectId}`) as {pencilDocument:PencilDocument};const original=restoreSharedDesign(old.pencilDocument);try{expect(original.graph.getNode(nodeId)!.x).toBe(99);}finally{original.dispose();}
  expect(host.data.get(pendingKey)).toEqual(pending);expect(commands().filter(command=>command==='xdesign_project_clone')).toEqual([]);
  controller!.dispose();session!.dispose();controller=undefined;session=await openPencilSession(document.createElement('div'),local,()=>{});
  expect(session.shared).toBeUndefined();expect(usePencilWorkspace.getState().readOnly).toBe(false);session.editor.updateNodeWithUndo(nodeId,{y:77});expect(session.editor.graph.getNode(nodeId)!.y).toBe(77);
});
it('opens the fresh shared checkpoint in a new project without merging rejected local operations',async()=>{
  const room=await rejectedUpload(await canvas());peer.edit('Remote resize',graph=>graph.updateNode(nodeId,{width:220}));revision++;
  const uploads=host.invoke.mock.calls.filter(call=>call[1]?.operation?.message?.type==='update').length,id=await room.recoverProject('latest',new AbortController().signal);
  const fresh=restoreSharedDesign(useXDesign.getState().pencilDocument!);try{expect(fresh.graph.getNode(nodeId)).toMatchObject({x:10,width:220});}finally{fresh.dispose();}
  expect((host.data.get(`xdesign.project.${projectId}`) as {pencilDocument:PencilDocument}).pencilDocument.shared).toBeDefined();expect(consumeRoomJoinIntent(id)).toBe(true);
  expect(host.invoke.mock.calls.filter(call=>call[1]?.operation?.message?.type==='update')).toHaveLength(uploads);expect(commands()).not.toContain('xdesign_room_key_set');
});
it.each(['local','latest'] as const)('preserves the source and its access after failed %s recovery persistence',async kind=>{
  const room=await rejectedUpload(await canvas()),source=useXDesign.getState().pencilDocument;host.atomic.mockRejectedValueOnce(new Error('Disk full'));
  await expect(room.recoverProject(kind,new AbortController().signal)).rejects.toThrow('Disk full');expect(useXDProjects.getState().activeId).toBe(projectId);expect(useXDProjects.getState().registry).toHaveLength(1);expect(useXDesign.getState().pencilDocument).toBe(source);expect(usePencilWorkspace.getState().readOnly).toBe(false);expect(room.snapshot.opening).toBe(false);expect(room.snapshot.connection).toMatchObject({phase:'disconnected',unsent:true});
});
it('refuses a recovery response from another membership before creating a project or changing preference',async()=>{
  const room=await rejectedUpload(await canvas()),original=host.invoke.getMockImplementation()!,saved=structuredClone(host.data.get('xdesign.rooms'));
  host.invoke.mockImplementation(async(command,args)=>{const response=await original(command,args);return command==='xdesign_room_request'&&args.operation?.kind==='sync'?{...response,actor:{id:'another_member_0001',name:'Another',role:'owner'}}:response;});
  await expect(room.recoverProject('latest',new AbortController().signal)).rejects.toThrow('different membership');expect(host.atomic).not.toHaveBeenCalled();expect(host.data.get('xdesign.rooms')).toEqual(saved);expect(useXDProjects.getState().activeId).toBe(projectId);
});
it('pins the live connection revision even when the saved preference is older',async()=>{
  const room=await rejectedUpload(await canvas());host.data.set('xdesign.rooms',{version:1,rooms:[{documentId,serverUrl:server,revision:1,role:'editor'}]});revision=2;
  await expect(room.recoverProject('latest',new AbortController().signal)).rejects.toThrow('older revision');expect(host.atomic).not.toHaveBeenCalled();expect(session!.editor.graph.getNode(nodeId)!.x).toBe(99);
});
it('cancels late recovery reads after navigation and closes their handle without importing',async()=>{
  const room=await rejectedUpload(await canvas()),original=host.invoke.getMockImplementation()!;let release!:(value:unknown)=>void,outgoing!:RoomRequest;
  host.invoke.mockImplementation((command,args)=>{if(command==='xdesign_room_request'&&args.operation?.kind==='sync'){outgoing=args.operation.message;return new Promise(resolve=>{release=resolve;});}return original(command,args);});
  const work=room.recoverProject('latest',new AbortController().signal);await vi.waitFor(()=>expect(release).toBeDefined());useXDProjects.setState({activeId:ulid()});release(reply(outgoing));
  await expect(work).rejects.toThrow('no longer active');expect(host.atomic).not.toHaveBeenCalled();expect(commands()).toContain('xdesign_room_close');expect(useXDProjects.getState().registry).toHaveLength(1);
});
it('aborts recovery without dropping its local checkpoint and blocks duplicate room operations',async()=>{
  const room=await rejectedUpload(await canvas()),original=host.invoke.getMockImplementation()!;let release!:(value:unknown)=>void,outgoing!:RoomRequest;
  host.invoke.mockImplementation((command,args)=>{if(command==='xdesign_room_request'&&args.operation?.kind==='sync'){outgoing=args.operation.message;return new Promise(resolve=>{release=resolve;});}return original(command,args);});
  const signal=new AbortController(),work=room.recoverProject('latest',signal.signal);await vi.waitFor(()=>expect(release).toBeDefined());await expect(room.recoverProject('local',new AbortController().signal)).rejects.toThrow();expect(()=>room.retry()).toThrow();
  signal.abort();release(reply(outgoing));await expect(work).rejects.toThrow();expect(host.atomic).not.toHaveBeenCalled();expect(useXDProjects.getState().activeId).toBe(projectId);expect(session!.editor.graph.getNode(nodeId)!.x).toBe(99);expect(room.snapshot.opening).toBe(false);expect(usePencilWorkspace.getState().readOnly).toBe(false);expect(commands()).toContain('xdesign_room_cancel');
});
it('copies linked PSD assets into a detached local recovery project before committing',async()=>{
  const photo=await linkedPhotoCanvas(),room=await rejectedUpload(),original=host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command,args)=>{if(command==='xdesign_project_clone'){const document=structuredClone(args.document);document.photoDocuments[photo.id]={...photo,bundlePath:`/copy/${args.projectId}/${photo.id}/${photo.version}.pcraft`,previewPath:`/copy/${args.projectId}/${photo.id}/${photo.version}.png`,originalPath:null};return Promise.resolve({document});}return original(command,args);});
  const id=await room.recoverProject('local',new AbortController().signal);expect(useXDesign.getState().pencilDocument!.shared).toBeUndefined();expect(useXDesign.getState().pencilDocument!.photoLinks[nodeId]).toBe(photo.id);expect(useXDesign.getState().photoDocuments[photo.id]!.bundlePath).toContain(`/copy/${id}/`);expect((host.data.get(`xdesign.project.${projectId}`) as {photoDocuments:unknown}).photoDocuments).toEqual({[photo.id]:photo});
});
it('preserves layered source assets and read access if local recovery cloning fails',async()=>{
  const photo=await linkedPhotoCanvas(),room=await rejectedUpload(),original=host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command,args)=>command==='xdesign_project_clone'?Promise.reject(new Error('Layered asset missing')):original(command,args));
  await expect(room.recoverProject('local',new AbortController().signal)).rejects.toThrow('Layered asset missing');expect(host.atomic).not.toHaveBeenCalled();expect(useXDesign.getState().photoDocuments[photo.id]).toEqual(photo);expect(useXDProjects.getState().activeId).toBe(projectId);expect(usePencilWorkspace.getState().readOnly).toBe(false);
});
it('keeps downgraded source artwork readonly after recovery failure and makes a successful detached copy editable',async()=>{
  const room=await canvas();session!.editor.updateNodeWithUndo(nodeId,{x:99});role='viewer';await room.connect(server);await vi.waitFor(()=>expect(room.snapshot.connection?.phase).toBe('readonly'));expect(room.snapshot.connection?.unsent).toBe(true);
  host.atomic.mockRejectedValueOnce(new Error('Disk full'));await expect(room.recoverProject('local',new AbortController().signal)).rejects.toThrow('Disk full');expect(usePencilWorkspace.getState().readOnly).toBe(true);expect(()=>session!.editor.updateNodeWithUndo(nodeId,{y:11})).toThrow('viewer');
  const id=await room.recoverProject('local',new AbortController().signal);expect(useXDProjects.getState().activeId).toBe(id);expect(useXDesign.getState().pencilDocument!.shared).toBeUndefined();
});
it('preserves bounded Unicode project names while refusing recovery during an active edit',async()=>{
  const room=await rejectedUpload(await canvas());useXDProjects.setState({registry:[{id:projectId,name:'A'+'🙂'.repeat(64),createdAt:0,updatedAt:0}]});usePencilWorkspace.setState({busy:true});
  await expect(room.recoverProject('local',new AbortController().signal)).rejects.toThrow('Finish the current edit');expect(host.atomic).not.toHaveBeenCalled();usePencilWorkspace.setState({busy:false});
  const id=await room.recoverProject('local',new AbortController().signal),name=useXDProjects.getState().registry.find(project=>project.id===id)!.name;
  expect(name.length).toBeLessThanOrEqual(128);expect(name).toBe('A'+'🙂'.repeat(49)+' local copy');
});
it('closes a late recovery handle before sending after the source canvas changes',async()=>{
  const room=await rejectedUpload(await canvas()),original=host.invoke.getMockImplementation()!;let release!:(handle:string)=>void;
  host.invoke.mockImplementation((command,args)=>command==='xdesign_room_open'?new Promise(resolve=>{release=resolve;}):original(command,args));
  const before=host.invoke.mock.calls.filter(call=>call[0]==='xdesign_room_request').length,work=room.recoverProject('latest',new AbortController().signal);await vi.waitFor(()=>expect(release).toBeDefined());useXDProjects.setState({activeId:ulid()});release('transport_handle_late_001');
  await expect(work).rejects.toThrow('no longer active');expect(host.invoke.mock.calls.filter(call=>call[0]==='xdesign_room_request')).toHaveLength(before);expect(host.invoke).toHaveBeenCalledWith('xdesign_room_close',{handle:'transport_handle_late_001'});expect(host.atomic).not.toHaveBeenCalled();
});
it('refuses a fresh recovery checkpoint that does not cover its advertised applied clocks',async()=>{
  const room=await rejectedUpload(await canvas()),original=host.invoke.getMockImplementation()!,incomplete=SharedDesign.fromUpdate(peer.update());incomplete.edit('Advertised only',graph=>graph.updateNode(nodeId,{height:555}));
  host.invoke.mockImplementation(async(command,args)=>{const response=await original(command,args);return command==='xdesign_room_request'&&args.operation?.kind==='sync'?{...response,vector:roomBinary(incomplete.stateVector(),true)}:response;});
  try{await expect(room.recoverProject('latest',new AbortController().signal)).rejects.toThrow('checkpoint is incomplete');}finally{incomplete.dispose();}
  expect(host.atomic).not.toHaveBeenCalled();expect(useXDProjects.getState().activeId).toBe(projectId);expect(session!.editor.graph.getNode(nodeId)!.x).toBe(99);expect(usePencilWorkspace.getState().readOnly).toBe(false);
});
it('connects and disconnects without remounting or discarding selective local undo', async () => {
  const room = await canvas(); const editor = session!.editor; editor.updateNodeWithUndo(nodeId, { x: 60 }); peer.edit('Peer width', graph => graph.updateNode(nodeId, { width: 250 }));
  await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('online')); expect(session!.editor).toBe(editor); expect(usePencilWorkspace.getState().readOnly).toBe(false);
  room.disconnect(); expect(room.snapshot.connection?.phase).toBe('disconnected'); editor.undoAction(); expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 10, width: 250 }); editor.redoAction(); expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 60, width: 250 }); expect(currentPencilSnapshot()!.shared).toBeDefined();
});
it('receives viewer peer artwork and refuses all local uploads', async () => {
  role = 'viewer'; const room = await canvas(); peer.edit('Peer width', graph => graph.updateNode(nodeId, { width: 310 })); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('readonly'));
  expect(session!.editor.graph.getNode(nodeId)!.width).toBe(310); expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(() => session!.editor.updateNodeWithUndo(nodeId, { x: 500 })).toThrow('viewer');
  expect(host.invoke.mock.calls.filter(call => call[0] === 'xdesign_room_request').every(call => call[1].operation.message.type === 'sync')).toBe(true); room.disconnect(); expect(usePencilWorkspace.getState().readOnly).toBe(true);
});
it('restores the saved offline role and selective history when connection setup fails', async () => {
  const room = await canvas('editor'); session!.editor.updateNodeWithUndo(nodeId, { x: 66 }); const original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command, args) => command === 'xdesign_room_key_status' ? Promise.resolve(false) : original(command, args));
  await expect(room.connect(server)).rejects.toThrow('credential'); expect(usePencilWorkspace.getState().readOnly).toBe(false); expect(room.snapshot.opening).toBe(false); expect(room.snapshot.error).toContain('credential');
  session!.editor.undoAction(); expect(session!.editor.graph.getNode(nodeId)!.x).toBe(10);
});
it('closes a late owner-management handle before it can mutate a different active project', async () => {
  role = 'owner'; const room = await canvas(); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('online'));
  let release!: (value: string) => void; const original = host.invoke.getMockImplementation()!; host.invoke.mockImplementation((command, args) => command === 'xdesign_room_open' ? new Promise(resolve => { release = resolve; }) : original(command, args));
  const work = room.changeMember('membership_identity_002', 'viewer'); await vi.waitFor(() => expect(release).toBeDefined()); useXDProjects.setState({ activeId: ulid() }); release('management_handle_001'); await expect(work).rejects.toThrow('no longer active');
  expect(host.invoke.mock.calls.some(call => call[1]?.operation?.kind === 'change')).toBe(false); expect(host.invoke).toHaveBeenCalledWith('xdesign_room_close', { handle: 'management_handle_001' });
});

function presenceElement() {
  const root = document.createElement('section'), wrap = document.createElement('div'), element = document.createElement('div'); root.className = 'xd-pencil'; root.append(wrap); wrap.append(element); document.body.append(root); presenceRoots.push(root);
  Object.defineProperties(element, { clientWidth: { value: 800, configurable: true }, clientHeight: { value: 600, configurable: true } });
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, width: 800, height: 600, left: 10, top: 20, right: 810, bottom: 620, toJSON: () => ({}) }); vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  return { root, wrap, element };
}
function presenceBridge(roster: () => PresencePeer[]) {
  const original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command, args) => {
    if (command === 'xdesign_room_request' && args.operation.kind === 'presence') {
      const message = readPresenceRequest(args.operation.message), actor = { id: member, name: 'Designer', role };
      return Promise.resolve({ version: 1, documentId, clientId: message.clientId, sequence: message.sequence, actor, peers: [...(message.state ? [{ clientId: message.clientId, sequence: message.sequence, expiresInMs: 15000, state: message.state, actor }] : []), ...roster()] });
    }
    return original(command, args);
  });
}
function collaborator(pageId = session!.editor.state.currentPageId): PresencePeer { return { clientId: 'remote_presence_001', sequence: 1, expiresInMs: 15000, actor: { id: 'remote_membership_001', name: 'Partner', role: 'editor' }, state: { pageId, cursor: [50, 60], selection: [nodeId], view: { center: [500, 400], zoom: .001, width: 800, height: 600 }, following: null } }; }
const presenceCalls = () => host.invoke.mock.calls.filter(call => call[0] === 'xdesign_room_request' && call[1]?.operation?.kind === 'presence');
it('starts presence only after authentication on a separate handle and publishes current cursor/view/selection without shared history', async () => {
  const { element, wrap } = presenceElement(), room = await canvas('editor', element); presenceBridge(() => [collaborator()]); expect(presenceCalls()).toEqual([]);
  await room.connect(server); await vi.waitFor(() => expect(room.snapshot.presence?.phase).toBe('online'));
  const artwork = host.invoke.mock.calls.find(call => call[0] === 'xdesign_room_request' && call[1].operation.kind === 'sync')!; expect(presenceCalls()[0]![1].handle).not.toBe(artwork[1].handle);
  const editor = session!.editor, graph = serializeGraph(editor.graph), checkpoint = new Uint8Array(session!.shared!.replica.update()); editor.select([nodeId]); editor.pan(30, 40); wrap.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 70, clientY: 100 }));
  await vi.waitFor(() => expect((presenceCalls().at(-1)![1].operation.message as PresenceRequest).state).toMatchObject({ cursor: [30, 40], selection: [nodeId], view: { center: [370, 260], zoom: 1 } }));
  expect(serializeGraph(editor.graph)).toBe(graph); expect(session!.shared!.replica.update()).toEqual(checkpoint); expect(editor.undo.canUndo).toBe(false);
  wrap.dispatchEvent(new Event('pointerleave')); await vi.waitFor(() => expect(presenceCalls().at(-1)![1].operation.message.state.cursor).toBeNull()); room.disconnect(); expect(room.snapshot.presence).toBeNull(); await vi.waitFor(() => expect(presenceCalls().some(call => call[1].operation.message.state === null)).toBe(true));
});
it('lets a viewer follow pages and sub-minimum fit zoom without changing graph/checkpoint/history and stops on local input or Image mode', async () => {
  role = 'viewer'; const { element, root } = presenceElement(), room = await canvas('viewer', element); let otherPageId = ''; peer.edit('Peer page', graph => { otherPageId = graph.createNode('CANVAS', graph.rootId, { name: 'Other page' }).id; });
  let remote: PresencePeer; presenceBridge(() => { remote ??= collaborator(otherPageId); return [remote]; }); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.presence?.phase).toBe('online'));
  const editor = session!.editor, graph = serializeGraph(editor.graph), checkpoint = new Uint8Array(session!.shared!.replica.update()); room.followPeer('remote_presence_001'); await vi.waitFor(() => expect(editor.state.currentPageId).toBe(otherPageId)); await vi.waitFor(() => expect(editor.state.zoom).toBeCloseTo(.001, 8));
  expect(editor.screenToCanvas(400, 300).x).toBeCloseTo(500, 8); expect(editor.screenToCanvas(400, 300).y).toBeCloseTo(400, 8); expect(serializeGraph(editor.graph)).toBe(graph); expect(session!.shared!.replica.update()).toEqual(checkpoint); expect(editor.undo.canUndo).toBe(false); expect(usePencilWorkspace.getState().readOnly).toBe(true);
  root.dispatchEvent(new Event('wheel', { bubbles: true })); expect(room.snapshot.presence?.following).toBeNull(); room.followPeer(remote!.clientId); root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); expect(room.snapshot.presence?.following).toBeNull(); room.followPeer(remote!.clientId); usePhotoWorkspace.setState({ shapeId: 'opened-image' }); expect(room.snapshot.presence?.following).toBeNull(); await vi.waitFor(() => expect(presenceCalls().at(-1)![1].operation.message.state).toBeNull());
});
it('keeps artwork synchronization usable when presence refuses a response and retries with the same increasing identity', async () => {
  const { element } = presenceElement(), room = await canvas('editor', element); presenceBridge(() => [collaborator()]); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.presence?.phase).toBe('online'));
  const identity = room.snapshot.presence!.clientId, sequence = presenceCalls().at(-1)![1].operation.message.sequence; const original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation((command, args) => command === 'xdesign_room_request' && args.operation.kind === 'presence' && args.operation.message.state ? Promise.resolve({ wrong: true }) : original(command, args)); await vi.waitFor(() => expect(room.snapshot.presence?.phase).toBe('error'));
  session!.editor.updateNodeWithUndo(nodeId, { x: 77 }); await vi.waitFor(() => expect(peer.graph.getNode(nodeId)!.x).toBe(77)); expect(room.snapshot.connection?.phase).toBe('online');
  host.invoke.mockImplementation(original); room.retryPresence(); await vi.waitFor(() => expect(room.snapshot.presence?.phase).toBe('online')); expect(room.snapshot.presence!.clientId).toBe(identity); expect(presenceCalls().at(-1)![1].operation.message.sequence).toBeGreaterThan(sequence);
});
it('aborts a pending follow page and suppresses its late viewport when the user stops following', async () => {
  const { element } = presenceElement(), room = await canvas('editor', element); let otherPageId = ''; peer.edit('Peer page', graph => { otherPageId = graph.createNode('CANVAS', graph.rootId, { name: 'Other page' }).id; }); presenceBridge(() => [collaborator(otherPageId)]); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.presence?.phase).toBe('online'));
  const editor = session!.editor, page = editor.state.currentPageId, zoom = editor.state.zoom; let release!: () => void, signal: AbortSignal | undefined; const pending = new Promise<void>(resolve => { release = resolve; }), original = editor.switchPage;
  vi.spyOn(editor, 'switchPage').mockImplementation(async (id, options) => { signal = options?.signal; await pending; if (!signal?.aborted) await original(id, options); });
  room.followPeer('remote_presence_001'); expect(signal?.aborted).toBe(false); room.stopFollowing(); expect(signal?.aborted).toBe(true); release(); await pending; for (let i = 0; i < 20; i++) await Promise.resolve(); expect(editor.state.currentPageId).toBe(page); expect(editor.state.zoom).toBe(zoom); expect(room.snapshot.presence?.following).toBeNull();
});
it('refuses missing/internal/cyclic follow targets and stops on expiry rather than retaining a ghost collaborator', async () => {
  const { element } = presenceElement(), room = await canvas('editor', element); let remote: PresencePeer; presenceBridge(() => [remote ??= collaborator()]); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.presence?.phase).toBe('online'));
  remote!.sequence++; remote!.state.following = room.snapshot.presence!.clientId; await vi.waitFor(() => expect(room.snapshot.presence!.peers[0]!.sequence).toBe(remote!.sequence)); expect(() => room.followPeer(remote!.clientId)).toThrow('unavailable');
  remote!.sequence++; remote!.state.following = null; remote!.state.pageId = 'missing'; await vi.waitFor(() => expect(room.snapshot.presence!.peers[0]!.sequence).toBe(remote!.sequence)); expect(() => room.followPeer(remote!.clientId)).toThrow('unavailable');
  remote!.sequence++; remote!.state.pageId = session!.editor.state.currentPageId; remote!.expiresInMs = 150; await vi.waitFor(() => expect(room.snapshot.presence!.peers[0]!.sequence).toBe(remote!.sequence)); room.followPeer(remote!.clientId); await vi.waitFor(() => expect(room.snapshot.presence?.following).toBeNull()); expect(room.snapshot.presence!.peers).toEqual([]);
});
it('closes a late presence handle without dispatch when the project changes while it is opening', async () => {
  const { element } = presenceElement(), room = await canvas('editor', element), original = host.invoke.getMockImplementation()!; let release!: (value: string) => void;
  host.invoke.mockImplementation((command, args) => command === 'xdesign_room_open' && handle === 1 ? new Promise(resolve => { release = resolve; }) : original(command, args)); await room.connect(server); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  useXDProjects.setState({ activeId: ulid() }); release('late_presence_handle'); await vi.waitFor(() => expect(host.invoke).toHaveBeenCalledWith('xdesign_room_close', { handle: 'late_presence_handle' })); expect(presenceCalls()).toEqual([]);
});
function historyBridge(loseHistoryReply=false) {
  const original=host.invoke.getMockImplementation()!, records=new Map<string,{entry:RoomCommentHistoryEntry;record:CommentHistoryRecord}>(),receipts=new Map<string,{result:RoomCommentResult;revision:number}>();
  host.invoke.mockImplementation(async(command,args)=>{
    if(command!=='xdesign_room_request')return original(command,args);
    if(args.operation.kind==='commentHistory')return{version:1,documentId,actor:{id:member,name:'Designer',role},entries:[...records.values()].map(value=>value.entry).filter(entry=>entry.id<(args.operation.before??Number.MAX_SAFE_INTEGER)).sort((a,b)=>b.id-a.id),next:null};
    if(args.operation.kind!=='comment')return original(command,args);
    const packet=readRoomCommentRequest(args.operation.message).packet,key=JSON.stringify([packet.clientId,packet.requestId]);let receipt=receipts.get(key);
    if(!receipt){
      if(args.operation.recoverOnly)throw{status:404,code:'receipt'};
      expect((await loadPendingRoomComment(projectId))!.packet).toEqual(packet);const command=packet.command;
      let result:RoomCommentResult;
      if(command.type==='history'){
        const value=records.get(JSON.stringify([command.sourceClientId,command.sourceRequestId]));if(!value||value.entry.step!==command.step)throw{status:409,code:'conflict'};
        peer.edit('Server history',graph=>replayCommentHistory(graph,value.record,command.direction));revision++;value.entry={...value.entry,undone:command.direction==='undo',step:value.entry.step+1,revision};result={threadId:command.threadId};
      }else{
        result={threadId:command.type==='add'?`thread_${packet.requestId}`:command.threadId,...(['add','reply'].includes(command.type)?{messageId:`message_${packet.requestId}`}:'messageId' in command?{messageId:command.messageId}:{})};const before=commentHistorySnapshot(peer.graph,result.threadId);
        peer.edit('Server action',graph=>applyRoomCommentCommand(graph,command,{id:member,name:'Designer',role},result,1000));revision++;records.set(key,{entry:{id:records.size+1,clientId:packet.clientId,requestId:packet.requestId,threadId:result.threadId,action:command.type,undone:false,step:0,revision},record:{version:1,actorId:member,command,result,before,after:commentHistorySnapshot(peer.graph,result.threadId)}});
      }
      receipt={result,revision};receipts.set(key,receipt);if(command.type==='history'&&loseHistoryReply){loseHistoryReply=false;throw{status:504,code:'timeout'};}
    }
    return{version:1,type:'comment',documentId,clientId:packet.clientId,requestId:packet.requestId,revision,acceptedRevision:receipt.revision,actor:{id:member,name:'Designer',role},vector:roomBinary(peer.stateVector(),true),update:roomBinary(peer.update()),result:receipt.result};
  });return records;
}
it('lists viewer history on a separate handle and restores original comments through durable semantic undo/redo without raw artwork history',async()=>{
  role='viewer';const room=await canvas('viewer');await room.connect(server);await vi.waitFor(()=>expect(room.snapshot.connection?.phase).toBe('readonly'));await vi.waitFor(()=>expect(room.snapshot.comments?.phase).toBe('ready'));historyBridge();expect(host.invoke.mock.calls.some(call=>call[1]?.operation?.kind==='commentHistory')).toBe(false);
  const page=session!.editor.state.currentPageId;await room.submitComment({type:'add',pageId:page,anchor:createCommentAnchor(session!.editor.graph,page,[{x:10,y:20}]),body:'Undo this comment'});const before=structuredClone(allComments(session!.editor.graph));await room.loadCommentHistory();const entry=room.snapshot.commentHistory!.entries[0]!;
  const sync=host.invoke.mock.calls.find(call=>call[1]?.operation?.kind==='sync')![1],history=host.invoke.mock.calls.find(call=>call[1]?.operation?.kind==='commentHistory')![1];expect(history.handle).not.toBe(sync.handle);expect(session!.editor.undo.canUndo).toBe(false);expect(usePencilWorkspace.getState().readOnly).toBe(true);
  await room.submitComment({type:'history',threadId:entry.threadId,sourceClientId:entry.clientId,sourceRequestId:entry.requestId,direction:'undo',step:entry.step});expect(allComments(session!.editor.graph)).toEqual([]);expect(room.snapshot.commentHistory!.entries).toEqual([]);await room.loadCommentHistory();const undone=room.snapshot.commentHistory!.entries[0]!;expect(undone).toMatchObject({undone:true,step:1});
  await room.submitComment({type:'history',threadId:undone.threadId,sourceClientId:undone.clientId,sourceRequestId:undone.requestId,direction:'redo',step:undone.step});expect(allComments(session!.editor.graph)).toEqual(before);expect(session!.editor.undo.canUndo).toBe(false);expect(usePencilWorkspace.getState().readOnly).toBe(true);expect(await loadPendingRoomComment(projectId)).toBeNull();expect((host.data.get(`xdesign.project.${projectId}`) as {pencilDocument:PencilDocument}).pencilDocument.shared).toBeDefined();
});
it('recovers a lost semantic undo reply after reopening without toggling the source action again',async()=>{
  role='viewer';let room=await canvas('viewer');await room.connect(server);await vi.waitFor(()=>expect(room.snapshot.connection?.phase).toBe('readonly'));await vi.waitFor(()=>expect(room.snapshot.comments?.phase).toBe('ready'));const records=historyBridge(true),page=session!.editor.state.currentPageId;
  await room.submitComment({type:'add',pageId:page,anchor:createCommentAnchor(session!.editor.graph,page,[{x:10,y:20}]),body:'Recover undo'});await room.loadCommentHistory();const entry=room.snapshot.commentHistory!.entries[0]!,action={type:'history' as const,threadId:entry.threadId,sourceClientId:entry.clientId,sourceRequestId:entry.requestId,direction:'undo' as const,step:entry.step};await expect(room.submitComment(action)).rejects.toThrow('unknown');const pending=await loadPendingRoomComment(projectId);expect(pending!.packet.command).toEqual(action);expect([...records.values()][0]!.entry).toMatchObject({undone:true,step:1});
  controller!.dispose();session!.dispose();room=await canvas('viewer');await room.connect(server);await vi.waitFor(()=>expect(room.snapshot.connection?.phase).toBe('readonly'));await vi.waitFor(()=>expect(room.snapshot.comments?.phase).toBe('pending'));const executed=()=>host.invoke.mock.calls.filter(call=>call[1]?.operation?.kind==='comment'&&!call[1].operation.recoverOnly&&call[1].operation.message.command.type==='history');expect(executed()).toHaveLength(1);
  await room.recoverComment();expect(executed()).toHaveLength(1);expect([...records.values()][0]!.entry.step).toBe(1);expect(allComments(session!.editor.graph)).toEqual([]);expect(await loadPendingRoomComment(projectId)).toBeNull();expect(room.snapshot.commentHistory!.phase).toBe('idle');
});
it('cancels a late native history page on disconnect and leaves artwork and history intact',async()=>{
  const room=await canvas();await room.connect(server);await vi.waitFor(()=>expect(room.snapshot.connection?.phase).toBe('online'));const original=host.invoke.getMockImplementation()!;let release!:(reply:unknown)=>void;
  host.invoke.mockImplementation((command,args)=>command==='xdesign_room_request'&&args.operation.kind==='commentHistory'?new Promise(resolve=>{release=resolve;}):original(command,args));const graph=serializeGraph(session!.editor.graph),work=room.loadCommentHistory();await vi.waitFor(()=>expect(release).toBeDefined());room.disconnect();release({version:1,documentId,actor:{id:member,name:'Designer',role},entries:[],next:null});await expect(work).rejects.toThrow();expect(room.snapshot.commentHistory).toMatchObject({phase:'idle',entries:[]});expect(serializeGraph(session!.editor.graph)).toBe(graph);expect(session!.editor.undo.canUndo).toBe(false);expect(commands()).toContain('xdesign_room_cancel');
});

function authorBridge(lose = false) {
  const original = host.invoke.getMockImplementation()!, receipts = new Map<string, unknown>(); let current = { authorId: 'legacy_author', memberId: null as string | null, step: 0 };
  host.invoke.mockImplementation(async (command, args) => {
    if (command !== 'xdesign_room_request') return original(command, args);
    const operation = args.operation, actor = { id: member, name: 'Designer', role };
    if (operation.kind === 'commentOwnership') return { version: 1, documentId, actor, authorIds: current.memberId === member ? [current.authorId] : [] };
    if (operation.kind === 'commentAuthors') return { version: 1, documentId, actor, authors: [{ ...current, name: 'Original' }] };
    if (operation.kind === 'recoverCommentAuthor') { const saved = receipts.get(operation.requestId); if (!saved) throw { status: 404, code: 'receipt' }; return { ...saved as object, current }; }
    if (operation.kind === 'assignCommentAuthor') {
      const request = operation.message, pending = (await loadRoomGrants(projectId))[0] as PendingRoomAuthorGrant; expect(pending.kind).toBe('author'); expect(pending.requestId).toBe(request.requestId); expect(pending.ownerId).toBe(member);
      current = { authorId: request.authorId, memberId: request.memberId, step: request.step + 1 }; const result = { version: 1, documentId, actor, requestId: request.requestId, assignment: { ...current }, current: { ...current } }; receipts.set(request.requestId, result); if (lose) { lose = false; throw { status: 504, code: 'timeout' }; } return result;
    }
    return original(command, args);
  }); return { receipts, supersede() { current = { ...current, memberId: null, step: current.step + 1 }; } };
}

it('routes global artwork/comment undo in chronological order and keeps peer resizing intact', async () => {
  const room = await canvas(); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('online')); await vi.waitFor(() => expect(room.snapshot.comments?.phase).toBe('ready')); historyBridge();
  const editor = session!.editor, page = editor.state.currentPageId;
  editor.updateNodeWithUndo(nodeId, { x: 60 }, 'First move'); await vi.waitFor(() => expect(peer.graph.getNode(nodeId)!.x).toBe(60));
  await room.submitComment({ type: 'add', pageId: page, anchor: createCommentAnchor(editor.graph, page, [{ x: 20, y: 30 }]), body: 'Between moves' });
  editor.updateNodeWithUndo(nodeId, { x: 90 }, 'Second move'); await vi.waitFor(() => expect(peer.graph.getNode(nodeId)!.x).toBe(90));
  peer.edit('Peer resize', graph => graph.updateNode(nodeId, { width: 310 })); revision++; await session!.shared!.receive(peer.update()); expect(editor.graph.getNode(nodeId)!.width).toBe(310);
  expect(room.snapshot.history).toMatchObject({ undoLabel: 'Second move', canUndo: true }); await room.replayHistory('undo'); expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 60, width: 310 });
  await room.replayHistory('undo'); expect(allComments(editor.graph)).toHaveLength(0); await room.replayHistory('undo'); expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 10, width: 310 });
  await room.replayHistory('redo'); await room.replayHistory('redo'); await room.replayHistory('redo'); expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 90, width: 310 }); expect(allComments(editor.graph)[0]!.messages[0]!.body).toBe('Between moves');
});
it('makes viewer comment history available to global undo without enabling artwork or losing original metadata', async () => {
  role = 'viewer'; const room = await canvas('viewer'); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('readonly')); await vi.waitFor(() => expect(room.snapshot.comments?.phase).toBe('ready')); historyBridge();
  const editor = session!.editor, page = editor.state.currentPageId;
  await room.submitComment({ type: 'add', pageId: page, anchor: createCommentAnchor(editor.graph, page, [{ x: 20, y: 30 }]), body: 'Viewer undo' }); const original = structuredClone(allComments(editor.graph));
  expect(room.snapshot.history).toMatchObject({ canUndo: true, undoLabel: 'Add comment' }); expect(editor.undo.canUndo).toBe(false);
  editor.undoAction(); await vi.waitFor(() => expect(allComments(editor.graph)).toHaveLength(0)); await vi.waitFor(() => expect(room.snapshot.history?.canRedo).toBe(true));
  editor.redoAction(); await vi.waitFor(() => expect(allComments(editor.graph)).toEqual(original)); expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(() => editor.updateNodeWithUndo(nodeId, { x: 333 })).toThrow('viewer');
});
it('keeps a lost global comment undo recoverable and prevents competing history or artwork during replay', async () => {
  const room = await canvas(); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('online')); await vi.waitFor(() => expect(room.snapshot.comments?.phase).toBe('ready')); const records = historyBridge(true);
  const editor = session!.editor, page = editor.state.currentPageId;
  await room.submitComment({ type: 'add', pageId: page, anchor: createCommentAnchor(editor.graph, page, [{ x: 20, y: 30 }]), body: 'Unknown undo' });
  await expect(room.replayHistory('undo')).rejects.toThrow('unknown'); expect(room.snapshot.history?.canUndo).toBe(false); await expect(room.replayHistory('undo')).rejects.toThrow('pending');
  expect([...records.values()][0]!.entry.step).toBe(1); await room.recoverComment(); expect(room.snapshot.history).toMatchObject({ undoLabel: null, redoLabel: 'Add comment', canRedo: true });
  let release!: () => void; host.save.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })); const work = room.replayHistory('redo'); await vi.waitFor(() => expect(release).toBeDefined());
  expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(() => editor.updateNodeWithUndo(nodeId, { x: 777 })).toThrow('viewer'); await expect(room.replayHistory('redo')).rejects.toThrow('pending');
  release(); await work; expect(usePencilWorkspace.getState().readOnly).toBe(false); expect(room.snapshot.history).toMatchObject({ canUndo: true, redoLabel: null }); expect([...records.values()][0]!.entry.step).toBe(2);
});
it('refreshes global availability after an asynchronous batch settles and restores original native actions on disposal', async () => {
  const room = await canvas(); await vi.waitFor(() => expect(room.snapshot.comments?.phase).toBe('ready')); const editor = session!.editor;
  let release!: () => void; const work = session!.shared!.transaction('Async artwork', async () => { editor.updateNodeWithUndo(nodeId, { x: 75 }); await new Promise<void>(resolve => { release = resolve; }); });
  expect(room.snapshot.history?.canUndo).toBe(false); release(); await work; expect(room.snapshot.history).toMatchObject({ canUndo: true, undoLabel: 'Async artwork' });
  const wrapper = editor.undoAction; room.dispose(); expect(editor.undoAction).not.toBe(wrapper); editor.undoAction(); expect(editor.graph.getNode(nodeId)!.x).toBe(10);
});
it('refreshes global availability when a committed interactive gesture releases without network activity', async () => {
  const room = await canvas(); await vi.waitFor(() => expect(room.snapshot.comments?.phase).toBe('ready')); const editor = session!.editor;
  const interactive = vi.spyOn(editor, 'isInteractiveEditing').mockReturnValue(true); editor.updateNodeWithUndo(nodeId, { x: 85 }, 'Gesture'); expect(room.snapshot.history?.canUndo).toBe(false);
  interactive.mockReturnValue(false); session!.shared!.flush(); expect(room.snapshot.history).toMatchObject({ canUndo: true, undoLabel: 'Gesture' }); await room.replayHistory('undo'); expect(editor.graph.getNode(nodeId)!.x).toBe(10); interactive.mockRestore();
});
it('persists original-author assignment before dispatch and recovers superseded results after reopening without regranting', async () => {
  role = 'owner'; let room = await canvas(); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('online')); const bridge = authorBridge(true);
  await expect(room.assignCommentAuthor({ authorId: 'legacy_author', name: 'Original', memberId: null, step: 0 }, member)).rejects.toThrow('unknown'); const pending = (await loadRoomGrants(projectId))[0] as PendingRoomAuthorGrant; expect(pending.kind).toBe('author'); expect(JSON.stringify(pending)).not.toContain(credential);
  bridge.supersede(); controller!.dispose(); session!.dispose(); room = await canvas(); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('online'));
  const result = await room.recoverCommentAuthor(pending); expect(result.assignment.memberId).toBe(member); expect(result.current.memberId).toBeNull(); expect(await loadRoomGrants(projectId)).toEqual([]); expect(host.invoke.mock.calls.filter(call => call[1]?.operation?.kind === 'assignCommentAuthor')).toHaveLength(1);
});
it('keeps failed assignment writes/outcomes recoverable and refuses foreign saved scope or duplicate work', async () => {
  role = 'owner'; const room = await canvas(); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('online')); authorBridge(true);
  await expect(room.assignCommentAuthor({ authorId: 'legacy_author', name: 'Original', memberId: null, step: 0 }, member)).rejects.toThrow(); const pending = (await loadRoomGrants(projectId))[0] as PendingRoomAuthorGrant;
  await expect(room.recoverCommentAuthor({ ...pending, ownerId: ulid() })).rejects.toThrow('another room owner'); host.save.mockRejectedValueOnce(new Error('Disk full')); await expect(room.recoverCommentAuthor(pending)).rejects.toThrow('Disk full'); expect(await loadRoomGrants(projectId)).toEqual([pending]);
  const original = host.invoke.getMockImplementation()!; let release!: (value: string) => void; host.invoke.mockImplementation((command, args) => command === 'xdesign_room_open' ? new Promise(resolve => { release = resolve; }) : original(command, args));
  const work = room.recoverCommentAuthor(pending); await vi.waitFor(() => expect(release).toBeDefined()); await expect(room.recoverCommentAuthor(pending)).rejects.toThrow('finish'); useXDProjects.setState({ activeId: ulid() }); release('late_author_handle_001'); await expect(work).rejects.toThrow('no longer active'); expect(await loadRoomGrants(projectId)).toEqual([pending]); expect(commands()).toContain('xdesign_room_close');
});
it('loads member-specific original-author rights on a separate handle while viewer artwork stays read-only', async () => {
  role = 'viewer'; const room = await canvas('viewer'); await room.connect(server); await vi.waitFor(() => expect(room.snapshot.connection?.phase).toBe('readonly')); const original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation(async (command, args) => command === 'xdesign_room_request' && args.operation.kind === 'commentOwnership' ? { version: 1, documentId, actor: { id: member, name: 'Designer', role }, authorIds: ['legacy_author'] } : original(command, args));
  await room.loadCommentOwnership(); expect(room.snapshot.commentOwnership?.authorIds).toEqual(['legacy_author']); expect(usePencilWorkspace.getState().readOnly).toBe(true);
  const sync = host.invoke.mock.calls.find(call => call[1]?.operation?.kind === 'sync')![1], ownership = host.invoke.mock.calls.find(call => call[1]?.operation?.kind === 'commentOwnership')![1]; expect(sync.handle).not.toBe(ownership.handle); room.disconnect(); expect(room.snapshot.commentOwnership?.authorIds).toEqual([]);
});

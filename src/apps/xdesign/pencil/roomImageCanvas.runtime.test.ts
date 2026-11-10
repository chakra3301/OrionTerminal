import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { ulid } from 'ulid';
import { SceneGraph } from '@open-pencil/scene-graph';
import { createDefaultEditorState, createEditor } from '@open-pencil/core/editor';
import { useXDesign } from '../store';
import { useXDProjects, emptyDoc, validateDesignDoc } from '../projectsStore';
import { useHtmlArtifact } from '../htmlArtifactStore';
import { usePhotoWorkspace } from '../photo/runtime';
import { xdesignProjectChangeReason } from '../runtimeActivity';
import { openPencilSession, currentPencilSnapshot, pencilPhotoDocumentId, commitPencilPhoto, editPencilImage, exportPencil, libraryRoomImageBytes, runPencilLibraryAction, usePencilWorkspace } from './runtime';
import { CanvasRoomSession, canvasRoomSession, prepareSharedRoom } from './roomSession';
import { SharedDesign } from './sharedDesign';
import { encodeSharedCheckpoint, restoreSharedDesign } from './sharedCheckpoint';
import { deserializeGraph, serializeGraph } from './document';
import { readRoomRequest, roomBinary } from './sharedRoomProtocol';
import { roomImagePluginData, readRoomImagePluginData } from './roomImageReferences';
import { imageClientFixture, imageProject, imageDocument, imageOrigin, imageActor } from './roomImages.testSupport';
import type { PhotoReply } from '../photo/types';

const host = vi.hoisted(() => ({ invoke: vi.fn(), data: new Map<string, unknown>(), fixture: null as Awaited<ReturnType<typeof imageClientFixture>> | null, failSave: false, failCommit: false }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: host.invoke, convertFileSrc: (path: string) => path }));
vi.mock('@/lib/db', () => ({
  getAppState: async (key: string) => structuredClone(host.data.get(key) ?? null),
  setXDesignStateAtomic: async (writes: { key: string; value: unknown }[]) => { if (host.failCommit) throw new Error('lost copy commit'); for (const write of writes) host.data.set(write.key, structuredClone(write.value)); },
  setAppState: async (key: string, value: unknown) => { if (key.startsWith('xdesign.project.') && host.failSave) { host.failSave = false; throw new Error('lost project save'); } host.data.set(key, structuredClone(value)); },
}));
vi.mock('./roomImageClient', async original => {
  const module = await original<typeof import('./roomImageClient')>();
  return { ...module, RoomImageClient: class extends module.RoomImageClient {
    constructor(documentId: string, projectId: string, options: import('./roomImageClient').RoomImageClientOptions) {
      super(documentId, projectId, { ...options, ...(host.fixture ? { pending: host.fixture.saved.reopen(), open: host.fixture.open } : {}) });
    }
  } };
});
let f: Awaited<ReturnType<typeof imageClientFixture>>, peer: SharedDesign, room: CanvasRoomSession | null, session: Awaited<ReturnType<typeof openPencilSession>> | null, nodeId: string, role: 'editor' | 'viewer';
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); host.fixture = null; f = await imageClientFixture(); host.fixture = f; host.data.clear(); host.failSave = false; host.failCommit = false; host.invoke.mockReset(); room = null; session = null; role = 'editor';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(f.preview)));
  useXDesign.getState().hydrate(emptyDoc()); useXDProjects.setState({ activeId: imageProject, ready: true, transitioning: false, registry: [{ id: imageProject, name: 'Shared image study', createdAt: 0, updatedAt: 0 }] }); useHtmlArtifact.getState().setProject(imageProject);
  usePencilWorkspace.setState({ editor: null, busy: false, readOnly: false, error: null }); usePhotoWorkspace.setState({ shapeId: null, busy: false, documentId: null });
  const graph = new SceneGraph(), pageId = graph.getPages()[0]!.id; graph.images.set(f.reference.previewHash, f.preview);
  nodeId = graph.createNode('RECTANGLE', pageId, { x: 81, width: 122, fills: [{ type: 'IMAGE', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true, imageHash: f.reference.previewHash, imageScaleMode: 'FIT' }], pluginData: [roomImagePluginData(f.reference)] }).id;
  peer = SharedDesign.fromGraph(graph); useXDesign.setState({ pencilDocument: { formatVersion: 1, graph: serializeGraph(graph), pageId, panX: 0, panY: 0, zoom: 1, photoLinks: {}, shared: encodeSharedCheckpoint(imageDocument, peer.update()) } });
  host.invoke.mockImplementation(async (command, args) => {
    if (command === 'xdesign_room_key_status') return true;
    if (command === 'xdesign_room_open') return 'room_image_native_handle_001';
    if (command === 'xdesign_room_request' && args.operation.kind === 'sync') {
      const packet = readRoomRequest(args.operation.message); if (packet.update) peer.receive(packet.update);
      return { ...args.operation.message, type: packet.packet.type === 'update' ? 'ack' : 'sync', revision: 1, actor: { ...imageActor, role }, vector: roomBinary(peer.stateVector(), true), update: roomBinary(peer.update(packet.vector)), ...(packet.packet.type === 'update' ? { acceptedRevision: 1 } : {}) };
    }
    if (command === 'xdesign_photo_render') return `/full-resolution/${args.photoId}/${args.version}.png`;
    if (command === 'xdesign_photo_open') {
      const document = useXDesign.getState().photoDocuments[args.photoId]!;
      return { document, warnings: [], state: { name: document.name, width: document.width, height: document.height, mode: 'Rgb', depth: 16, resolution: 72, activeLayer: null, hasSelection: false, selectionBounds: null, layers: [], canUndo: false, canRedo: false } } satisfies PhotoReply;
    }
  });
});
afterEach(async () => { room?.dispose(); session?.dispose(); peer.dispose(); f.dispose(); host.fixture = null; usePhotoWorkspace.setState({ shapeId: null, documentId: null, busy: false }); await Promise.resolve(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function canvas(connect = true) {
  session = await openPencilSession(document.createElement('div'), useXDesign.getState().pencilDocument!, () => {});
  room = new CanvasRoomSession(session.editor, session.shared!, imageDocument, imageProject, { documentId: imageDocument, serverUrl: imageOrigin, role, revision: 1 });
  await vi.waitFor(() => expect(room!.snapshot.images?.phase).toBe('ready'));
  if (connect) { await room.connect(imageOrigin); await vi.waitFor(() => expect(room!.snapshot.connection?.phase).toBe(role === 'viewer' ? 'readonly' : 'online')); }
  return room;
}
it('opens locally without downloading and binds a pinned native image only after an explicit hydration save', async () => {
  await canvas(false); expect(f.open).not.toHaveBeenCalled(); expect(pencilPhotoDocumentId(nodeId)).toBeNull();
  await room!.connect(imageOrigin); await vi.waitFor(() => expect(room!.snapshot.connection?.phase).toBe('online'));
  const before = serializeGraph(session!.editor.graph), photo = await room!.hydrateRoomImage(nodeId);
  expect(serializeGraph(session!.editor.graph)).toBe(before); expect(pencilPhotoDocumentId(nodeId)).toBe(photo.id); expect(f.allocations).toBe(1); expect(f.saved.value).toEqual({ version: 1, pending: null }); expect(f.files.size).toBe(0);
  const saved = host.data.get(`xdesign.project.${imageProject}`) as Parameters<typeof validateDesignDoc>[0]; validateDesignDoc(saved); expect(saved.pencilDocument!.roomImages!.bindings[0]!.photo).toEqual(photo);
  const restored = restoreSharedDesign(saved.pencilDocument!); try { expect(serializeGraph(restored.graph)).not.toContain(photo.bundlePath); } finally { restored.dispose(); }
  await room!.hydrateRoomImage(nodeId); expect(f.allocations).toBe(1); expect(f.transport.imageRevision).toHaveBeenCalledTimes(2);
});
it('double-click entry opens the original native document and stages edits without replacing the accepted shared preview', async () => {
  await canvas(); await editPencilImage(nodeId); const photoId = pencilPhotoDocumentId(nodeId)!;
  expect(host.invoke.mock.calls.find(call => call[0] === 'xdesign_photo_open')![1]).toMatchObject({ photoId, version: f.source.version, sourceData: null });
  const before = serializeGraph(session!.editor.graph), latest = { ...useXDesign.getState().photoDocuments[photoId]!, version: ulid(), name: 'Unpublished draft' };
  await commitPencilPhoto(latest, nodeId); expect(serializeGraph(session!.editor.graph)).toBe(before); expect(useXDesign.getState().photoDocuments[photoId]).toEqual(latest); expect(currentPencilSnapshot()!.roomImages!.bindings[0]!.photo.version).toBe(f.source.version);
});
it('retains the native receipt on failed project save and recovers without allocating or applying a second image', async () => {
  await canvas(); host.failSave = true; await expect(room!.hydrateRoomImage(nodeId)).rejects.toThrow('lost project save'); expect(f.allocations).toBe(1); expect(room!.snapshot.images!.pending!.complete).toBe(true); expect(f.files.size).toBe(1);
  const id = pencilPhotoDocumentId(nodeId); await room!.recoverCanvasImage(); expect(pencilPhotoDocumentId(nodeId)).toBe(id); expect(f.allocations).toBe(1); expect(f.files.size).toBe(0); expect(room!.snapshot.images!.pending).toBeNull();
});
it('preserves imported artwork when the selected placement changes during transfer and blocks competing actions/project switches', async () => {
  await canvas(); const original = f.transport.importImageFile; let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  f.transport.importImageFile = vi.fn(async (scope, manifest, signal) => { await gate; return original(scope, manifest, signal); });
  const work = room!.hydrateRoomImage(nodeId);
  try {
    await vi.waitFor(() => expect(f.transport.importImageFile).toHaveBeenCalledOnce()); expect(xdesignProjectChangeReason()).toContain('shared image');
    await expect(room!.hydrateRoomImage(nodeId)).rejects.toThrow('current design action');
    session!.editor.graph.updateNode(nodeId, { pluginData: [roomImagePluginData({ ...f.reference, revisionId: 'b'.repeat(64) })] });
  } finally { release(); await work; }
  expect(pencilPhotoDocumentId(nodeId)).toBeNull(); expect(currentPencilSnapshot()!.roomImages!.bindings).toHaveLength(1); expect(Object.keys(useXDesign.getState().photoDocuments)).toHaveLength(1); expect(xdesignProjectChangeReason()).toBeNull();
});
it('supports viewer hydration and accepted recovery without granting image artwork edits', async () => {
  role = 'viewer'; f.context = { ...f.context!, actor: { ...imageActor, role } }; await canvas();
  const before = serializeGraph(session!.editor.graph), photo = await room!.hydrateRoomImage(nodeId); expect(pencilPhotoDocumentId(nodeId)).toBe(photo.id); expect(serializeGraph(session!.editor.graph)).toBe(before);
  await expect(editPencilImage(nodeId)).rejects.toThrow('viewer'); await expect(room!.reviewCanvasImage(nodeId)).rejects.toThrow('editor or owner'); expect(f.transport.beginImage).not.toHaveBeenCalled();
});
it('reviews a local source before publication, converts its placements, and replays only the original save after lost cleanup', async () => {
  await canvas(); const editor = session!.editor;
  editor.graph.updateNode(nodeId, { pluginData: [{ pluginId: 'orion.xdesign', key: 'photoDocumentId', value: f.source.id }] }); useXDesign.setState({ photoDocuments: { [f.source.id]: f.source } });
  const draft = await room!.reviewCanvasImage(nodeId); expect(f.transport.beginImage).not.toHaveBeenCalled(); expect(room!.snapshot.images!.pending!.approved).toBe(false);
  f.loseDiscard = true; await expect(room!.publishCanvasImage(draft)).rejects.toThrow('lost native image discard');
  expect(readRoomImagePluginData(editor.graph.getNode(nodeId)!.pluginData)!.revisionId).toBe(draft.manifest.revisionId); expect(editor.graph.getNode(nodeId)).toMatchObject({ x: 81, width: 122 });
  const snapshot = currentPencilSnapshot(), history = editor.undo.canUndo; await room!.recoverCanvasImage(); expect(currentPencilSnapshot()).toEqual(snapshot); expect(editor.undo.canUndo).toBe(history); expect(f.transport.commitImage).toHaveBeenCalledOnce(); expect(room!.snapshot.images!.pending).toBeNull();
  editor.undoAction(); expect(editor.graph.getNode(nodeId)!.pluginData).toEqual([{ pluginId: 'orion.xdesign', key: 'photoDocumentId', value: f.source.id }]); editor.redoAction(); expect(readRoomImagePluginData(editor.graph.getNode(nodeId)!.pluginData)!.revisionId).toBe(draft.manifest.revisionId);
});
it('reopens persisted local mappings and disposes the original editor registration without flattening preview bytes', async () => {
  await canvas(); const photo = await room!.hydrateRoomImage(nodeId), doc = currentPencilSnapshot()!, oldEditor = session!.editor;
  room!.dispose(); session!.dispose(); expect(canvasRoomSession(oldEditor)).toBeNull(); useXDesign.setState({ pencilDocument: doc }); await canvas(false);
  expect(pencilPhotoDocumentId(nodeId)).toBe(photo.id); await editPencilImage(nodeId); expect(f.allocations).toBe(1); expect(usePhotoWorkspace.getState().documentId).toBe(photo.id);
});

it('exports the accepted full-resolution version without leaking unpublished edits or demanding unrelated shared downloads', async () => {
  await canvas(); const photo = await room!.hydrateRoomImage(nodeId), editor = session!.editor;
  const version = ulid(), draft = { ...photo, version, bundlePath: photo.bundlePath.replace(`${photo.version}.pcraft`, `${version}.pcraft`), previewPath: photo.previewPath.replace(`${photo.version}.png`, `${version}.png`) };
  await commitPencilPhoto(draft, nodeId);
  editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { fills: editor.graph.getNode(nodeId)!.fills, pluginData: [roomImagePluginData({ ...f.reference, revisionId: 'b'.repeat(64) })] });
  const original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation(async (command, args) => command === 'xdesign_photo_render' ? '/full-resolution.png' : original(command, args));
  const result = await exportPencil('JSX', 1, [nodeId]); expect(result.length).toBeGreaterThan(0);
  expect(host.invoke.mock.calls.filter(call => call[0] === 'xdesign_photo_render').map(call => call[1])).toEqual([{ projectId: imageProject, photoId: photo.id, version: photo.version }]);
  expect(useXDesign.getState().photoDocuments[photo.id]!.version).toBe(draft.version); expect(f.allocations).toBe(1);
});

it('recovers an accepted upload after remote publisher downgrade without replacing local or shared placements', async () => {
  await canvas(); const editor = session!.editor;
  editor.graph.updateNode(nodeId, { pluginData: [{ pluginId: 'orion.xdesign', key: 'photoDocumentId', value: f.source.id }] }); useXDesign.setState({ photoDocuments: { [f.source.id]: f.source } });
  const draft = await room!.reviewCanvasImage(nodeId); f.loseCommit = true;
  await expect(room!.publishCanvasImage(draft)).rejects.toThrow('lost image commit reply');
  const before = serializeGraph(editor.graph); f.context = { ...f.context!, actor: { ...imageActor, role: 'viewer' } };
  await room!.recoverCanvasImage();
  expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(serializeGraph(editor.graph)).toBe(before); expect(currentPencilSnapshot()!.roomImages!.bindings[0]!.reference.revisionId).toBe(draft.manifest.revisionId); expect(room!.snapshot.images!.pending).toBeNull(); expect(f.transport.commitImage).toHaveBeenCalledOnce();
});

it('automatically hydrates a selected export once and preserves the accepted graph without publishing', async () => {
  await canvas(); const editor = session!.editor, clone = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { instanceOverrides: structuredClone(editor.graph.getNode(nodeId)!.instanceOverrides), fills: editor.graph.getNode(nodeId)!.fills, pluginData: editor.graph.getNode(nodeId)!.pluginData });
  const before = JSON.parse(serializeGraph(editor.graph)); const bytes = await exportPencil('JSX', 1, [nodeId, clone.id]);
  expect(bytes.length).toBeGreaterThan(0); expect(f.allocations).toBe(1); expect(JSON.parse(serializeGraph(editor.graph))).toEqual(before); expect(room!.snapshot.images!.pending).toBeNull();
  expect(host.invoke.mock.calls.filter(call => call[0] === 'xdesign_photo_render')).toHaveLength(1); expect(f.transport.beginImage).not.toHaveBeenCalled(); expect(usePencilWorkspace.getState().busy).toBe(false);
});
it('prepares a portable component library from an unhydrated image and expires its resource permission after review', async () => {
  await canvas(); const editor = session!.editor; editor.graph.updateNode(nodeId, { type: 'COMPONENT', name: 'Shared photo card' }); const before = serializeGraph(editor.graph);
  let permission!: import('./resourceRead').CanvasResourceRead;
  const draft = await runPencilLibraryAction((library, read) => { permission = read; return library.preparePublication('Shared photos', 'Reusable images', true, undefined, [nodeId], reference => libraryRoomImageBytes(reference, read)); });
  expect(serializeGraph(editor.graph)).toBe(before); expect(f.allocations).toBe(1); expect(draft.rootIds).toEqual([nodeId]); expect(serializeGraph(draft.sourceGraph)).not.toContain('roomImage');
  const calls = host.invoke.mock.calls.length; await expect(libraryRoomImageBytes(f.reference, permission)).rejects.toThrow('no longer active'); expect(host.invoke.mock.calls).toHaveLength(calls); expect(f.transport.beginImage).not.toHaveBeenCalled();
});
it('refuses to replay a pending upload while exporting and recovers only its matching original download', async () => {
  await canvas(); const draft = await room!.prepareImageUpload(f.source, f.reference.imageId, null); expect(draft.kind).toBe('prepared');
  await expect(exportPencil('JSX', 1, [nodeId])).rejects.toThrow('pending image transfer'); expect(room!.snapshot.images!.pending!.approved).toBe(false); expect(f.transport.beginImage).not.toHaveBeenCalled();
  await room!.dismissCanvasImage(); host.failSave = true; await expect(room!.hydrateRoomImage(nodeId)).rejects.toThrow('lost project save'); const photoId = pencilPhotoDocumentId(nodeId);
  await exportPencil('JSX', 1, [nodeId]); expect(pencilPhotoDocumentId(nodeId)).toBe(photoId); expect(f.allocations).toBe(1); expect(room!.snapshot.images!.pending).toBeNull(); expect(f.files.size).toBe(0);
});
it('allows viewer full-resolution export while preserving library publication restrictions', async () => {
  role = 'viewer'; f.context = { ...f.context!, actor: { ...imageActor, role } }; await canvas();
  const before = serializeGraph(session!.editor.graph), bytes = await exportPencil('JSX', 1, [nodeId]); expect(bytes.length).toBeGreaterThan(0); expect(serializeGraph(session!.editor.graph)).toBe(before); expect(f.allocations).toBe(1); expect(usePencilWorkspace.getState().readOnly).toBe(true);
  await expect(runPencilLibraryAction(async () => {})).rejects.toThrow('viewer'); expect(f.transport.beginImage).not.toHaveBeenCalled();
});
it('preserves imported resources but refuses a changed library graph after asynchronous hydration', async () => {
  await canvas(); const editor = session!.editor; editor.graph.updateNode(nodeId, { type: 'COMPONENT' });
  const original = f.transport.importImageFile;
  f.transport.importImageFile = vi.fn(async (scope, manifest, signal) => { editor.graph.updateNode(nodeId, { x: 432 }); return original(scope, manifest, signal); });
  await expect(runPencilLibraryAction((library, read) => library.preparePublication('Changed source', '', true, undefined, [nodeId], reference => libraryRoomImageBytes(reference, read)))).rejects.toThrow('changed during publication review');
  expect(f.allocations).toBe(1); expect(pencilPhotoDocumentId(nodeId)).not.toBeNull(); expect(editor.graph.getNode(nodeId)!.x).toBe(432); expect(room!.snapshot.images!.pending).toBeNull();
});

it('retains a downloaded original but stops library review after a fresh image-endpoint downgrade', async () => {
  await canvas(); const editor = session!.editor; editor.graph.updateNode(nodeId, { type: 'COMPONENT' }); const before = serializeGraph(editor.graph);
  f.context = { ...f.context!, actor: { ...imageActor, role: 'viewer' } };
  await expect(runPencilLibraryAction((library, read) => library.preparePublication('Downgraded review', '', true, undefined, [nodeId], reference => libraryRoomImageBytes(reference, read)))).rejects.toThrow('viewer');
  expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(serializeGraph(editor.graph)).toBe(before); expect(f.allocations).toBe(1); expect(room!.snapshot.images!.pending).toBeNull(); expect(host.invoke.mock.calls.filter(call => call[0] === 'xdesign_photo_render')).toHaveLength(0);
});
it('refuses a late resource render after source replacement without clearing the replacement editor’s busy/error state', async () => {
  await canvas(); const source = session!.editor, graph = new SceneGraph(), other = createEditor({ graph, state: createDefaultEditorState(graph.getPages()[0]!.id) });
  const original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation(async (command, args) => {
    const result = await original(command, args);
    if (command === 'xdesign_photo_render') usePencilWorkspace.setState({ editor: other, busy: true, error: 'Replacement operation' });
    return result;
  });
  try {
    await expect(exportPencil('JSX', 1, [nodeId])).rejects.toThrow('source changed');
    expect(usePencilWorkspace.getState()).toMatchObject({ editor: other, busy: true, error: 'Replacement operation' }); expect(f.allocations).toBe(1);
  } finally { usePencilWorkspace.setState({ editor: source, busy: false }); other.dispose(); }
});

function copyBridge() {
  const original = host.invoke.getMockImplementation()!;
  const copies = new Map<string, { operationId: string; name: string; document: import('../projectsStore').XDDoc }>();
  host.invoke.mockImplementation(async (command, args) => {
    if (command === 'xdesign_project_import_control') {
      const { projectId, operationId, kind } = args.operation;
      const copy = copies.get(projectId); if (!copy || copy.operationId !== operationId) throw new Error('Unknown import receipt');
      const registry = (host.data.get('xdesign.projects') as { registry: unknown[] } | undefined)?.registry;
      const committed = host.data.get(`xdesign.project.${projectId}`);
      if (committed) return { version: 1, projectId, operationId, phase: 'committed', imported: { name: copy.name, document: committed }, registry };
      if (kind === 'discard') copies.delete(projectId);
      return { version: 1, projectId, operationId, phase: kind === 'discard' ? 'discarded' : 'staged', imported: kind === 'discard' ? null : { name: copy.name, document: copy.document }, registry: null };
    }
    if (command !== 'xdesign_project_clone') return original(command, args);
    const document = structuredClone(args.document);
    for (const photo of Object.values(document.photoDocuments) as import('../photo/types').PhotoDocument[]) {
      photo.bundlePath = `/copy/${args.projectId}/${photo.id}/${photo.version}.pcraft`; photo.previewPath = `/copy/${args.projectId}/${photo.id}/${photo.version}.png`; photo.originalPath = null;
    }
    copies.set(args.projectId, { operationId: args.operationId, name: args.name, document });
    return { name: args.name, document };
  });
  return copies;
}
it('creates a fresh room copy from unhydrated shared originals with independent editable identities and no original-room history', async () => {
  await canvas(); copyBridge(); const graph = serializeGraph(session!.editor.graph);
  const id = await prepareSharedRoom(imageOrigin, 'Independent room', 'Designer', new AbortController().signal), pencil = useXDesign.getState().pencilDocument!, localId = pencil.photoLinks[nodeId]!;
  expect(id).not.toBe(imageProject); expect(f.allocations).toBe(1); expect(localId).not.toBe(f.source.id); expect(pencil.roomImages).toBeUndefined(); expect(deserializeGraph(pencil.graph).getNode(nodeId)!.pluginData).toContainEqual({ pluginId: 'orion.xdesign', key: 'photoDocumentId', value: localId });
  expect(pencil.graph).not.toContain('roomImage'); expect(pencil.shared!.documentId).not.toBe(imageDocument); expect(useXDesign.getState().photoDocuments[localId]).toMatchObject({ version: f.source.version, bundlePath: expect.stringContaining(`/copy/${id}/`) });
  expect(serializeGraph(session!.editor.graph)).toBe(graph); expect((host.data.get(`xdesign.project.${imageProject}`) as import('../projectsStore').XDDoc).pencilDocument!.roomImages!.bindings[0]!.reference).toEqual(f.reference);
  const replica = restoreSharedDesign(pencil); try { expect(serializeGraph(replica.graph)).not.toContain(f.reference.imageId); } finally { replica.dispose(); }
  expect(f.transport.beginImage).not.toHaveBeenCalled(); expect(host.invoke.mock.calls.filter(call => call[0] === 'xdesign_project_clone')[0]![1].photoCopies).toEqual([{ sourceId: expect.any(String), sourceVersion: f.source.version, targetId: localId }]);
});
it('copies cached accepted revisions beside unpublished drafts without replaying a pending upload', async () => {
  await canvas(); const photo = await room!.hydrateRoomImage(nodeId), version = ulid(), draft = { ...photo, version, bundlePath: `/draft/${photo.id}/${version}.pcraft`, previewPath: `/draft/${photo.id}/${version}.png` };
  useXDesign.setState({ photoDocuments: { [photo.id]: draft } }); await room!.prepareImageUpload(draft, f.reference.imageId, f.reference.revisionId); const pending = f.saved.value;
  copyBridge(); await prepareSharedRoom(imageOrigin, 'Draft-preserving room', 'Designer', new AbortController().signal); const localId = useXDesign.getState().pencilDocument!.photoLinks[nodeId]!;
  expect(useXDesign.getState().photoDocuments[localId]!.version).toBe(photo.version); expect(useXDesign.getState().photoDocuments[photo.id]!.version).toBe(draft.version); expect(f.saved.value).toEqual(pending); expect(f.transport.beginImage).not.toHaveBeenCalled(); expect(f.allocations).toBe(1);
});
it('refuses an uncached original behind a pending upload and preserves the source project', async () => {
  await canvas(); await room!.prepareImageUpload(f.source, f.reference.imageId, null); const pending = f.saved.value;
  await expect(prepareSharedRoom(imageOrigin, 'Pending room', 'Designer', new AbortController().signal)).rejects.toThrow('pending image transfer'); expect(f.saved.value).toEqual(pending); expect(f.transport.beginImage).not.toHaveBeenCalled(); expect(useXDProjects.getState().activeId).toBe(imageProject); expect(host.invoke.mock.calls.filter(call => call[0] === 'xdesign_project_clone')).toHaveLength(0);
});
it('preserves downloaded originals but refuses room creation after fresh viewer downgrade', async () => {
  await canvas(); f.context = { ...f.context!, actor: { ...imageActor, role: 'viewer' } }; const graph = serializeGraph(session!.editor.graph);
  await expect(prepareSharedRoom(imageOrigin, 'Downgraded room', 'Designer', new AbortController().signal)).rejects.toThrow('read-only'); expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(f.allocations).toBe(1); expect(serializeGraph(session!.editor.graph)).toBe(graph); expect(useXDProjects.getState().activeId).toBe(imageProject); expect(host.invoke.mock.calls.filter(call => call[0] === 'xdesign_project_clone')).toHaveLength(0);
});
it('refuses changed artwork after native copy without publishing or replacing the original project', async () => {
  await canvas(); copyBridge(); const original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation(async (command, args) => { const result = await original(command, args); if (command === 'xdesign_project_clone') session!.editor.graph.updateNode(nodeId, { x: 765 }); return result; });
  await expect(prepareSharedRoom(imageOrigin, 'Changed room', 'Designer', new AbortController().signal)).rejects.toThrow('source artwork changed'); expect(useXDProjects.getState().activeId).toBe(imageProject); expect(useXDProjects.getState().registry).toHaveLength(1); expect(session!.editor.graph.getNode(nodeId)!.x).toBe(765); expect(useXDProjects.getState().transitioning).toBe(false);
});
it('cancels independent copy after download while retaining the saved original and source project', async () => {
  await canvas(); const controller = new AbortController(), original = f.transport.importImageFile;
  f.transport.importImageFile = vi.fn(async (scope, manifest, signal) => { const result = await original(scope, manifest, signal); controller.abort(); return result; });
  await expect(prepareSharedRoom(imageOrigin, 'Cancelled room', 'Designer', controller.signal)).rejects.toThrow('cancelled'); expect(f.allocations).toBe(1); expect(useXDProjects.getState().activeId).toBe(imageProject); expect(host.invoke.mock.calls.filter(call => call[0] === 'xdesign_project_clone')).toHaveLength(0); expect(f.transport.beginImage).not.toHaveBeenCalled();
});

async function rejectCopySource() {
  const original = host.invoke.getMockImplementation()!;
  host.invoke.mockImplementation(async (command, args) => {
    if (command === 'xdesign_room_request' && args.operation?.kind === 'sync' && args.operation.message.type === 'update') throw { status: 403, code: 'comments', message: 'Rejected local artwork' };
    return original(command, args);
  });
  session!.editor.updateNodeWithUndo(nodeId, { x: 99 }); await vi.waitFor(() => expect(room!.snapshot.connection?.phase).toBe('error')); expect(room!.snapshot.connection!.unsent).toBe(true);
}
it('hydrates and detaches an independent local recovery from a rejected upload while preserving the original checkpoint', async () => {
  await canvas(); await rejectCopySource(); copyBridge(); const graph = serializeGraph(session!.editor.graph);
  const id = await room!.recoverProject('local', new AbortController().signal), pencil = useXDesign.getState().pencilDocument!, localId = pencil.photoLinks[nodeId]!;
  expect(id).not.toBe(imageProject); expect(pencil.shared).toBeUndefined(); expect(pencil.roomImages).toBeUndefined(); expect(pencil.graph).not.toContain('roomImage'); expect(deserializeGraph(pencil.graph).getNode(nodeId)!.x).toBe(99); expect(localId).not.toBe(f.source.id); expect(f.allocations).toBe(1);
  const original = host.data.get(`xdesign.project.${imageProject}`) as import('../projectsStore').XDDoc; expect(original.pencilDocument!.shared!.documentId).toBe(imageDocument); expect(original.pencilDocument!.roomImages!.bindings[0]!.reference).toEqual(f.reference); expect(serializeGraph(session!.editor.graph)).toBe(graph); expect(f.transport.beginImage).not.toHaveBeenCalled();
  room!.dispose(); session!.dispose(); room = null; session = await openPencilSession(document.createElement('div'), pencil, () => {}); expect(usePencilWorkspace.getState().readOnly).toBe(false); session.editor.updateNodeWithUndo(nodeId, { y: 72 }); await editPencilImage(nodeId); expect(host.invoke.mock.calls.filter(call => call[0] === 'xdesign_photo_open').at(-1)![1]).toMatchObject({ photoId: localId, version: f.source.version });
});
it('retains fresh viewer access and saved original imports after independent recovery commit fails', async () => {
  await canvas(); await rejectCopySource(); const copies = copyBridge(); f.context = { ...f.context!, actor: { ...imageActor, role: 'viewer' } }; host.failCommit = true;
  await expect(room!.recoverProject('local', new AbortController().signal)).rejects.toThrow('lost copy commit'); expect(useXDProjects.getState().activeId).toBe(imageProject); expect(useXDProjects.getState().registry).toHaveLength(1); expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(f.allocations).toBe(1); expect(currentPencilSnapshot()!.roomImages!.bindings).toHaveLength(1); expect(room!.snapshot.images!.pending).toBeNull(); expect(room!.snapshot.opening).toBe(false); expect(f.transport.beginImage).not.toHaveBeenCalled();
  expect(copies.size).toBe(0); expect(host.invoke.mock.calls.filter(call => call[0] === 'xdesign_project_import_control').at(-1)![1].operation.kind).toBe('discard');
});

async function acceptedLocalPlacement() {
  await canvas(); const editor = session!.editor;
  editor.graph.updateNode(nodeId, { pluginData: [{ pluginId: 'orion.xdesign', key: 'photoDocumentId', value: f.source.id }, { pluginId: 'foreign', key: 'credit', value: 'Original author' }] });
  useXDesign.setState({ photoDocuments: { [f.source.id]: f.source } });
  const clone = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { x: 290, width: 70, height: 90, rotation: 17, fills: editor.graph.getNode(nodeId)!.fills, pluginData: editor.graph.getNode(nodeId)!.pluginData });
  const upload = await room!.reviewCanvasImage(nodeId); f.loseCommit = true;
  await expect(room!.publishCanvasImage(upload)).rejects.toThrow('lost image commit reply');
  f.context = { ...f.context!, actor: { ...imageActor, role: 'viewer' } }; await room!.recoverCanvasImage();
  const binding = currentPencilSnapshot()!.roomImages!.bindings.find(item => item.reference.revisionId === upload.manifest.revisionId)!;
  expect(readRoomImagePluginData(editor.graph.getNode(nodeId)!.pluginData)).toBeNull(); expect(usePencilWorkspace.getState().readOnly).toBe(true);
  f.context = { ...f.context!, actor: { ...imageActor } }; await room!.connect(imageOrigin); await vi.waitFor(() => expect(usePencilWorkspace.getState().readOnly).toBe(false));
  vi.mocked(f.transport.imageRevision).mockImplementation(async (imageId, revisionId) => {
    const receipt = [...f.uploads.values()].find(value => value.manifest.imageId === imageId && value.manifest.revisionId === revisionId);
    if (!receipt?.publication) throw new Error('Published revision not found');
    return { version: 1, documentId: imageDocument, actor: structuredClone(f.context!.actor), publication: structuredClone(receipt.publication) };
  });
  return { editor, clone, binding, upload };
}
it('reconciles accepted orphan placements after reconnect without republishing or replacing later native edits and supports undo/redo', async () => {
  const { editor, clone, binding } = await acceptedLocalPlacement(), original = structuredClone(editor.graph.getNode(nodeId)!.pluginData);
  const version = ulid(), latest = { ...f.source, version, bundlePath: f.source.bundlePath.replace(`${f.source.version}.pcraft`, `${version}.pcraft`), previewPath: f.source.previewPath.replace(`${f.source.version}.png`, `${version}.png`) };
  useXDesign.setState({ photoDocuments: { [latest.id]: latest } });
  const before = serializeGraph(editor.graph), review = await room!.reviewImagePlacement(nodeId, binding.reference);
  expect(review.placements).toBe(2); expect(JSON.parse(serializeGraph(editor.graph))).toEqual(JSON.parse(before)); expect(room!.snapshot.images!.pending).toBeNull();
  await room!.applyImagePlacement(review);
  for (const id of [nodeId, clone.id]) expect(readRoomImagePluginData(editor.graph.getNode(id)!.pluginData)).toEqual(binding.reference);
  expect(editor.graph.getNode(clone.id)).toMatchObject({ x: 290, width: 70, height: 90, rotation: 17 }); expect(editor.graph.getNode(nodeId)!.pluginData).toContainEqual({ pluginId: 'foreign', key: 'credit', value: 'Original author' });
  expect(useXDesign.getState().photoDocuments[latest.id]).toEqual(latest); expect(f.transport.commitImage).toHaveBeenCalledOnce(); expect(f.transport.beginImage).toHaveBeenCalledOnce(); expect(f.allocations).toBe(0); expect(f.transport.stageImageFile).not.toHaveBeenCalled();
  const saved = host.data.get(`xdesign.project.${imageProject}`) as import('../projectsStore').XDDoc; validateDesignDoc(saved); expect(saved.photoDocuments?.[latest.id]).toEqual(latest);
  editor.undoAction(); expect(editor.graph.getNode(nodeId)!.pluginData).toEqual(original); expect(readRoomImagePluginData(editor.graph.getNode(clone.id)!.pluginData)).toBeNull();
  editor.redoAction(); expect(readRoomImagePluginData(editor.graph.getNode(clone.id)!.pluginData)).toEqual(binding.reference); expect(useXDesign.getState().photoDocuments[latest.id]).toEqual(latest);
});
it('retries a failed placement save from the original reviewed patch without duplicating undo or uploading again', async () => {
  const { editor, binding } = await acceptedLocalPlacement(), review = await room!.reviewImagePlacement(nodeId, binding.reference), patch = vi.spyOn(editor, 'updateNodeWithUndo');
  host.failSave = true; await expect(room!.applyImagePlacement(review)).rejects.toThrow('lost project save'); const count = patch.mock.calls.length, after = serializeGraph(editor.graph);
  await room!.applyImagePlacement(review); expect(patch).toHaveBeenCalledTimes(count); expect(JSON.parse(serializeGraph(editor.graph))).toEqual(JSON.parse(after)); expect(f.transport.commitImage).toHaveBeenCalledOnce(); expect(room!.snapshot.images!.pending).toBeNull();
  await expect(room!.applyImagePlacement({ ...review })).rejects.toThrow('Review this room');
});
it('refuses every reviewed placement before mutation if another linked target was changed or deleted', async () => {
  const { editor, clone, binding } = await acceptedLocalPlacement(), review = await room!.reviewImagePlacement(nodeId, binding.reference);
  editor.graph.updateNode(clone.id, { pluginData: [{ pluginId: 'foreign', key: 'independent', value: 'Keep' }] }); const before = serializeGraph(editor.graph);
  await expect(room!.applyImagePlacement(review)).rejects.toThrow('placement changed after review'); expect(JSON.parse(serializeGraph(editor.graph))).toEqual(JSON.parse(before)); expect(readRoomImagePluginData(editor.graph.getNode(nodeId)!.pluginData)).toBeNull();
  editor.graph.deleteNode(clone.id); const deleted = serializeGraph(editor.graph); await expect(room!.applyImagePlacement(review)).rejects.toThrow('placement changed after review'); expect(JSON.parse(serializeGraph(editor.graph))).toEqual(JSON.parse(deleted));
});
it('uses fresh image-endpoint authorization at apply and invalidates reviews from an earlier connection epoch', async () => {
  const { editor, binding } = await acceptedLocalPlacement(), review = await room!.reviewImagePlacement(nodeId, binding.reference), before = serializeGraph(editor.graph);
  f.context = { ...f.context!, actor: { ...imageActor, role: 'viewer' } }; await expect(room!.applyImagePlacement(review)).rejects.toThrow('editor or owner'); expect(usePencilWorkspace.getState().readOnly).toBe(true); expect(JSON.parse(serializeGraph(editor.graph))).toEqual(JSON.parse(before));
  f.context = { ...f.context!, actor: { ...imageActor } }; await room!.connect(imageOrigin); await vi.waitFor(() => expect(usePencilWorkspace.getState().readOnly).toBe(false));
  await expect(room!.applyImagePlacement(review)).rejects.toThrow('Review this room'); expect(JSON.parse(serializeGraph(editor.graph))).toEqual(JSON.parse(before));
});
it('rolls back all placement metadata if applying a later linked target fails', async () => {
  const { editor, binding } = await acceptedLocalPlacement(), review = await room!.reviewImagePlacement(nodeId, binding.reference), before = serializeGraph(editor.graph), original = editor.updateNodeWithUndo.bind(editor); let calls = 0;
  vi.spyOn(editor, 'updateNodeWithUndo').mockImplementation((...args) => { if (++calls === 2) throw new Error('second placement failed'); return original(...args); });
  await expect(room!.applyImagePlacement(review)).rejects.toThrow('second placement failed'); expect(JSON.parse(serializeGraph(editor.graph))).toEqual(JSON.parse(before)); expect(useXDesign.getState().photoDocuments[f.source.id]).toEqual(f.source);
});
it('reconciles only exact predecessor pins after accepted revision recovery and leaves historic pins unchanged', async () => {
  await canvas(); const editor = session!.editor, photo = await room!.hydrateRoomImage(nodeId);
  const historic = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, { fills: editor.graph.getNode(nodeId)!.fills, pluginData: [roomImagePluginData({ ...f.reference, revisionId: 'b'.repeat(64) })] });
  const version = ulid(), edit = { ...photo, version, bundlePath: photo.bundlePath.replace(`${photo.version}.pcraft`, `${version}.pcraft`), previewPath: photo.previewPath.replace(`${photo.version}.png`, `${version}.png`) };
  await commitPencilPhoto(edit, nodeId); const upload = await room!.reviewCanvasImage(nodeId); f.loseCommit = true;
  await expect(room!.publishCanvasImage(upload)).rejects.toThrow('lost image commit reply'); f.context = { ...f.context!, actor: { ...imageActor, role: 'viewer' } }; await room!.recoverCanvasImage();
  const binding = currentPencilSnapshot()!.roomImages!.bindings.find(item => item.reference.revisionId === upload.manifest.revisionId)!;
  expect(readRoomImagePluginData(editor.graph.getNode(nodeId)!.pluginData)).toEqual(f.reference);
  f.context = { ...f.context!, actor: { ...imageActor } }; await room!.connect(imageOrigin); await vi.waitFor(() => expect(usePencilWorkspace.getState().readOnly).toBe(false));
  vi.mocked(f.transport.imageRevision).mockImplementation(async () => ({ version: 1, documentId: imageDocument, actor: imageActor, publication: structuredClone([...f.uploads.values()][0]!.publication!) }));
  const review = await room!.reviewImagePlacement(nodeId, binding.reference); expect(review.placements).toBe(1); await room!.applyImagePlacement(review);
  expect(readRoomImagePluginData(editor.graph.getNode(nodeId)!.pluginData)).toEqual(binding.reference); expect(readRoomImagePluginData(editor.graph.getNode(historic.id)!.pluginData)!.revisionId).toBe('b'.repeat(64)); expect(f.transport.commitImage).toHaveBeenCalledOnce(); expect(f.allocations).toBe(1);
});
it('preserves an intervening target edit and rolls back earlier patches when a synchronous update listener changes another placement', async () => {
  const { editor, clone, binding } = await acceptedLocalPlacement(), review = await room!.reviewImagePlacement(nodeId, binding.reference), first = structuredClone(editor.graph.getNode(nodeId)!.pluginData), original = editor.updateNodeWithUndo.bind(editor); let changed = false;
  vi.spyOn(editor, 'updateNodeWithUndo').mockImplementation((...args) => {
    const result = original(...args);
    if (!changed) { changed = true; editor.graph.updateNode(clone.id, { pluginData: [{ pluginId: 'foreign', key: 'new-edit', value: 'Preserve' }] }); }
    return result;
  });
  await expect(room!.applyImagePlacement(review)).rejects.toThrow('placement changed during apply'); expect(editor.graph.getNode(nodeId)!.pluginData).toEqual(first); expect(editor.graph.getNode(clone.id)!.pluginData).toEqual([{ pluginId: 'foreign', key: 'new-edit', value: 'Preserve' }]);
});

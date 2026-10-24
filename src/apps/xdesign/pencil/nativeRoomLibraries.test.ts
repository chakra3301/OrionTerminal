import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { SceneGraph, computeImageHash } from '@open-pencil/scene-graph';
import { createLibraryRevision, contentHash } from '@open-pencil/core/library';
import { NativeRoomTransport } from './nativeRoomTransport';
import { prepareRoomLibraryBundle, type RoomLibrarySummary } from './roomLibraryProtocol';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: () => true }));
const documentId = 'design_document_0001', handle = 'transport_handle_001', actor = { id: 'membership_0000001', name: 'Designer 🙂', role: 'editor' as const };
const transports: NativeRoomTransport[] = [], signal = () => new AbortController().signal;
const open = async () => { const transport = await NativeRoomTransport.open('https://rooms.example.test', documentId); transports.push(transport); return transport; };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); native.invoke.mockReset(); native.invoke.mockImplementation(async (command: string) => command === 'xdesign_room_open' ? handle : undefined); });
afterEach(async () => { native.invoke.mockImplementation(async () => undefined); for (const transport of transports.splice(0)) await transport.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fixture() {
  const graph = new SceneGraph(), bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), imageHash = computeImageHash(bytes);
  graph.images.set(imageHash, bytes);
  const component = graph.createNode('COMPONENT', graph.getPages()[0]!.id, { name: '图 Button 🙂', componentKey: 'button:main', width: 100, height: 40, fills: [{ type: 'IMAGE', imageHash, color: { r: 0, g: 0, b: 0, a: 1 }, visible: true, opacity: 1 }] });
  graph.createNode('TEXT', component.id, { text: 'Original 🙂', width: 80, height: 20 });
  const revision = await createLibraryRevision({ libraryId: 'library:original.1', name: 'Original library 🙂', description: 'Original description', graph, assetNodeIds: [component.id] });
  revision.manifest.assets[0]!.thumbnail = new Uint8Array([0, 1, 2, 255]);
  const bundle = await prepareRoomLibraryBundle(revision), bundleDigest = await contentHash(bundle), requestId = 'library_request_001';
  const publication: RoomLibrarySummary = { libraryId: bundle.manifest.libraryId, revisionId: bundle.manifest.revisionId, previousRevisionId: null, name: bundle.manifest.name, description: bundle.manifest.description, publishedAt: bundle.manifest.publishedAt, assetCount: 1, ownerId: actor.id, publisher: { id: actor.id, name: actor.name }, step: 1, bundleDigest };
  return { bytes, imageHash, bundle, packet: { version: 1 as const, requestId, bundle }, publication,
    receipt: { version: 1, documentId, actor, requestId, publication, current: publication },
    read: { version: 1, documentId, actor, publication, bundle } };
}
function delayedHash(onStart: () => void = () => undefined) {
  let release!: () => void;
  const original = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce((algorithm, data) => new Promise<ArrayBuffer>(resolve => { onStart(); release = () => { void original(algorithm, data).then(resolve); }; }));
  return () => release();
}
it('publishes a validated immutable SDK revision and recovers its original receipt without uploading again', async () => {
  const f = await fixture(), transport = await open(); native.invoke.mockResolvedValue(f.receipt);
  expect((await transport.publishLibrary(f.packet, signal())).publication).toEqual(f.publication);
  expect(native.invoke).toHaveBeenLastCalledWith('xdesign_room_request', { handle, sequence: 1, operation: { kind: 'publishLibrary', message: f.packet } });
  native.invoke.mockResolvedValue({ ...f.receipt, actor: { ...actor, role: 'viewer' }, current: { ...f.publication, previousRevisionId: f.publication.revisionId, revisionId: 'f'.repeat(64), step: 2 } });
  const recovered = await transport.recoverLibrary(f.packet, signal()); expect(recovered.actor.role).toBe('viewer'); expect(recovered.publication.step).toBe(1); expect(recovered.current.step).toBe(2);
  expect(native.invoke).toHaveBeenLastCalledWith('xdesign_room_request', { handle, sequence: 2, operation: { kind: 'recoverLibrary', requestId: f.packet.requestId } });
});
it('reads member catalogs and current or historic SDK resources through the same pinned handle', async () => {
  const f = await fixture(), transport = await open(); native.invoke.mockResolvedValue({ version: 1, documentId, actor: { ...actor, role: 'viewer' }, libraries: [f.publication] });
  expect((await transport.libraryCatalog(signal())).libraries).toEqual([f.publication]); expect(native.invoke).toHaveBeenLastCalledWith('xdesign_room_request', { handle, sequence: 1, operation: { kind: 'libraryCatalog' } });
  native.invoke.mockResolvedValue(f.read);
  for (const revisionId of [null, f.publication.revisionId]) {
    const result = await transport.libraryRevision(f.publication.libraryId, revisionId, signal()); expect(result.bundle).toEqual(f.bundle); expect(result.revision.graph.images.get(f.imageHash)).toEqual(f.bytes);
    expect(native.invoke.mock.lastCall![1].operation).toEqual({ kind: 'libraryRevision', message: { version: 1, libraryId: f.publication.libraryId, revisionId } });
  }
});
it('rejects malformed library requests and actual graph integrity failures before native dispatch', async () => {
  const f = await fixture(), transport = await open(); native.invoke.mockClear();
  for (const patch of [{ version: 2 }, { requestId: 'short' }, { actor }, { bundle: { ...f.bundle, secret: 'foreign' } }, { bundle: { ...f.bundle, checksum: '0'.repeat(64) } }]) await expect(transport.publishLibrary({ ...f.packet, ...patch } as typeof f.packet, signal())).rejects.toThrow();
  for (const [libraryId, revisionId] of [['../foreign', null], ['library', 'bad']]) await expect(transport.libraryRevision(libraryId!, revisionId!, signal())).rejects.toThrow();
  expect(native.invoke).not.toHaveBeenCalled(); expect(transport.inFlight).toBe(false); expect(f.packet.bundle).toEqual(f.bundle);
});
it('refuses cross-room, changed-revision and altered-resource replies before returning a library', async () => {
  const f = await fixture(), transport = await open();
  for (const value of [{ ...f.read, documentId: 'foreign_document_001' }, { ...f.read, bundle: { ...f.bundle, graph: f.bundle.graph + 'x' } }, { ...f.read, publication: { ...f.publication, bundleDigest: '0'.repeat(64) } }, { ...f.read, credential: 'foreign' }]) {
    native.invoke.mockResolvedValue(value); await expect(transport.libraryRevision(f.publication.libraryId, null, signal())).rejects.toThrow(); expect(transport.inFlight).toBe(false);
  }
  native.invoke.mockResolvedValue(f.read); await expect(transport.libraryRevision(f.publication.libraryId, '0'.repeat(64), signal())).rejects.toThrow();
  for (const value of [{ ...f.receipt, requestId: 'foreign_request_001' }, { ...f.receipt, publication: { ...f.publication, bundleDigest: '0'.repeat(64) } }, { ...f.receipt, current: { ...f.publication, ownerId: 'foreign_member_0001' } }]) {
    native.invoke.mockResolvedValue(value); await expect(transport.recoverLibrary(f.packet, signal())).rejects.toThrow();
  }
  native.invoke.mockResolvedValue({ version: 1, documentId, actor, libraries: [f.publication, f.publication] }); await expect(transport.libraryCatalog(signal())).rejects.toThrow('Duplicate');
});
it('pins publication fields before asynchronous hashing and keeps one operation active until the receipt is checked', async () => {
  const f = await fixture(), transport = await open(), packet = structuredClone(f.packet), release = delayedHash(); native.invoke.mockResolvedValue(f.receipt);
  const work = transport.publishLibrary(packet, signal()); packet.bundle.manifest.name = 'Changed after start'; packet.requestId = 'foreign_request_001';
  expect(transport.inFlight).toBe(true); await expect(transport.libraryCatalog(signal())).rejects.toMatchObject({ status: 503, code: 'busy' });
  release(); expect((await work).publication.name).toBe(f.publication.name); expect(native.invoke.mock.lastCall![1].operation.message).toEqual(f.packet); expect(transport.inFlight).toBe(false);
});
it('cancels preparation without sending a publication or cancellation for an undispatched native sequence', async () => {
  const f = await fixture(), transport = await open(), release = delayedHash(), controller = new AbortController(); native.invoke.mockClear();
  const work = transport.publishLibrary(f.packet, controller.signal); controller.abort(); expect(native.invoke).not.toHaveBeenCalled(); release();
  await expect(work).rejects.toMatchObject({ name: 'AbortError' }); expect(native.invoke).not.toHaveBeenCalled(); expect(transport.inFlight).toBe(false);
  native.invoke.mockResolvedValue({ version: 1, documentId, actor, libraries: [] }); await transport.libraryCatalog(signal()); expect(native.invoke.mock.lastCall![1].sequence).toBe(2);
});
it('keeps asynchronous revision validation single-flight and ignores a library arriving after disposal', async () => {
  const f = await fixture(), transport = await open(); let validating = false;
  const release = delayedHash(() => { validating = true; });
  native.invoke.mockImplementation(async (command: string) => command === 'xdesign_room_request' ? f.read : undefined);
  const work = transport.libraryRevision(f.publication.libraryId, null, signal()); await vi.waitFor(() => expect(validating).toBe(true));
  expect(transport.inFlight).toBe(true); await expect(transport.libraryCatalog(signal())).rejects.toMatchObject({ code: 'busy' }); await transport.dispose();
  release(); await expect(work).rejects.toMatchObject({ name: 'AbortError' }); expect(transport.inFlight).toBe(false);
});
it('preserves unknown-outcome and missing-receipt error classes without exposing native error text', async () => {
  const f = await fixture(), transport = await open();
  for (const [status, code] of [[404, 'receipt'], [409, 'conflict'], [413, 'capacity'], [401, 'credential'], [504, 'timeout']] as const) {
    native.invoke.mockRejectedValue({ status, code, message: 'private credential in untrusted error' });
    const error = await transport.recoverLibrary(f.packet, signal()).catch(error => error); expect(error).toMatchObject({ status, code }); expect(error.message).not.toContain('private credential'); expect(transport.inFlight).toBe(false);
  }
});

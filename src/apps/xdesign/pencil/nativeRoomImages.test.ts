import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { NativeRoomTransport } from './nativeRoomTransport';
import { createRoomImageManifest, roomImageBytesDigest, type RoomImageUpload } from './roomImageProtocol';
import { roomBinary } from './sharedRoomProtocol';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: () => true }));
const documentId = 'design_document_0001', handle = 'transport_handle_001', requestId = 'image_request_0001';
const actor = { id: 'membership_0000001', name: 'Designer 🙂', role: 'editor' as const };
const transports: NativeRoomTransport[] = [], signal = () => new AbortController().signal;
const open = async () => { const transport = await NativeRoomTransport.open('https://rooms.example.test', documentId); transports.push(transport); return transport; };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); native.invoke.mockReset(); native.invoke.mockImplementation(async (command: string) => command === 'xdesign_room_open' ? handle : undefined); });
afterEach(async () => { await Promise.all(transports.splice(0).map(transport => transport.dispose())); vi.unstubAllGlobals(); });
async function fixture() {
  const bytes = new Uint8Array([80, 75, 3, 4, 9, 0, 255]), digest = await roomImageBytesDigest(bytes);
  const manifest = await createRoomImageManifest({ imageId: 'image_document_0001', previousRevisionId: null, name: 'Image 🙂', width: 24, height: 24, previewWidth: 24, previewHeight: 24, archiveBytes: bytes.length, archiveDigest: digest, previewDigest: 'b'.repeat(64), chunkDigests: [digest] });
  const publication = { manifest, ownerId: actor.id, publisher: { id: actor.id, name: actor.name }, step: 1, publishedAt: '2026-10-12T00:00:00.000Z' };
  const pending: RoomImageUpload = { version: 1, documentId, actor, requestId, state: 'pending', manifest, received: [], publication: null, current: null };
  const published: RoomImageUpload = { ...pending, state: 'published', received: [0], publication, current: publication };
  const chunk = { version: 1 as const, index: 0, sha256: digest, data: roomBinary(bytes) };
  return { bytes, manifest, publication, pending, published, chunk, begin: { version: 1 as const, requestId, manifest }, read: { version: 1, documentId, actor, publication }, catalog: { version: 1, documentId, actor, images: [publication] }, part: { version: 1, documentId, actor, imageId: manifest.imageId, revisionId: manifest.revisionId, chunk } };
}
it('pins all eight Image operations to the immutable handle and sends only their closed payloads', async () => {
  const f = await fixture(), transport = await open();
  const operations: Record<string, unknown> = {};
  native.invoke.mockImplementation(async (command: string, args: { operation: { kind: string }; handle: string; sequence: number }) => {
    if (command !== 'xdesign_room_request') return;
    expect(args.handle).toBe(handle); operations[args.operation.kind] = structuredClone(args.operation);
    switch (args.operation.kind) {
      case 'imageCatalog': return f.catalog; case 'imageRevision': return f.read; case 'imageChunk': return f.part;
      case 'commitImage': return f.published; case 'dismissImage': return { ...f.pending, state: 'dismissed' };
      case 'putImageChunk': return { ...f.pending, received: [0] };
      default: return f.pending;
    }
  });
  expect((await transport.imageCatalog(signal())).images).toEqual([f.publication]);
  await transport.imageRevision(f.manifest.imageId, f.manifest.revisionId, signal()); await transport.beginImage(f.begin, signal());
  await transport.imageUpload(requestId, f.manifest, signal()); await transport.putImageChunk(requestId, f.chunk, f.manifest, signal());
  await transport.commitImage(requestId, f.manifest, signal()); await transport.dismissImage(requestId, f.manifest, signal());
  expect((await transport.imageChunk(f.manifest, 0, signal())).bytes).toEqual(f.bytes);
  expect(operations).toEqual({ imageCatalog: { kind: 'imageCatalog' }, imageRevision: { kind: 'imageRevision', message: { version: 1, imageId: f.manifest.imageId, revisionId: f.manifest.revisionId } },
    beginImage: { kind: 'beginImage', message: f.begin }, imageUpload: { kind: 'imageUpload', requestId }, putImageChunk: { kind: 'putImageChunk', requestId, index: 0, message: f.chunk },
    commitImage: { kind: 'commitImage', requestId }, dismissImage: { kind: 'dismissImage', requestId }, imageChunk: { kind: 'imageChunk', imageId: f.manifest.imageId, revisionId: f.manifest.revisionId, index: 0 } });
  expect(native.invoke.mock.calls.filter(call => call[0] === 'xdesign_room_request').map(call => call[1].sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});
it('recovers the original accepted result and validates a later head after member downgrade', async () => {
  const f = await fixture(), transport = await open();
  const next = await createRoomImageManifest({ ...f.manifest, previousRevisionId: f.manifest.revisionId, name: 'Later Image' });
  const current = { ...f.publication, manifest: next, publisher: { id: 'membership_0000002', name: 'Owner' }, step: 2 };
  native.invoke.mockResolvedValue({ ...f.published, actor: { ...actor, role: 'viewer' }, current });
  const result = await transport.imageUpload(requestId, f.manifest, signal());
  expect(result.actor.role).toBe('viewer'); expect(result.publication).toEqual(f.publication); expect(result.current).toEqual(current);
  expect(native.invoke.mock.lastCall![1].operation).toEqual({ kind: 'imageUpload', requestId });
});
it('refuses foreign rooms, request IDs, progress, original manifests and corrupted later heads', async () => {
  const f = await fixture(), transport = await open();
  for (const bad of [{ ...f.pending, documentId: 'another_document_001' }, { ...f.pending, requestId: 'another_request_0001' },
    { ...f.pending, received: [0, 0] }, { ...f.pending, manifest: { ...f.manifest, name: 'Changed original' } },
    { ...f.published, current: { ...f.publication, manifest: { ...f.manifest, name: 'Corrupted later head' }, step: 2 } },
    { ...f.published, publication: null }, { ...f.pending, credential: 'secret' }]) {
    native.invoke.mockResolvedValue(bad); await expect(transport.imageUpload(requestId, f.manifest, signal())).rejects.toThrow();
  }
});
it('rejects invalid catalog/revision hashes and altered pinned chunk bytes before returning data', async () => {
  const f = await fixture(), transport = await open();
  native.invoke.mockResolvedValue({ ...f.catalog, images: [{ ...f.publication, manifest: { ...f.manifest, name: 'Changed hash' } }] });
  await expect(transport.imageCatalog(signal())).rejects.toThrow(/integrity/);
  native.invoke.mockResolvedValue({ ...f.read, publication: { ...f.publication, manifest: { ...f.manifest, imageId: 'foreign_image_0001' } } });
  await expect(transport.imageRevision(f.manifest.imageId, null, signal())).rejects.toThrow(/another revision/);
  for (const bad of [{ ...f.part, imageId: 'foreign_image_0001' }, { ...f.part, revisionId: '0'.repeat(64) },
    { ...f.part, chunk: { ...f.chunk, data: roomBinary(new Uint8Array(f.bytes.length)) } }, { ...f.part, credential: 'secret' }]) {
    native.invoke.mockResolvedValue(bad); await expect(transport.imageChunk(f.manifest, 0, signal())).rejects.toThrow();
  }
});
it('copies caller manifests before asynchronous validation and preserves single-flight preparation', async () => {
  const f = await fixture(), transport = await open(); let release!: () => void, hashing = false;
  const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  vi.stubGlobal('crypto', { subtle: { digest: async (...args: Parameters<typeof digest>) => { hashing = true; await new Promise<void>(resolve => { release = resolve; }); return digest(...args); } } });
  native.invoke.mockResolvedValue(f.pending);
  const packet = structuredClone(f.begin), work = transport.beginImage(packet, signal());
  await vi.waitFor(() => expect(hashing).toBe(true)); packet.manifest.name = 'Caller mutation'; packet.manifest.chunkDigests[0] = '0'.repeat(64);
  expect(transport.inFlight).toBe(true); await expect(transport.imageCatalog(signal())).rejects.toMatchObject({ code: 'busy' });
  vi.stubGlobal('crypto', webcrypto); release(); await work;
  expect(native.invoke.mock.lastCall![1].operation).toEqual({ kind: 'beginImage', message: f.begin });
});
it('requires the exact chunk, publication and dismissal acknowledgements before accepting an action', async () => {
  const f = await fixture(), transport = await open(); native.invoke.mockResolvedValue(f.pending);
  await expect(transport.putImageChunk(requestId, f.chunk, f.manifest, signal())).rejects.toThrow(/acknowledge/);
  await expect(transport.commitImage(requestId, f.manifest, signal())).rejects.toThrow(/acknowledge/);
  await expect(transport.dismissImage(requestId, f.manifest, signal())).rejects.toThrow(/acknowledge/);
  native.invoke.mockResolvedValue(f.published); await expect(transport.dismissImage(requestId, f.manifest, signal())).rejects.toThrow(/acknowledge/);
  native.invoke.mockResolvedValue({ ...f.pending, received: [0] });
  const packet = structuredClone(f.chunk), manifest = structuredClone(f.manifest), work = transport.putImageChunk(requestId, packet, manifest, signal());
  packet.data = roomBinary(new Uint8Array(f.bytes.length)); packet.sha256 = '0'.repeat(64); manifest.name = 'Caller mutation';
  await work; expect(native.invoke.mock.lastCall![1].operation).toEqual({ kind: 'putImageChunk', requestId, index: 0, message: f.chunk });
});
it('aborts preparation without native dispatch and suppresses late decoded responses after disposal', async () => {
  const f = await fixture(), transport = await open(); let release!: () => void, hashing = false;
  const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  vi.stubGlobal('crypto', { subtle: { digest: async (...args: Parameters<typeof digest>) => { hashing = true; await new Promise<void>(resolve => { release = resolve; }); return digest(...args); } } });
  const controller = new AbortController(), work = transport.beginImage(f.begin, controller.signal), rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(hashing).toBe(true)); controller.abort(); vi.stubGlobal('crypto', webcrypto); release(); await rejected;
  expect(native.invoke).toHaveBeenCalledTimes(1); expect(transport.inFlight).toBe(false);
  let resolve!: (value: unknown) => void; native.invoke.mockImplementation(async (command: string) => command === 'xdesign_room_request' ? new Promise(done => { resolve = done; }) : undefined);
  const late = transport.imageCatalog(signal()), ignored = expect(late).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function')); await transport.dispose(); resolve(f.catalog); await ignored;
});
it('keeps chunk response decoding single-flight and ignores a disposal during its raw byte hash', async () => {
  const f = await fixture(), transport = await open(); let release!: () => void, decoding = false, count = 0;
  const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  vi.stubGlobal('crypto', { subtle: { digest: async (...args: Parameters<typeof digest>) => {
    if (++count === 2) { decoding = true; await new Promise<void>(resolve => { release = resolve; }); } return digest(...args);
  } } });
  native.invoke.mockResolvedValue(f.part); const work = transport.imageChunk(f.manifest, 0, signal()), ignored = expect(work).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(decoding).toBe(true)); expect(transport.inFlight).toBe(true);
  await expect(transport.imageCatalog(signal())).rejects.toMatchObject({ code: 'busy' }); await transport.dispose(); release(); await ignored;
});
it('refuses invalid outgoing immutable manifests, chunks and read indices without dispatch', async () => {
  const f = await fixture(), transport = await open();
  await expect(transport.beginImage({ ...f.begin, manifest: { ...f.manifest, name: 'Changed' } }, signal())).rejects.toThrow(/integrity/);
  await expect(transport.putImageChunk(requestId, { ...f.chunk, data: roomBinary(new Uint8Array(f.bytes.length)) }, f.manifest, signal())).rejects.toThrow(/immutable/);
  await expect(transport.imageChunk(f.manifest, 1, signal())).rejects.toThrow();
  await expect(transport.imageUpload('../foreign', f.manifest, signal())).rejects.toThrow();
  expect(native.invoke).toHaveBeenCalledTimes(1);
});

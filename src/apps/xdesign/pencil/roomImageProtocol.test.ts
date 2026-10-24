import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createRoomImageManifest, readRoomImageBegin, readRoomImageChunkResponse, readRoomImageUpload, readRoomImageRevision, roomImageBytesDigest, validateRoomImageChunk, validateRoomImageManifest, ROOM_IMAGE_ARCHIVE_BYTES, ROOM_IMAGE_CHUNK_BYTES, type RoomImageManifest } from './roomImageProtocol';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const documentId = 'image_document_001', requestId = 'image_request_001', actor = { id: 'image_member_001', name: 'Designer 🙂', role: 'editor' as const };
async function fixture() {
  const bytes = new Uint8Array([80, 75, 3, 4, 0, 255, 17]), sha256 = await roomImageBytesDigest(bytes);
  const manifest = await createRoomImageManifest({ imageId: 'image_identity_001', previousRevisionId: null, name: 'Layered image 🙂', width: 160, height: 120, previewWidth: 160, previewHeight: 120, archiveBytes: bytes.length, archiveDigest: sha256, previewDigest: 'a'.repeat(64), chunkDigests: [sha256] });
  const chunk = { version: 1 as const, index: 0, sha256, data: btoa(String.fromCharCode(...bytes)) };
  return { bytes, manifest, chunk };
}
it('retains canonical immutable image metadata, exact binary chunks and detached inputs', async () => {
  const { bytes, manifest, chunk } = await fixture(); expect(await validateRoomImageManifest(manifest)).toEqual(manifest); const original = JSON.stringify(manifest), parsed = readRoomImageBegin({ version: 1, requestId, manifest }); parsed.manifest.chunkDigests[0] = 'b'.repeat(64); expect(JSON.stringify(manifest)).toBe(original);
  const reply = await readRoomImageChunkResponse({ version: 1, documentId, actor, imageId: manifest.imageId, revisionId: manifest.revisionId, chunk }, documentId, manifest, 0); expect(reply.bytes).toEqual(bytes);
  const successor = await createRoomImageManifest({ ...manifest, previousRevisionId: manifest.revisionId, name: 'New name' }); expect(successor.revisionId).not.toBe(manifest.revisionId); expect(successor.archiveDigest).toBe(manifest.archiveDigest);
});
it('refuses changed bytes, digest, size, index and noncanonical base64 against the original manifest', async () => {
  const { manifest, chunk } = await fixture();
  for (const patch of [{ data: 'UEsDBAD/Eg==' }, { sha256: 'b'.repeat(64) }, { index: 1 }, { data: chunk.data + '=' }, { data: 'AAAA' }, { data: 'UEsDBAD/ER==' }]) await expect(validateRoomImageChunk({ ...chunk, ...patch }, manifest, 0)).rejects.toThrow();
  await expect(validateRoomImageManifest({ ...manifest, name: 'Changed after hashing' })).rejects.toThrow('integrity');
});
it('refuses newer, secret-bearing, invalid Unicode, unsafe-size and missing-inventory manifests', async () => {
  const { manifest } = await fixture();
  for (const patch of [{ version: 2 }, { token: 'secret' }, { name: 'bad\ud800' }, { name: 'bad\nname' }, { archiveBytes: ROOM_IMAGE_ARCHIVE_BYTES + 1 }, { archiveBytes: ROOM_IMAGE_CHUNK_BYTES + 1 }, { width: 268_435_456, height: 2 }, { previewWidth: 2049 }, { chunkDigests: [] }]) expect(() => readRoomImageBegin({ version: 1, requestId, manifest: { ...manifest, ...patch } })).toThrow();
});
it('pins response room, immutable request, revision and publication history', async () => {
  const { manifest } = await fixture(), publication = { manifest, ownerId: actor.id, publisher: { id: actor.id, name: actor.name }, step: 1, publishedAt: '2026-10-12T12:00:00.000Z' }, base = { version: 1, documentId, actor, requestId, state: 'published', manifest, received: [0], publication, current: publication };
  expect(readRoomImageUpload(base, documentId, requestId, manifest).state).toBe('published'); expect(readRoomImageRevision({ version: 1, documentId, actor, publication }, documentId, manifest.imageId, manifest.revisionId).publication).toEqual(publication);
  for (const patch of [{ documentId: 'foreign_document_001' }, { requestId: 'foreign_request_001' }, { received: [] }, { received: [0, 0] }, { state: 'dismissed' }, { current: { ...publication, ownerId: 'foreign_owner_001' } }, { publication: { ...publication, manifest: { ...manifest, name: 'Changed' } } }]) expect(() => readRoomImageUpload({ ...base, ...patch }, documentId, requestId, manifest)).toThrow();
  const other: RoomImageManifest = { ...manifest, imageId: 'foreign_identity_001' }; expect(() => readRoomImageUpload(base, documentId, requestId, other)).toThrow('immutable upload');
});

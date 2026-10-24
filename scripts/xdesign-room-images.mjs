import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
export const imageColumns = {
  room_image_uploads: ['room_id','member_id','request_id','manifest','manifest_digest','state','summary','summary_digest','created_at'],
  room_image_chunks: ['room_id','member_id','request_id','chunk_index','payload','digest'],
  room_image_revisions: ['room_id','image_id','revision_id','member_id','request_id','summary','summary_digest'],
  room_images: ['room_id','image_id','owner_id','revision_id','step'],
};
export function appendImageSchema(db) {
  db.exec(`
    CREATE TABLE room_image_uploads(room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,member_id TEXT NOT NULL,request_id TEXT NOT NULL,manifest TEXT NOT NULL,manifest_digest TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','published','dismissed')),summary TEXT,summary_digest TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(room_id,member_id,request_id));
    CREATE TABLE room_image_chunks(room_id TEXT NOT NULL,member_id TEXT NOT NULL,request_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,payload BLOB NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(room_id,member_id,request_id,chunk_index),FOREIGN KEY(room_id,member_id,request_id) REFERENCES room_image_uploads(room_id,member_id,request_id) ON DELETE CASCADE);
    CREATE TABLE room_image_revisions(room_id TEXT NOT NULL,image_id TEXT NOT NULL,revision_id TEXT NOT NULL,member_id TEXT NOT NULL,request_id TEXT NOT NULL,summary TEXT NOT NULL,summary_digest TEXT NOT NULL,PRIMARY KEY(room_id,image_id,revision_id),FOREIGN KEY(room_id,member_id,request_id) REFERENCES room_image_uploads(room_id,member_id,request_id));
    CREATE TABLE room_images(room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,image_id TEXT NOT NULL,owner_id TEXT NOT NULL,revision_id TEXT NOT NULL,step INTEGER NOT NULL,PRIMARY KEY(room_id,image_id),FOREIGN KEY(room_id,image_id,revision_id) REFERENCES room_image_revisions(room_id,image_id,revision_id));
    UPDATE room_meta SET value='6' WHERE key='version';
  `);
}

export class RoomImages {
  constructor(db, engine, ErrorType) { this.db = db; this.engine = engine; this.Error = ErrorType; }
  error(status, code, message) { return new this.Error(status, code, message); }
  damaged() { return this.error(500, 'storage', 'The saved shared image needs recovery. Its original bytes were preserved.'); }
  parse(work) { try { return work(); } catch (error) { if (error instanceof this.Error) throw error; throw this.error(422, 'invalid', 'The shared image packet could not be accepted.'); } }
  manifest(row) {
    try {
      if (typeof row?.manifest !== 'string' || Buffer.byteLength(row.manifest) > this.engine.ROOM_IMAGE_METADATA_BYTES || digest(row.manifest) !== row.manifest_digest) throw this.damaged();
      const manifest = this.engine.readRoomImageManifest(JSON.parse(row.manifest));
      if (digest(this.engine.roomImageManifestText(manifest)) !== manifest.revisionId) throw this.damaged();
      return manifest;
    } catch { throw this.damaged(); }
  }
  summary(row) {
    try {
      if (typeof row?.summary !== 'string' || Buffer.byteLength(row.summary) > this.engine.ROOM_IMAGE_METADATA_BYTES || digest(row.summary) !== row.summary_digest) throw this.damaged();
      const summary = this.engine.readRoomImageSummary(JSON.parse(row.summary));
      if (digest(this.engine.roomImageManifestText(summary.manifest)) !== summary.manifest.revisionId) throw this.damaged();
      return summary;
    } catch { throw this.damaged(); }
  }
  upload(room, actor, requestId) {
    this.parse(() => this.engine.validateSharedDocumentId(requestId));
    const row = this.db.prepare('SELECT * FROM room_image_uploads WHERE room_id=? AND member_id=? AND request_id=?').get(room, actor.id, requestId);
    if (!row) throw this.error(404, 'upload', 'The original shared image upload was not found.');
    this.manifest(row); if (!['pending','published','dismissed'].includes(row.state) || (row.state === 'published') !== (row.summary !== null && row.summary_digest !== null) || row.state !== 'published' && (row.summary !== null || row.summary_digest !== null)) throw this.damaged();
    return row;
  }
  head(room, imageId) {
    const head = this.db.prepare('SELECT * FROM room_images WHERE room_id=? AND image_id=?').get(room, imageId);
    if (!head) return null;
    const row = this.db.prepare('SELECT * FROM room_image_revisions WHERE room_id=? AND image_id=? AND revision_id=?').get(room, imageId, head.revision_id), summary = this.summary(row);
    if (summary.manifest.imageId !== imageId || summary.manifest.revisionId !== head.revision_id || summary.ownerId !== head.owner_id || summary.step !== head.step) throw this.damaged();
    this.revisionUpload(room, row, summary); return summary;
  }
  permission(room, actor, manifest) {
    if (actor.role === 'viewer') throw this.error(403, 'readonly', 'Editor or owner access is required to publish a shared image.');
    const head = this.head(room, manifest.imageId);
    if (head && head.ownerId !== actor.id && actor.role !== 'owner') throw this.error(403, 'owner', 'Publish this image from its original member or with room-owner access.');
    if ((head?.manifest.revisionId ?? null) !== manifest.previousRevisionId) throw this.error(409, 'predecessor', 'The shared image has a different current revision. Review it again.');
    return head;
  }
  chunks(room, member, request, manifest) {
    const rows = this.db.prepare('SELECT chunk_index,length(payload) AS bytes,digest FROM room_image_chunks WHERE room_id=? AND member_id=? AND request_id=? ORDER BY chunk_index').all(room, member, request);
    if (rows.length > manifest.chunkDigests.length || rows.some(row => !Number.isSafeInteger(row.chunk_index) || row.chunk_index < 0 || row.chunk_index >= manifest.chunkDigests.length || row.digest !== manifest.chunkDigests[row.chunk_index] || row.bytes !== this.engine.roomImageChunkSize(manifest, row.chunk_index))) throw this.damaged();
    return rows.map(row => row.chunk_index);
  }
  status(room, actor, requestId) {
    const row = this.upload(room, actor, requestId), manifest = this.manifest(row), received = this.chunks(room, actor.id, requestId, manifest), publication = row.state === 'published' ? this.summary(row) : null, current = this.head(room, manifest.imageId);
    if (row.state === 'dismissed' && received.length || row.state === 'published' && (received.length !== manifest.chunkDigests.length || JSON.stringify(publication.manifest) !== JSON.stringify(manifest) || !current || current.ownerId !== publication.ownerId || current.step < publication.step || current.step === publication.step && JSON.stringify(current) !== JSON.stringify(publication))) throw this.damaged();
    return { version: 1, documentId: room, actor, requestId, state: row.state, manifest, received, publication, current };
  }
  begin(room, actor, value) {
    const request = this.parse(() => this.engine.readRoomImageBegin(value)), manifest = request.manifest, encoded = JSON.stringify(manifest);
    if (digest(this.engine.roomImageManifestText(manifest)) !== manifest.revisionId) throw this.error(422, 'integrity', 'The shared image manifest failed its integrity check.');
    const prior = this.db.prepare('SELECT * FROM room_image_uploads WHERE room_id=? AND member_id=? AND request_id=?').get(room, actor.id, request.requestId);
    if (prior) { if (JSON.stringify(this.manifest(prior)) !== encoded) throw this.error(409, 'request', 'This shared image request already belongs to another immutable upload.'); return this.status(room, actor, request.requestId); }
    this.permission(room, actor, manifest);
    if (this.db.prepare('SELECT count(*) AS n FROM room_image_uploads WHERE room_id=?').get(room).n >= 100_000) throw this.error(413, 'capacity', 'The room has reached its shared image request capacity. Original uploads remain recoverable.');
    this.db.prepare("INSERT INTO room_image_uploads VALUES(?,?,?,?,?,'pending',NULL,NULL,?)").run(room, actor.id, request.requestId, encoded, digest(encoded), Date.now());
    return this.status(room, actor, request.requestId);
  }
  put(room, actor, requestId, index, value) {
    const row = this.upload(room, actor, requestId), manifest = this.manifest(row), read = this.parse(() => this.engine.readRoomImageChunk(value));
    const bytes = Buffer.from(read.bytes);
    if (read.chunk.index !== index || index >= manifest.chunkDigests.length || bytes.length !== this.engine.roomImageChunkSize(manifest, index) || read.chunk.sha256 !== manifest.chunkDigests[index] || digest(bytes) !== read.chunk.sha256) throw this.error(422, 'integrity', 'The shared image chunk differs from its original manifest.');
    const prior = this.db.prepare('SELECT payload,digest FROM room_image_chunks WHERE room_id=? AND member_id=? AND request_id=? AND chunk_index=?').get(room, actor.id, requestId, index);
    if (prior) { if (prior.digest !== digest(prior.payload) || prior.digest !== read.chunk.sha256 || !Buffer.from(prior.payload).equals(bytes)) throw this.damaged(); return this.status(room, actor, requestId); }
    if (row.state !== 'pending') throw this.error(409, 'closed', 'This shared image upload has already finished or been dismissed.');
    this.permission(room, actor, manifest);
    if (this.db.prepare('SELECT coalesce(sum(length(payload)),0) AS n FROM room_image_chunks').get().n + bytes.length > this.engine.ROOM_IMAGE_ARCHIVE_BYTES) throw this.error(413, 'capacity', 'The room service has reached its shared image byte capacity. Original uploads remain recoverable.');
    this.db.prepare('INSERT INTO room_image_chunks VALUES(?,?,?,?,?,?)').run(room, actor.id, requestId, index, bytes, read.chunk.sha256);
    return this.status(room, actor, requestId);
  }
  commit(room, actor, value) {
    const { requestId } = this.parse(() => this.engine.readRoomImageCommit(value)), row = this.upload(room, actor, requestId);
    if (row.state === 'published') return this.status(room, actor, requestId);
    if (row.state !== 'pending') throw this.error(409, 'closed', 'The shared image upload was dismissed. Start a newly reviewed request.');
    const manifest = this.manifest(row), head = this.permission(room, actor, manifest), received = this.chunks(room, actor.id, requestId, manifest);
    if (received.length !== manifest.chunkDigests.length) throw this.error(409, 'incomplete', 'The shared image upload is incomplete. Resume its original missing chunks.');
    const hasher = createHash('sha256'); let total = 0;
    for (const chunk of this.db.prepare('SELECT chunk_index,payload,digest FROM room_image_chunks WHERE room_id=? AND member_id=? AND request_id=? ORDER BY chunk_index').iterate(room, actor.id, requestId)) {
      if (digest(chunk.payload) !== chunk.digest || chunk.digest !== manifest.chunkDigests[chunk.chunk_index]) throw this.damaged(); hasher.update(chunk.payload); total += chunk.payload.length;
    }
    if (total !== manifest.archiveBytes || hasher.digest('hex') !== manifest.archiveDigest) throw this.error(422, 'integrity', 'The shared image archive failed its whole-file integrity check.');
    if (!head && this.db.prepare('SELECT count(*) AS n FROM room_images WHERE room_id=?').get(room).n >= 256 || this.db.prepare('SELECT count(*) AS n FROM room_image_revisions WHERE room_id=?').get(room).n >= 500) throw this.error(413, 'capacity', 'The room has reached its shared image revision capacity. Original uploads remain recoverable.');
    const step = (head?.step ?? 0) + 1; if (!Number.isSafeInteger(step)) throw this.error(413, 'capacity', 'The shared image revision sequence is exhausted.');
    const summary = this.parse(() => this.engine.readRoomImageSummary({ manifest, ownerId: head?.ownerId ?? actor.id, publisher: { id: actor.id, name: actor.name }, step, publishedAt: new Date().toISOString() })), encoded = JSON.stringify(summary), checksum = digest(encoded);
    this.db.prepare('INSERT INTO room_image_revisions VALUES(?,?,?,?,?,?,?)').run(room, manifest.imageId, manifest.revisionId, actor.id, requestId, encoded, checksum);
    this.db.prepare('INSERT INTO room_images VALUES(?,?,?,?,?) ON CONFLICT(room_id,image_id) DO UPDATE SET revision_id=excluded.revision_id,step=excluded.step').run(room, manifest.imageId, summary.ownerId, manifest.revisionId, step);
    this.db.prepare("UPDATE room_image_uploads SET state='published',summary=?,summary_digest=? WHERE room_id=? AND member_id=? AND request_id=?").run(encoded, checksum, room, actor.id, requestId);
    return this.status(room, actor, requestId);
  }
  dismiss(room, actor, requestId) {
    const row = this.upload(room, actor, requestId); if (row.state === 'published') throw this.error(409, 'published', 'A published shared image cannot be removed by dismissing its upload.');
    if (row.state === 'pending') { this.db.prepare('DELETE FROM room_image_chunks WHERE room_id=? AND member_id=? AND request_id=?').run(room, actor.id, requestId); this.db.prepare("UPDATE room_image_uploads SET state='dismissed' WHERE room_id=? AND member_id=? AND request_id=?").run(room, actor.id, requestId); }
    return this.status(room, actor, requestId);
  }
  revisionUpload(room, row, summary) {
    const upload = this.db.prepare('SELECT * FROM room_image_uploads WHERE room_id=? AND member_id=? AND request_id=?').get(room, row.member_id, row.request_id);
    if (!upload || upload.state !== 'published' || upload.summary !== row.summary || upload.summary_digest !== row.summary_digest || JSON.stringify(this.manifest(upload)) !== JSON.stringify(summary.manifest)) throw this.damaged();
    return upload;
  }
  revision(room, imageId, revisionId) {
    const head = this.head(room, imageId); if (!head) throw this.error(404, 'missing', 'The shared image was not found.');
    const row = this.db.prepare('SELECT * FROM room_image_revisions WHERE room_id=? AND image_id=? AND revision_id=?').get(room, imageId, revisionId ?? head.manifest.revisionId);
    if (!row) throw this.error(404, 'missing', 'The shared image revision was not found.'); const summary = this.summary(row);
    if (summary.manifest.imageId !== imageId || summary.manifest.revisionId !== row.revision_id || summary.ownerId !== head.ownerId || summary.step > head.step) throw this.damaged();
    const upload = this.revisionUpload(room, row, summary), received = this.chunks(room, upload.member_id, upload.request_id, summary.manifest); if (received.length !== summary.manifest.chunkDigests.length) throw this.damaged();
    return { row, summary };
  }
  getChunk(room, imageId, revisionId, index) {
    const { row, summary } = this.revision(room, imageId, revisionId), manifest = summary.manifest;
    if (!Number.isSafeInteger(index) || index < 0 || index >= manifest.chunkDigests.length) throw this.error(422, 'invalid', 'Invalid shared image chunk index.');
    const chunk = this.db.prepare('SELECT payload,digest FROM room_image_chunks WHERE room_id=? AND member_id=? AND request_id=? AND chunk_index=?').get(room, row.member_id, row.request_id, index);
    if (!chunk || chunk.payload.length !== this.engine.roomImageChunkSize(manifest, index) || chunk.digest !== manifest.chunkDigests[index] || digest(chunk.payload) !== chunk.digest) throw this.damaged();
    return { version: 1, index, sha256: chunk.digest, data: Buffer.from(chunk.payload).toString('base64') };
  }
  list(room) {
    const heads = this.db.prepare('SELECT image_id FROM room_images WHERE room_id=? ORDER BY image_id LIMIT 257').all(room); if (heads.length > 256) throw this.damaged();
    return heads.map(row => this.head(room, row.image_id));
  }
}

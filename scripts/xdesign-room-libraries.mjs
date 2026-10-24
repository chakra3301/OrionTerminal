import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
export const libraryColumns = {
  room_libraries: ['room_id', 'library_id', 'publisher_id', 'latest_revision_id', 'step', 'summary', 'summary_digest'],
  room_library_revisions: ['room_id', 'library_id', 'revision_id', 'payload', 'payload_digest', 'summary', 'summary_digest', 'created_at'],
  room_library_receipts: ['room_id', 'principal', 'request_id', 'digest', 'result', 'result_digest'],
};
export function appendLibrarySchema(db) {
  db.exec(`CREATE TABLE room_libraries(room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,library_id TEXT NOT NULL,publisher_id TEXT NOT NULL REFERENCES members(id),latest_revision_id TEXT NOT NULL,step INTEGER NOT NULL CHECK(step>0),summary TEXT NOT NULL,summary_digest TEXT NOT NULL,PRIMARY KEY(room_id,library_id));
    CREATE TABLE room_library_revisions(room_id TEXT NOT NULL,library_id TEXT NOT NULL,revision_id TEXT NOT NULL,payload TEXT NOT NULL,payload_digest TEXT NOT NULL,summary TEXT NOT NULL,summary_digest TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(room_id,library_id,revision_id),FOREIGN KEY(room_id,library_id) REFERENCES room_libraries(room_id,library_id) ON DELETE CASCADE);
    CREATE TABLE room_library_receipts(room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,principal TEXT NOT NULL,request_id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,result_digest TEXT NOT NULL,PRIMARY KEY(room_id,principal,request_id));
    UPDATE room_meta SET value='5' WHERE key='version';`);
}

export class RoomLibraries {
  constructor(db, engine, ErrorType) { this.db = db; this.engine = engine; this.ErrorType = ErrorType; }
  error(status, code, message) { return new this.ErrorType(status, code, message); }
  damaged() { return this.error(500, 'storage', 'The saved team library needs recovery. It was preserved.'); }
  summary(row) {
    try {
      if (!row || typeof row.summary !== 'string' || Buffer.byteLength(row.summary) > 16 * 1024 || digest(row.summary) !== row.summary_digest) throw new Error();
      const summary = this.engine.readRoomLibrarySummary(JSON.parse(row.summary));
      if (row.library_id !== summary.libraryId || row.revision_id && row.revision_id !== summary.revisionId || row.latest_revision_id && (row.latest_revision_id !== summary.revisionId || row.step !== summary.step || row.publisher_id !== summary.ownerId)) throw new Error();
      return summary;
    } catch { throw this.damaged(); }
  }
  head(documentId, libraryId) { return this.db.prepare('SELECT * FROM room_libraries WHERE room_id=? AND library_id=?').get(documentId, libraryId); }
  list(documentId) {
    return this.db.prepare('SELECT * FROM room_libraries WHERE room_id=? ORDER BY library_id').all(documentId).map(row => this.summary(row));
  }
  receipt(documentId, principal, requestId) { return this.db.prepare('SELECT * FROM room_library_receipts WHERE room_id=? AND principal=? AND request_id=?').get(documentId, principal, requestId); }
  recover(documentId, principal, requestId) {
    const row = this.receipt(documentId, principal, requestId);
    if (!row) throw this.error(404, 'receipt-missing', 'No accepted team library publication exists for this request.');
    let publication;
    try {
      if (typeof row.result !== 'string' || Buffer.byteLength(row.result) > 16 * 1024 || digest(row.result) !== row.result_digest) throw new Error();
      publication = this.engine.readRoomLibrarySummary(JSON.parse(row.result));
    } catch { throw this.damaged(); }
    const revision = this.db.prepare('SELECT * FROM room_library_revisions WHERE room_id=? AND library_id=? AND revision_id=?').get(documentId, publication.libraryId, publication.revisionId);
    if (!revision || revision.summary !== row.result || digest(revision.payload) !== revision.payload_digest) throw this.damaged();
    this.summary(revision);
    const head = this.head(documentId, publication.libraryId); if (!head) throw this.damaged();
    const current = this.summary(head);
    if (current.ownerId !== publication.ownerId || current.step < publication.step) throw this.damaged();
    return { publication, current };
  }
  prior(documentId, actor, request) {
    const row = this.receipt(documentId, actor.id, request.requestId); if (!row) return null;
    if (row.digest !== digest(JSON.stringify(request.bundle))) throw this.error(409, 'retry', 'This publication request was already used with another immutable library payload.');
    return this.recover(documentId, actor.id, request.requestId);
  }
  permission(documentId, actor, libraryId) {
    if (!['owner', 'editor'].includes(actor.role)) throw this.error(403, 'forbidden', 'Viewer access cannot publish team libraries.');
    const head = this.head(documentId, libraryId);
    if (head) {
      this.summary(head);
      if (actor.role !== 'owner' && head.publisher_id !== actor.id) throw this.error(403, 'forbidden', 'Publish this library as its original creator or the room owner.');
    }
    return head;
  }
  publish(documentId, actor, request, bundleDigest) {
    const prior = this.prior(documentId, actor, request); if (prior) return prior;
    const { bundle, requestId } = request, manifest = bundle.manifest, head = this.permission(documentId, actor, manifest.libraryId);
    if ((head?.latest_revision_id ?? null) !== manifest.previousRevisionId) throw this.error(409, 'conflict', 'The team library has a different current revision. Refresh it or publish its preceding revisions first.');
    if (head?.step >= Number.MAX_SAFE_INTEGER || this.db.prepare('SELECT count(*) AS n FROM room_library_receipts WHERE room_id=?').get(documentId).n >= 100_000) throw this.error(429, 'capacity', 'This room has reached its publication receipt or sequence capacity. Existing publications remain recoverable.');
    if (!head && this.db.prepare('SELECT count(*) AS n FROM room_libraries WHERE room_id=?').get(documentId).n >= this.engine.ROOM_LIBRARY_CATALOG_LIMIT) throw this.error(413, 'capacity', 'This room has reached its 256-library capacity.');
    const payload = JSON.stringify(bundle), bytes = Buffer.byteLength(payload);
    if (this.db.prepare('SELECT count(*) AS n FROM room_library_revisions WHERE room_id=?').get(documentId).n >= 500 || this.db.prepare('SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) AS n FROM room_library_revisions WHERE room_id=?').get(documentId).n + bytes > 96 * 1024 * 1024 || this.db.prepare('SELECT coalesce(sum(length(CAST(payload AS BLOB))),0) AS n FROM room_library_revisions').get().n + bytes > 512 * 1024 * 1024) throw this.error(413, 'capacity', 'The room service has reached its library revision or payload capacity. Existing revisions remain available.');
    if (this.db.prepare('SELECT 1 FROM room_library_revisions WHERE room_id=? AND library_id=? AND revision_id=?').get(documentId, manifest.libraryId, manifest.revisionId)) throw this.error(409, 'conflict', 'This library revision already exists. Recover its original publication request.');
    const publication = { libraryId: manifest.libraryId, revisionId: manifest.revisionId, previousRevisionId: manifest.previousRevisionId, name: manifest.name, description: manifest.description, publishedAt: manifest.publishedAt, assetCount: manifest.assets.length, ownerId: head?.publisher_id ?? actor.id, publisher: { id: actor.id, name: actor.name }, step: (head?.step ?? 0) + 1, bundleDigest };
    const summary = JSON.stringify(publication), checksum = digest(summary);
    if (head) this.db.prepare('UPDATE room_libraries SET latest_revision_id=?,step=?,summary=?,summary_digest=? WHERE room_id=? AND library_id=?').run(manifest.revisionId, publication.step, summary, checksum, documentId, manifest.libraryId);
    else this.db.prepare('INSERT INTO room_libraries(room_id,library_id,publisher_id,latest_revision_id,step,summary,summary_digest) VALUES(?,?,?,?,?,?,?)').run(documentId, manifest.libraryId, actor.id, manifest.revisionId, publication.step, summary, checksum);
    this.db.prepare('INSERT INTO room_library_revisions(room_id,library_id,revision_id,payload,payload_digest,summary,summary_digest,created_at) VALUES(?,?,?,?,?,?,?,?)').run(documentId, manifest.libraryId, manifest.revisionId, payload, digest(payload), summary, checksum, Date.now());
    this.db.prepare('INSERT INTO room_library_receipts(room_id,principal,request_id,digest,result,result_digest) VALUES(?,?,?,?,?,?)').run(documentId, actor.id, requestId, digest(payload), summary, checksum);
    return { publication, current: publication };
  }
  capture(documentId, libraryId, revisionId) {
    const head = this.head(documentId, libraryId); if (!head) throw this.error(404, 'missing', 'The team library could not be found.');
    const latest = this.summary(head), row = this.db.prepare('SELECT * FROM room_library_revisions WHERE room_id=? AND library_id=? AND revision_id=?').get(documentId, libraryId, revisionId ?? latest.revisionId);
    if (!row) throw this.error(404, 'missing', 'The team library revision could not be found.');
    if (typeof row.payload !== 'string' || Buffer.byteLength(row.payload) > this.engine.ROOM_LIBRARY_TRANSFER_LIMIT || digest(row.payload) !== row.payload_digest) throw this.damaged();
    const publication = this.summary(row);
    if (publication.ownerId !== latest.ownerId || publication.step > latest.step || publication.revisionId === latest.revisionId && row.summary !== head.summary) throw this.damaged();
    return { payload: row.payload, payloadDigest: row.payload_digest, summaryDigest: row.summary_digest, publication };
  }
  checkCaptured(documentId, libraryId, revisionId, captured) {
    const saved = this.capture(documentId, libraryId, captured.publication.revisionId);
    if (saved.payload !== captured.payload || saved.payloadDigest !== captured.payloadDigest || saved.summaryDigest !== captured.summaryDigest) throw this.damaged();
    const head = this.head(documentId, libraryId); if (!head) throw this.damaged(); const current = this.summary(head);
    if (revisionId === null && current.revisionId !== captured.publication.revisionId) throw this.error(409, 'conflict', 'The team library changed while loading. Refresh its latest revision.');
  }
}

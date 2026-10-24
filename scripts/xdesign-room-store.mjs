import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { openSync, closeSync, lstatSync } from 'node:fs';
import { appendGrantSchema, GrantReceipts, grantKey } from './xdesign-room-grants.mjs';
import { appendCommentHistorySchema, CommentHistory, historyColumns } from './xdesign-room-comment-history.mjs';
import { appendCommentAuthorSchema, CommentAuthors, authorColumns } from './xdesign-room-comment-authors.mjs';
import { appendLibrarySchema, RoomLibraries, libraryColumns } from './xdesign-room-libraries.mjs';
import { appendImageSchema, RoomImages, imageColumns } from './xdesign-room-images.mjs';

export class RoomError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const hash = value => createHash('sha256').update(value).digest();
const digest = value => hash(value).toString('hex');
const legacyTables = ['room_meta', 'rooms', 'members', 'receipts'];
const columns = { room_meta: ['key','value'], rooms: ['id','label','checkpoint','digest','revision','created_at'], members: ['id','room_id','name','role','secret_hash','revoked','created_at'], receipts: ['room_id','member_id','client_id','request_id','digest','revision','created_at'], grant_receipts: ['kind','room_id','principal','request_id','digest','member_id','nonce','tag','ciphertext'], ...historyColumns, ...authorColumns, ...libraryColumns, ...imageColumns };
function invalid(work) {
  try { return work(); }
  catch (error) {
    if (error instanceof RoomError || error?.code?.startsWith('ERR_SQLITE')) throw error;
    throw new RoomError(422, 'invalid', 'The shared checkpoint, update or state vector could not be accepted.');
  }
}
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\x00-\x1f\x7f-\x9f\uD800-\uDFFF]/u.test(value)) throw new RoomError(422, 'invalid', 'Enter a name using 1–128 characters.');
  return value.trim();
}
export class RoomStore {
  constructor(location, engine, { grantSecret } = {}) {
    this.engine = engine;
    const key = grantKey(grantSecret);
    if (typeof location !== 'string' || !location) throw new Error('Use a dedicated room database path.');
    if (location !== ':memory:') {
      try { closeSync(openSync(location, 'wx', 0o600)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (!lstatSync(location).isFile()) throw new Error('Use a regular dedicated room database file. The original path was preserved.');
    }
    const db = this.db = new DatabaseSync(location);
    try {
      db.exec('PRAGMA busy_timeout=5000;');
      const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
      if (existing.length) {
        const version = existing.includes('room_meta') ? db.prepare("SELECT value FROM room_meta WHERE key='version'").get()?.value : null, tables = [...legacyTables, ...(version !== '1' ? ['grant_receipts'] : []), ...(['3','4','5','6'].includes(version) ? Object.keys(historyColumns) : []), ...(['4','5','6'].includes(version) ? Object.keys(authorColumns) : []), ...(['5','6'].includes(version) ? Object.keys(libraryColumns) : []), ...(version === '6' ? Object.keys(imageColumns) : [])];
        if (!['1','2','3','4','5','6'].includes(version) || existing.length !== tables.length || existing.some(name => !tables.includes(name)) || db.prepare("SELECT value FROM room_meta WHERE key='format'").get()?.value !== 'orion.xdesign.rooms'
          || tables.some(table => JSON.stringify(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name)) !== JSON.stringify(columns[table]))) throw new Error('This is not a supported XDesign room database. It was preserved.');
        if (version === '1') this.transaction(() => { if (db.prepare("SELECT value FROM room_meta WHERE key='version'").get()?.value === '1') appendGrantSchema(db); });
      } else {
        this.transaction(() => db.exec(`
          CREATE TABLE room_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          INSERT INTO room_meta VALUES('format','orion.xdesign.rooms'),('version','1');
          CREATE TABLE rooms(id TEXT PRIMARY KEY,label TEXT NOT NULL,checkpoint BLOB NOT NULL,digest TEXT NOT NULL,revision INTEGER NOT NULL,created_at INTEGER NOT NULL);
          CREATE TABLE members(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')),secret_hash BLOB NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
          CREATE TABLE receipts(room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,member_id TEXT NOT NULL,client_id TEXT NOT NULL,request_id TEXT NOT NULL,digest TEXT NOT NULL,revision INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(room_id,member_id,client_id,request_id));
          CREATE INDEX members_room ON members(room_id);
        `));
      }
      if (!existing.length) this.transaction(() => appendGrantSchema(db));
      this.grants = new GrantReceipts(db, key, RoomError);
      this.transaction(() => { if (db.prepare("SELECT value FROM room_meta WHERE key='version'").get()?.value === '2') appendCommentHistorySchema(db); });
      this.history = new CommentHistory(db, engine, RoomError);
      this.authors = new CommentAuthors(db, engine, RoomError);
      this.transaction(() => {
        if (db.prepare("SELECT value FROM room_meta WHERE key='version'").get()?.value !== '3') return;
        appendCommentAuthorSchema(db);
        for (const row of db.prepare('SELECT id,checkpoint,digest FROM rooms').iterate()) {
          if (digest(row.checkpoint) !== row.digest) throw new RoomError(500, 'storage', 'The saved room checkpoint needs recovery. It was preserved.');
          const replica = invalid(() => engine.SharedDesign.fromUpdate(row.checkpoint));
          try { this.authors.register(row.id, replica.graph); } finally { replica.dispose(); }
        }
      });
      this.transaction(() => { if (db.prepare("SELECT value FROM room_meta WHERE key='version'").get()?.value === '4') appendLibrarySchema(db); });
      this.libraries = new RoomLibraries(db, engine, RoomError);
      this.transaction(() => { if (db.prepare("SELECT value FROM room_meta WHERE key='version'").get()?.value === '5') appendImageSchema(db); });
      this.images = new RoomImages(db, engine, RoomError);
      db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    } catch (error) { db.close(); throw error; }
  }
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  grant(documentId, name, role) {
    const id = randomUUID(), secret = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO members(id,room_id,name,role,secret_hash,created_at) VALUES(?,?,?,?,?,?)').run(id, documentId, label(name), role, hash(secret), Date.now());
    return { actor: { id, name: label(name), role }, credential: `${id}.${secret}` };
  }
  create(documentId, name, ownerName, checkpoint, requestId) {
    invalid(() => this.engine.validateSharedDocumentId(documentId)); label(name); label(ownerName);
    if (requestId !== undefined) invalid(() => this.engine.validateSharedDocumentId(requestId));
    const replica = invalid(() => this.engine.SharedDesign.fromUpdate(checkpoint));
    try {
      const bytes = replica.update();
      return this.transaction(() => this.grants.run('create', documentId, 'administrator', requestId, digest(JSON.stringify([label(name), label(ownerName), digest(checkpoint)])), () => {
        if (this.db.prepare('SELECT id FROM rooms WHERE id=?').get(documentId)) throw new RoomError(409, 'exists', 'This shared document already exists.');
        invalid(() => {
          for (const reference of this.engine.roomImageHistoryReferences(bytes)) this.imageReference(documentId, reference);
          this.imageResources(documentId, replica.graph);
        });
        if (this.db.prepare('SELECT count(*) AS n FROM rooms').get().n >= 128 || this.db.prepare('SELECT coalesce(sum(length(checkpoint)),0) AS n FROM rooms').get().n + bytes.byteLength > 512 * 1024 * 1024) throw new RoomError(413, 'capacity', 'The room service has reached its checkpoint capacity.');
        this.db.prepare('INSERT INTO rooms(id,label,checkpoint,digest,revision,created_at) VALUES(?,?,?,?,1,?)').run(documentId, label(name), bytes, digest(bytes), Date.now());
        const grant = this.grant(documentId, ownerName, 'owner');
        this.authors.register(documentId, replica.graph);
        return { version: 1, documentId, revision: 1, ...grant };
      }));
    } finally { replica.dispose(); }
  }
  authorize(documentId, credential) {
    const match = /^([A-Za-z0-9_-]{16,128})\.([A-Za-z0-9_-]{43})$/.exec(credential ?? '');
    const row = match ? this.db.prepare('SELECT id,room_id,name,role,secret_hash,revoked FROM members WHERE id=? AND room_id=?').get(match[1], documentId) : null;
    if (!row || row.revoked || !timingSafeEqual(Buffer.from(row.secret_hash), hash(match[2]))) throw new RoomError(401, 'unauthorized', 'Room access is unavailable. Reconnect with a valid membership credential.');
    return { id: row.id, name: row.name, role: row.role };
  }
  owner(actor) { if (actor.role !== 'owner') throw new RoomError(403, 'forbidden', 'Only the room owner can manage members.'); }
  principal(documentId, actor) {
    const row = this.db.prepare('SELECT id,name,role,revoked FROM members WHERE id=? AND room_id=?').get(actor.id, documentId);
    if (!row || row.revoked) throw new RoomError(401, 'unauthorized', 'Room access is unavailable. Reconnect with a valid membership credential.');
    return { id: row.id, name: row.name, role: row.role };
  }
  members(documentId, actor) {
    this.owner(this.principal(documentId, actor));
    return this.db.prepare('SELECT id,name,role,revoked FROM members WHERE room_id=? ORDER BY created_at,id').all(documentId).map(row => ({ ...row, revoked: !!row.revoked }));
  }
  invite(documentId, actor, name, role, requestId) {
    if (!['editor', 'viewer'].includes(role)) throw new RoomError(422, 'invalid', 'Choose editor or viewer access.');
    label(name); if (requestId !== undefined) invalid(() => this.engine.validateSharedDocumentId(requestId));
    return this.transaction(() => {
      this.owner(this.principal(documentId, actor));
      return this.grants.run('invite', documentId, actor.id, requestId, digest(JSON.stringify([label(name), role])), () => {
        if (this.db.prepare('SELECT count(*) AS n FROM members WHERE room_id=?').get(documentId).n >= 64) throw new RoomError(413, 'capacity', 'This room has reached its membership capacity.');
        const grant = this.grant(documentId, name, role); return requestId === undefined ? grant : { version: 1, documentId, ...grant };
      });
    });
  }
  recoverGrant(documentId, kind, requestId, actor) {
    invalid(() => { this.engine.validateSharedDocumentId(documentId); this.engine.validateSharedDocumentId(requestId); });
    if (!['create', 'invite'].includes(kind)) throw new RoomError(422, 'invalid', 'Invalid grant receipt type.');
    return this.transaction(() => {
      if (kind === 'invite') this.owner(this.principal(documentId, actor));
      return this.grants.recover(kind, documentId, kind === 'create' ? 'administrator' : actor.id, requestId);
    });
  }
  changeMember(documentId, actor, memberId, role) {
    invalid(() => this.engine.validateSharedDocumentId(memberId));
    if (role !== null && !['editor', 'viewer'].includes(role)) throw new RoomError(422, 'invalid', 'Choose editor or viewer access.');
    this.transaction(() => {
      this.owner(this.principal(documentId, actor));
      const member = this.db.prepare('SELECT role FROM members WHERE id=? AND room_id=?').get(memberId, documentId);
      if (!member) throw new RoomError(404, 'missing', 'Room membership was not found.');
      if (member.role === 'owner') throw new RoomError(403, 'forbidden', 'The room owner cannot be changed through a member grant.');
      if (role === null) this.db.prepare('UPDATE members SET revoked=1 WHERE id=? AND room_id=?').run(memberId, documentId);
      else this.db.prepare('UPDATE members SET role=? WHERE id=? AND room_id=?').run(role, memberId, documentId);
    });
  }
  imageCatalog(documentId, actor) { return this.transaction(() => ({ version: 1, documentId, actor: this.principal(documentId, actor), images: this.images.list(documentId) })); }
  beginImage(documentId, actor, value) { return this.transaction(() => this.images.begin(documentId, this.principal(documentId, actor), value)); }
  imageUpload(documentId, actor, requestId) { return this.transaction(() => this.images.status(documentId, this.principal(documentId, actor), requestId)); }
  putImageChunk(documentId, actor, requestId, index, value) { return this.transaction(() => this.images.put(documentId, this.principal(documentId, actor), requestId, index, value)); }
  commitImage(documentId, actor, value) { return this.transaction(() => this.images.commit(documentId, this.principal(documentId, actor), value)); }
  dismissImage(documentId, actor, requestId) { return this.transaction(() => this.images.dismiss(documentId, this.principal(documentId, actor), requestId)); }
  imageRevision(documentId, actor, value) {
    const request = this.images.parse(() => this.engine.readRoomImageRevisionRequest(value));
    return this.transaction(() => ({ version: 1, documentId, actor: this.principal(documentId, actor), publication: this.images.revision(documentId, request.imageId, request.revisionId).summary }));
  }
  imageChunk(documentId, actor, imageId, revisionId, index) {
    this.images.parse(() => this.engine.readRoomImageRevisionRequest({ version: 1, imageId, revisionId }));
    return this.transaction(() => ({ version: 1, documentId, actor: this.principal(documentId, actor), imageId, revisionId, chunk: this.images.getChunk(documentId, imageId, revisionId, index) }));
  }
  imageReference(documentId, reference) {
    try { return this.images.revision(documentId, reference.imageId, reference.revisionId).summary.manifest; }
    catch (error) {
      if (error instanceof RoomError && error.status === 404) throw new RoomError(409, 'image', 'Publish the referenced image revision in this room before sharing its artwork. Original artwork was retained.');
      throw error;
    }
  }
  imageResources(documentId, graph) {
    const digests = new Map();
    this.engine.assertRoomImageResources(graph, (reference, preview) => {
      const manifest = this.imageReference(documentId, reference);
      let hash = digests.get(reference.previewHash); if (!hash) { hash = digest(preview); digests.set(reference.previewHash, hash); }
      if (hash !== manifest.previewDigest) throw new RoomError(422, 'integrity', 'The shared image preview differs from its published revision. Original artwork was retained.');
    });
  }
  savedImageResources(documentId, graph) {
    try { this.imageResources(documentId, graph); }
    catch { throw new RoomError(500, 'storage', 'The saved artwork image references need recovery. Original files and receipts were preserved.'); }
  }
  libraryCatalog(documentId, actor) {
    return this.transaction(() => ({ version: 1, documentId, actor: this.principal(documentId, actor), libraries: this.libraries.list(documentId) }));
  }
  async publishLibrary(documentId, actor, value) {
    const request = invalid(() => this.engine.readRoomLibraryPublish(value));
    const prior = this.transaction(() => { actor = this.principal(documentId, actor); const prior = this.libraries.prior(documentId, actor, request); if (!prior) this.libraries.permission(documentId, actor, request.bundle.manifest.libraryId); return prior; });
    if (prior) return { version: 1, documentId, actor, requestId: request.requestId, ...prior };
    let checked;
    try { checked = await this.engine.validateRoomLibraryBundle(request.bundle); }
    catch { throw new RoomError(422, 'invalid', 'The portable team library failed its integrity or resource checks. The original library was preserved.'); }
    return this.transaction(() => { actor = this.principal(documentId, actor); return { version: 1, documentId, actor, requestId: request.requestId, ...this.libraries.publish(documentId, actor, request, checked.bundleDigest) }; });
  }
  recoverLibrary(documentId, actor, requestId) {
    invalid(() => this.engine.validateSharedDocumentId(requestId));
    return this.transaction(() => ({ version: 1, documentId, actor: this.principal(documentId, actor), requestId, ...this.libraries.recover(documentId, actor.id, requestId) }));
  }
  async libraryRevision(documentId, actor, value) {
    const request = invalid(() => this.engine.readRoomLibraryRead(value));
    const captured = this.transaction(() => { this.principal(documentId, actor); return this.libraries.capture(documentId, request.libraryId, request.revisionId); });
    let checked;
    try { checked = await this.engine.validateRoomLibraryBundle(JSON.parse(captured.payload)); }
    catch { throw new RoomError(500, 'storage', 'The saved team library failed its integrity or resource checks. It was preserved.'); }
    return this.transaction(() => {
      actor = this.principal(documentId, actor); this.libraries.checkCaptured(documentId, request.libraryId, request.revisionId, captured);
      if (checked.bundleDigest !== captured.publication.bundleDigest) throw this.libraries.damaged();
      return { version: 1, documentId, actor, publication: captured.publication, bundle: checked.bundle };
    });
  }
  commentOwnership(documentId, actor) {
    return this.transaction(() => {
      actor = invalid(() => this.engine.readRoomCommentActor(this.principal(documentId, actor)));
      return { version: 1, documentId, actor, authorIds: [...this.authors.grants(documentId, actor)].sort() };
    });
  }
  commentAuthors(documentId, actor) {
    return this.transaction(() => {
      actor = this.principal(documentId, actor); this.owner(actor);
      return { version: 1, documentId, actor, authors: this.authors.list(documentId) };
    });
  }
  assignCommentAuthor(documentId, actor, input) {
    return this.transaction(() => {
      actor = this.principal(documentId, actor); this.owner(actor);
      return { version: 1, documentId, actor, requestId: input.requestId, ...invalid(() => this.authors.assign(documentId, actor.id, input)) };
    });
  }
  recoverCommentAuthor(documentId, actor, requestId) {
    invalid(() => this.engine.validateSharedDocumentId(requestId));
    return this.transaction(() => {
      actor = this.principal(documentId, actor); this.owner(actor);
      return { version: 1, documentId, actor, requestId, ...this.authors.recover(documentId, actor.id, requestId) };
    });
  }
  comment(actor, input, recoverOnly = false) {
    const { packet, vector } = invalid(() => this.engine.readRoomCommentRequest(input));
    return this.transaction(() => {
      actor = invalid(() => this.engine.readRoomCommentActor(this.principal(packet.documentId, actor)));
      const room = this.db.prepare('SELECT checkpoint,digest,revision FROM rooms WHERE id=?').get(packet.documentId);
      if (!room || digest(room.checkpoint) !== room.digest) throw new RoomError(500, 'storage', 'The saved room checkpoint needs recovery. It was preserved.');
      const requestDigest = `comment:${digest(JSON.stringify([packet.vector, packet.command]))}`;
      const prior = this.db.prepare('SELECT digest,revision FROM receipts WHERE room_id=? AND member_id=? AND client_id=? AND request_id=?').get(packet.documentId, actor.id, packet.clientId, packet.requestId);
      if (prior && prior.digest !== requestDigest) throw new RoomError(409, 'retry', 'This request identity was already used with a different payload.');
      if (!prior && recoverOnly) throw new RoomError(404, 'receipt-missing', 'The comment receipt is no longer available. Its original outcome may be unknown.');
      const assigned = kind => `rc_${digest(JSON.stringify([packet.documentId, actor.id, packet.clientId, packet.requestId, kind]))}`;
      const command = packet.command, result = { threadId: command.type === 'add' ? assigned('thread') : command.threadId,
        ...(['add', 'reply'].includes(command.type) ? { messageId: assigned('message') } : Object.hasOwn(command, 'messageId') ? { messageId: command.messageId } : {}) };
      let replica;
      try { replica = this.engine.SharedDesign.fromUpdate(room.checkpoint); }
      catch { throw new RoomError(500, 'storage', 'The saved room checkpoint needs recovery. It was preserved.'); }
      let revision = room.revision, acceptedRevision = prior?.revision;
      try {
        this.savedImageResources(packet.documentId, replica.graph);
        if (!prior) {
          if (this.db.prepare("SELECT count(*) AS n FROM receipts WHERE room_id=? AND digest LIKE 'comment:%'").get(packet.documentId).n >= this.engine.COMMENT_RECEIPT_LIMIT) throw new RoomError(429, 'capacity', 'This room has reached its durable comment receipt capacity. Existing receipts remain recoverable.');
          const grants = this.authors.grants(packet.documentId, actor);
          const before = command.type === 'history' ? null : this.engine.commentHistorySnapshot(replica.graph,result.threadId);
          let record;
          invalid(() => replica.edit('Room comment', graph => {
              try {
                if (command.type === 'history') this.history.replay(packet.documentId,actor,command,graph,revision+1,grants);
                else {
                  this.engine.applyRoomCommentCommand(graph, command, actor, result, Date.now(), grants);
                  record = {version:1,actorId:actor.id,command,result,before,after:this.engine.commentHistorySnapshot(graph,result.threadId)};
                }
              }
              catch (error) { if (error instanceof this.engine.RoomCommentActionError) throw new RoomError(error.status, error.code, error.message); throw error; }
            }, (_graph, checkpoint) => {
              const nextDigest = digest(checkpoint), changed = nextDigest !== room.digest;
              if (checkpoint.byteLength > 32 * 1024 * 1024 || changed && (revision >= Number.MAX_SAFE_INTEGER || this.db.prepare('SELECT coalesce(sum(length(checkpoint)),0) AS n FROM rooms').get().n - room.checkpoint.byteLength + checkpoint.byteLength > 512 * 1024 * 1024)) throw new RoomError(413, 'capacity', 'The room service has reached its checkpoint or revision capacity.');
              if (changed) revision++;
              if (changed) this.db.prepare('UPDATE rooms SET checkpoint=?,digest=?,revision=? WHERE id=?').run(checkpoint, nextDigest, revision, packet.documentId);
            }));
          if (record) this.history.capture(packet.documentId,actor,packet,record,revision);
          acceptedRevision = revision;
          this.db.prepare('INSERT INTO receipts(room_id,member_id,client_id,request_id,digest,revision,created_at) VALUES(?,?,?,?,?,?,?)').run(packet.documentId, actor.id, packet.clientId, packet.requestId, requestDigest, revision, Date.now());
          this.pruneArtworkReceipts(packet.documentId);
        }
        return { version: 1, type: 'comment', documentId: packet.documentId, clientId: packet.clientId, requestId: packet.requestId, revision, acceptedRevision, actor, vector: this.engine.roomBinary(replica.stateVector(), true), update: this.engine.roomBinary(replica.update(vector)), result };
      } finally { replica.dispose(); }
    });
  }
  commentHistory(documentId,actor,before) {
    return this.transaction(() => {
      actor=invalid(() => this.engine.readRoomCommentActor(this.principal(documentId,actor)));
      return {version:1,documentId,actor,...this.history.list(documentId,actor,before)};
    });
  }
  pruneArtworkReceipts(documentId) {
    this.db.prepare("DELETE FROM receipts WHERE room_id=? AND digest NOT LIKE 'comment:%' AND rowid NOT IN (SELECT rowid FROM receipts WHERE room_id=? AND digest NOT LIKE 'comment:%' ORDER BY rowid DESC LIMIT 4096)").run(documentId, documentId);
  }
  exchange(actor, input) {
    const message = invalid(() => this.engine.readRoomRequest(input));
    // Lock before reading the checkpoint so separate service processes cannot
    // overwrite a peer's just-committed state with an older projection.
    return this.transaction(() => this.exchangeLocked(this.principal(message.packet.documentId, actor), message));
  }
  exchangeLocked(actor, { packet, vector, update }) {
    const room = this.db.prepare('SELECT checkpoint,digest,revision FROM rooms WHERE id=?').get(packet.documentId);
    if (!room || digest(room.checkpoint) !== room.digest) throw new RoomError(500, 'storage', 'The saved room checkpoint needs recovery. It was preserved.');
    let replica;
    try { replica = this.engine.SharedDesign.fromUpdate(room.checkpoint); }
    catch { throw new RoomError(500, 'storage', 'The saved room checkpoint needs recovery. It was preserved.'); }
    let revision = room.revision, acceptedRevision;
    try {
      this.savedImageResources(packet.documentId, replica.graph);
      // A retry must retain its exact payload; acknowledgement and checkpoint
      // commit together even when the caller loses the original HTTP response.
      if (packet.type === 'update') {
        const requestDigest = digest(JSON.stringify([packet.vector, packet.update])), prior = this.db.prepare('SELECT digest,revision FROM receipts WHERE room_id=? AND member_id=? AND client_id=? AND request_id=?').get(packet.documentId, actor.id, packet.clientId, packet.requestId);
        if (prior) {
          if (prior.digest !== requestDigest) throw new RoomError(409, 'retry', 'This request identity was already used with a different payload.');
          acceptedRevision = prior.revision;
        } else {
          if (actor.role === 'viewer') throw new RoomError(403, 'readonly', 'This room membership has view-only access. Local artwork was not uploaded.');
          const before = replica.graph, grants = this.authors.grants(packet.documentId, actor);
          invalid(() => replica.receive(update, (graph, checkpoint) => {
            if (!this.engine.roomCheckpointCovers(checkpoint, vector)) throw new RoomError(409, 'dependencies', 'Resynchronize and resend the complete local checkpoint before acknowledging this update.');
            try {
              const restored = this.engine.assertRoomRawUpdate(room.checkpoint,update,actor,before,graph,checkpoint,grants,reference => this.imageReference(packet.documentId, reference));
              this.engine.assertRoomCommentChanges(before, graph, actor, grants, restored);
            }
            catch (error) {
              if (error instanceof this.engine.RoomRawUpdateError) throw new RoomError(409, 'dependencies', error.message);
              if (error instanceof this.engine.RoomCommentPermissionError) throw new RoomError(403, 'comments', error.message);
              throw error;
            }
            this.imageResources(packet.documentId, graph);
            this.history.raw(packet.documentId,this.engine.allComments(before),this.engine.allComments(graph),packet);
            const nextDigest = digest(checkpoint), changed = nextDigest !== room.digest;
            if (changed && revision >= Number.MAX_SAFE_INTEGER) throw new RoomError(413, 'capacity', 'The room revision limit was reached.');
            if (changed && this.db.prepare('SELECT coalesce(sum(length(checkpoint)),0) AS n FROM rooms').get().n - room.checkpoint.byteLength + checkpoint.byteLength > 512 * 1024 * 1024) throw new RoomError(413, 'capacity', 'The room service has reached its checkpoint capacity.');
            if (checkpoint.byteLength > 32 * 1024 * 1024) throw new RoomError(413, 'capacity', 'The shared checkpoint exceeds 32 MiB.');
            if (changed) revision++;
            if (changed) this.db.prepare('UPDATE rooms SET checkpoint=?,digest=?,revision=? WHERE id=?').run(checkpoint, nextDigest, revision, packet.documentId);
            this.db.prepare('INSERT INTO receipts(room_id,member_id,client_id,request_id,digest,revision,created_at) VALUES(?,?,?,?,?,?,?)').run(packet.documentId, actor.id, packet.clientId, packet.requestId, requestDigest, revision, Date.now());
            this.pruneArtworkReceipts(packet.documentId);
          }));
          acceptedRevision = revision;
        }
      }
      return { version: 1, type: packet.type === 'update' ? 'ack' : 'sync', documentId: packet.documentId, clientId: packet.clientId, requestId: packet.requestId, revision, actor, vector: this.engine.roomBinary(replica.stateVector(), true), update: this.engine.roomBinary(replica.update(vector)), ...(acceptedRevision === undefined ? {} : { acceptedRevision }) };
    } finally { replica.dispose(); }
  }
  close() { this.db.close(); }
}

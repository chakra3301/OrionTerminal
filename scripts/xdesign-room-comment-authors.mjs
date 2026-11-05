import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
export const authorColumns = {
  comment_authors: ['room_id', 'author_id', 'name', 'member_id', 'step'],
  comment_author_receipts: ['room_id', 'principal', 'request_id', 'digest', 'result', 'result_digest'],
};

export function appendCommentAuthorSchema(db) {
  db.exec(`CREATE TABLE comment_authors(room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,author_id TEXT NOT NULL,name TEXT NOT NULL,member_id TEXT REFERENCES members(id),step INTEGER NOT NULL DEFAULT 0 CHECK(step>=0),PRIMARY KEY(room_id,author_id));
    CREATE INDEX comment_authors_member ON comment_authors(room_id,member_id);
    CREATE TABLE comment_author_receipts(room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,principal TEXT NOT NULL,request_id TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,result_digest TEXT NOT NULL,PRIMARY KEY(room_id,principal,request_id));
    UPDATE room_meta SET value='4' WHERE key='version';`);
}

export class CommentAuthors {
  constructor(db, engine, ErrorType) { this.db = db; this.engine = engine; this.ErrorType = ErrorType; }
  error(status, code, message) { return new this.ErrorType(status, code, message); }
  register(documentId, graph) {
    const authors = new Map(), members = new Set(this.db.prepare('SELECT id FROM members').all().map(row => row.id));
    for (const thread of this.engine.allComments(graph)) for (const message of thread.messages) {
      if (!authors.has(message.author.id) && !members.has(message.author.id)) authors.set(message.author.id, message.author.name);
    }
    if (authors.size > 10_000) throw this.error(413, 'capacity', 'This imported room has too many original comment authors.');
    for (const [id, name] of authors) this.db.prepare('INSERT INTO comment_authors(room_id,author_id,name) VALUES(?,?,?)').run(documentId, id, name);
  }
  list(documentId) {
    return this.db.prepare('SELECT author_id AS authorId,name,member_id AS memberId,step FROM comment_authors WHERE room_id=? ORDER BY author_id').all(documentId).map(row => ({ ...row }));
  }
  grants(documentId, actor) {
    return new Set(this.db.prepare('SELECT a.author_id FROM comment_authors a JOIN members m ON m.id=a.member_id AND m.room_id=a.room_id WHERE a.room_id=? AND m.id=? AND m.revoked=0 AND NOT EXISTS(SELECT 1 FROM members original WHERE original.id=a.author_id)').all(documentId, actor.id).map(row => row.author_id));
  }
  current(documentId, authorId) {
    const row = this.db.prepare('SELECT author_id AS authorId,member_id AS memberId,step FROM comment_authors WHERE room_id=? AND author_id=?').get(documentId, authorId);
    if (!row) throw this.error(404, 'missing', 'This room has no imported comment author with that identity.');
    return { ...row };
  }
  receipt(documentId, principal, requestId) {
    return this.db.prepare('SELECT * FROM comment_author_receipts WHERE room_id=? AND principal=? AND request_id=?').get(documentId, principal, requestId);
  }
  readReceipt(documentId, row) {
    let assignment;
    try {
      if (typeof row.result !== 'string' || Buffer.byteLength(row.result) > 1024 || digest(row.result) !== row.result_digest) throw new Error();
      assignment = JSON.parse(row.result);
      if (!assignment || Object.keys(assignment).length !== 3 || !Object.hasOwn(assignment, 'authorId') || !Object.hasOwn(assignment, 'memberId') || !Number.isSafeInteger(assignment.step) || assignment.step < 1) throw new Error();
      this.engine.roomCommentId(assignment.authorId);
      if (assignment.memberId !== null) this.engine.validateSharedDocumentId(assignment.memberId);
    } catch { throw this.error(500, 'storage', 'The author grant receipt needs recovery. It was preserved.'); }
    return { assignment, current: this.current(documentId, assignment.authorId) };
  }
  recover(documentId, principal, requestId) {
    const prior = this.receipt(documentId, principal, requestId);
    if (!prior) throw this.error(404, 'receipt-missing', 'No accepted author grant exists for this request.');
    return this.readReceipt(documentId, prior);
  }
  assign(documentId, principal, { authorId, memberId, step, requestId }) {
    this.engine.roomCommentId(authorId); this.engine.validateSharedDocumentId(requestId);
    if (memberId !== null) this.engine.validateSharedDocumentId(memberId);
    if (!Number.isSafeInteger(step) || step < 0) throw this.error(422, 'invalid', 'Use the current author grant step.');
    const requestDigest = digest(JSON.stringify([authorId, memberId, step])), prior = this.receipt(documentId, principal, requestId);
    if (prior) {
      if (prior.digest !== requestDigest) throw this.error(409, 'retry', 'This author grant request identity was already used with another payload.');
      return this.readReceipt(documentId, prior);
    }
    const current = this.current(documentId, authorId);
    if (this.db.prepare('SELECT 1 FROM members WHERE id=?').get(authorId)) throw this.error(403, 'comments', 'A room member identity cannot be reassigned as an imported author.');
    if (memberId !== null && !this.db.prepare('SELECT 1 FROM members WHERE room_id=? AND id=? AND revoked=0').get(documentId, memberId)) throw this.error(404, 'missing', 'Choose a current member of this room.');
    if (current.step !== step) throw this.error(409, 'conflict', 'This author grant changed. Refresh its current step before continuing.');
    if (step >= Number.MAX_SAFE_INTEGER || this.db.prepare('SELECT count(*) AS n FROM comment_author_receipts WHERE room_id=?').get(documentId).n >= 100_000) throw this.error(429, 'capacity', 'This room has reached its author grant receipt or step capacity. Existing grants remain recoverable.');
    const assignment = { authorId, memberId, step: step + 1 }, result = JSON.stringify(assignment);
    this.db.prepare('UPDATE comment_authors SET member_id=?,step=? WHERE room_id=? AND author_id=?').run(memberId, assignment.step, documentId, authorId);
    this.db.prepare('INSERT INTO comment_author_receipts(room_id,principal,request_id,digest,result,result_digest) VALUES(?,?,?,?,?,?)').run(documentId, principal, requestId, requestDigest, result, digest(result));
    return { assignment, current: assignment };
  }
}

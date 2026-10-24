import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function grantKey(secret) {
  if (secret === undefined) return null;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256 || /[\x00-\x20\x7f]/.test(secret)) throw new Error('Configure a stable private room grant secret using 32–256 non-whitespace characters.');
  return createHash('sha256').update('orion.xdesign.room-grants.v1\0').update(secret).digest();
}
export function appendGrantSchema(db) {
  db.exec(`CREATE TABLE grant_receipts(kind TEXT NOT NULL CHECK(kind IN ('create','invite')),room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,principal TEXT NOT NULL,request_id TEXT NOT NULL,digest TEXT NOT NULL,member_id TEXT NOT NULL REFERENCES members(id),nonce BLOB NOT NULL,tag BLOB NOT NULL,ciphertext BLOB NOT NULL,PRIMARY KEY(kind,room_id,principal,request_id));
    UPDATE room_meta SET value='2' WHERE key='version';`);
}
const aad = (kind, documentId, principal, requestId, digest) => Buffer.from(JSON.stringify([kind, documentId, principal, requestId, digest]));
export class GrantReceipts {
  constructor(db, key, ErrorType) { this.db = db; this.key = key; this.ErrorType = ErrorType; this.verifyKey(false); }
  error(status, code, message) { return new this.ErrorType(status, code, message); }
  verifyKey(required) {
    const saved = this.db.prepare("SELECT value FROM room_meta WHERE key='grant_key'").get()?.value;
    if (!saved && this.db.prepare('SELECT 1 FROM grant_receipts LIMIT 1').get()) throw this.error(500, 'storage', 'The grant encryption fingerprint is missing. Receipts were preserved.');
    if (!this.key) { if (required) throw this.error(503, 'grant-key', 'Configure the stable room grant encryption secret before creating recoverable grants.'); return; }
    const fingerprint = createHash('sha256').update(this.key).digest('hex');
    if (saved && saved !== fingerprint) throw this.error(503, 'grant-key', 'The room grant encryption secret does not match this database. Receipts were preserved.');
    if (required && !saved) this.db.prepare("INSERT INTO room_meta(key,value) VALUES('grant_key',?)").run(fingerprint);
  }
  find(kind, documentId, principal, requestId) { return this.db.prepare('SELECT * FROM grant_receipts WHERE kind=? AND room_id=? AND principal=? AND request_id=?').get(kind, documentId, principal, requestId); }
  read(kind, documentId, principal, requestId, row) {
    this.verifyKey(true);
    let result;
    try {
      if (row.nonce.byteLength !== 12 || row.tag.byteLength !== 16 || row.ciphertext.byteLength > 4096) throw new Error();
      const cipher = createDecipheriv('aes-256-gcm', this.key, row.nonce); cipher.setAAD(aad(kind, documentId, principal, requestId, row.digest)); cipher.setAuthTag(row.tag);
      result = JSON.parse(Buffer.concat([cipher.update(row.ciphertext), cipher.final()]).toString('utf8'));
      if (result.version !== 1 || result.documentId !== documentId || result.requestId !== requestId || result.actor?.id !== row.member_id || typeof result.credential !== 'string') throw new Error();
    } catch { throw this.error(500, 'storage', 'The saved grant receipt needs recovery. It was preserved.'); }
    const member = this.db.prepare('SELECT role,secret_hash,revoked FROM members WHERE room_id=? AND id=?').get(documentId, row.member_id), secret = result.credential.split('.');
    if (!member || member.revoked) throw this.error(410, 'grant-revoked', 'This grant has been revoked. It cannot be recovered.');
    const digest = createHash('sha256').update(secret[1] ?? '').digest();
    if (secret[0] !== row.member_id || member.secret_hash.byteLength !== 32 || !timingSafeEqual(Buffer.from(member.secret_hash), digest)) throw this.error(500, 'storage', 'The saved grant receipt no longer matches its membership. It was preserved.');
    if (member.role !== result.actor.role) throw this.error(409, 'grant-changed', 'This grant has a different access level. Review its membership before sharing it.');
    return result;
  }
  recover(kind, documentId, principal, requestId) {
    const row = this.find(kind, documentId, principal, requestId); if (!row) throw this.error(404, 'receipt-missing', 'No accepted grant exists for this request.');
    return this.read(kind, documentId, principal, requestId, row);
  }
  run(kind, documentId, principal, requestId, digest, work) {
    if (requestId === undefined) return work();
    this.verifyKey(true); const prior = this.find(kind, documentId, principal, requestId);
    if (prior) { if (prior.digest !== digest) throw this.error(409, 'retry', 'This grant request identity was already used with a different payload.'); return this.read(kind, documentId, principal, requestId, prior); }
    const result = { ...work(), requestId }, nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce); cipher.setAAD(aad(kind, documentId, principal, requestId, digest));
    const bytes = Buffer.from(JSON.stringify(result)); if (bytes.byteLength > 4096) throw this.error(413, 'capacity', 'This grant receipt exceeds its limit.');
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    this.db.prepare('INSERT INTO grant_receipts(kind,room_id,principal,request_id,digest,member_id,nonce,tag,ciphertext) VALUES(?,?,?,?,?,?,?,?,?)').run(kind, documentId, principal, requestId, digest, result.actor.id, nonce, cipher.getAuthTag(), ciphertext);
    return result;
  }
}

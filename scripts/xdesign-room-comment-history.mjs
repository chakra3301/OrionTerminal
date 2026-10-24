import { createHash } from 'node:crypto';
const digest = text => createHash('sha256').update(text).digest('hex');
export const historyColumns = {
  comment_history: ['id','room_id','member_id','client_id','request_id','thread_id','data','digest','undone','step','revision'],
  comment_fields: ['room_id','thread_id','field','token'],
};
export function appendCommentHistorySchema(db) {
  db.exec(`CREATE TABLE comment_history(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,member_id TEXT NOT NULL,client_id TEXT NOT NULL,request_id TEXT NOT NULL,thread_id TEXT NOT NULL,data TEXT NOT NULL,digest TEXT NOT NULL,undone INTEGER NOT NULL DEFAULT 0 CHECK(undone IN (0,1)),step INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL,UNIQUE(room_id,member_id,client_id,request_id));
    CREATE INDEX comment_history_member ON comment_history(room_id,member_id,id);
    CREATE TABLE comment_fields(room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,thread_id TEXT NOT NULL,field TEXT NOT NULL,token TEXT NOT NULL,PRIMARY KEY(room_id,thread_id,field));
    UPDATE room_meta SET value='3' WHERE key='version';`);
}
const ROOM_BYTES = 128 * 1024 * 1024, TOTAL_BYTES = 512 * 1024 * 1024, RECORD_BYTES = 32 * 1024 * 1024;
export class CommentHistory {
  constructor(db, engine, ErrorType) { this.db=db; this.engine=engine; this.ErrorType=ErrorType; }
  error(status,code,message) { return new this.ErrorType(status,code,message); }
  token(documentId,threadId,field) { return this.db.prepare('SELECT token FROM comment_fields WHERE room_id=? AND thread_id=? AND field=?').get(documentId,threadId,field)?.token ?? null; }
  writeToken(documentId,threadId,field,token) {
    if (token===null) this.db.prepare('DELETE FROM comment_fields WHERE room_id=? AND thread_id=? AND field=?').run(documentId,threadId,field);
    else this.db.prepare('INSERT INTO comment_fields(room_id,thread_id,field,token) VALUES(?,?,?,?) ON CONFLICT(room_id,thread_id,field) DO UPDATE SET token=excluded.token').run(documentId,threadId,field,token);
  }
  capacity(documentId) {
    const bytes=scope => this.db.prepare(`SELECT (SELECT coalesce(sum(length(CAST(data AS BLOB))),0) FROM comment_history${scope?' WHERE room_id=?':''}) + (SELECT coalesce(sum(length(CAST(thread_id AS BLOB))+length(CAST(field AS BLOB))+length(CAST(token AS BLOB))),0) FROM comment_fields${scope?' WHERE room_id=?':''}) AS n`).get(...(scope?[documentId,documentId]:[])).n;
    if (bytes(true)>ROOM_BYTES || bytes(false)>TOTAL_BYTES || this.db.prepare('SELECT count(*) AS n FROM comment_fields WHERE room_id=?').get(documentId).n>100_000 || this.db.prepare('SELECT count(*) AS n FROM comment_fields').get().n>400_000) throw this.error(413,'capacity','The room comment history has reached its retained storage capacity. Existing history was preserved.');
  }
  capture(documentId,actor,packet,record,revision) {
    if (!this.engine.commentHistoryChanged(record)) return;
    const field=this.engine.commentHistoryField(record), threadId=record.result.threadId, fieldBefore=this.token(documentId,threadId,field), fieldAfter=JSON.stringify([actor.id,packet.clientId,packet.requestId]);
    const dependencies=this.engine.commentHistoryDependencies(record).map(field=>({field,token:this.token(documentId,threadId,field)}));
    const data=JSON.stringify({version:1,record,fieldBefore,fieldAfter,dependencies});
    if (Buffer.byteLength(data)>RECORD_BYTES) throw this.error(413,'capacity','The comment history record exceeds its storage limit.');
    this.db.prepare('INSERT INTO comment_history(room_id,member_id,client_id,request_id,thread_id,data,digest,revision) VALUES(?,?,?,?,?,?,?,?)').run(documentId,actor.id,packet.clientId,packet.requestId,threadId,data,digest(data),revision);
    this.writeToken(documentId,threadId,field,fieldAfter); this.capacity(documentId);
  }
  find(documentId,actor,command) {
    const row=this.db.prepare('SELECT * FROM comment_history WHERE room_id=? AND member_id=? AND client_id=? AND request_id=?').get(documentId,actor.id,command.sourceClientId,command.sourceRequestId);
    if (!row) throw this.error(404,'missing','This member has no recorded comment action with that identity.');
    if (row.thread_id!==command.threadId) throw this.error(409,'conflict','The recorded action belongs to another comment.');
    return row;
  }
  read(row) {
    try {
      if (typeof row.data!=='string' || Buffer.byteLength(row.data)>RECORD_BYTES || digest(row.data)!==row.digest || !Number.isSafeInteger(row.step) || row.step<0 || ![0,1].includes(row.undone)) throw new Error();
      const data=JSON.parse(row.data);
      if (!data || Object.keys(data).length!==5 || Object.keys(data).some(key=>!['version','record','fieldBefore','fieldAfter','dependencies'].includes(key)) || data.version!==1) throw new Error();
      const record=this.engine.readCommentHistoryRecord(data.record), validToken=token=>token===null || typeof token==='string' && token.length<=1024;
      this.engine.validateSharedDocumentId(row.client_id); this.engine.validateSharedDocumentId(row.request_id);
      if (record.actorId!==row.member_id || record.result.threadId!==row.thread_id || !Number.isSafeInteger(row.id) || row.id<1 || !Number.isSafeInteger(row.revision) || row.revision<1 || !validToken(data.fieldBefore) || data.fieldAfter!==JSON.stringify([row.member_id,row.client_id,row.request_id])) throw new Error();
      const expected=this.engine.commentHistoryDependencies(record);
      if (!Array.isArray(data.dependencies) || data.dependencies.length!==expected.length || data.dependencies.some((item,index)=>!item || Object.keys(item).length!==2 || item.field!==expected[index] || !validToken(item.token))) throw new Error();
      return {...data,record};
    } catch { throw this.error(500,'storage','The recorded comment action needs recovery. It was preserved.'); }
  }
  replay(documentId,actor,command,graph,revision,grants) {
    const row=this.find(documentId,actor,command), data=this.read(row), undo=command.direction==='undo';
    if (row.step!==command.step || !!row.undone===undo) throw this.error(409,'conflict','This history action already changed. Refresh its current step before continuing.');
    const field=this.engine.commentHistoryField(data.record), expected=undo?data.fieldAfter:data.fieldBefore;
    if (this.token(documentId,row.thread_id,field)!==expected || data.dependencies.some(item=>this.token(documentId,row.thread_id,item.field)!==item.token)) throw this.error(409,'conflict','A later action changed this comment field. Its current state was preserved.');
    this.engine.replayCommentHistory(graph,data.record,command.direction,actor,grants);
    this.writeToken(documentId,row.thread_id,field,undo?data.fieldBefore:data.fieldAfter);
    this.db.prepare('UPDATE comment_history SET undone=?,step=?,revision=? WHERE id=?').run(undo?1:0,row.step+1,revision,row.id);
    this.capacity(documentId);
    return {threadId:row.thread_id};
  }
  raw(documentId,before,after,packet) {
    const token=JSON.stringify(['raw',packet.clientId,packet.requestId]);
    const fields=this.engine.changedCommentFields(before,after); if (!fields.length) return;
    for (const {threadId,field} of fields) this.writeToken(documentId,threadId,field,token);
    this.capacity(documentId);
  }
  list(documentId,actor,before=Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(before) || before<1) throw this.error(422,'invalid','Invalid comment history cursor.');
    const rows=this.db.prepare('SELECT * FROM comment_history WHERE room_id=? AND member_id=? AND id<? ORDER BY id DESC LIMIT 101').all(documentId,actor.id,before), page=rows.slice(0,100);
    const entries=page.map(row=>{const {record}=this.read(row);return {id:row.id,clientId:row.client_id,requestId:row.request_id,threadId:row.thread_id,action:record.command.type,undone:!!row.undone,step:row.step,revision:row.revision};});
    return {entries,next:rows.length>100?page.at(-1).id:null};
  }
}

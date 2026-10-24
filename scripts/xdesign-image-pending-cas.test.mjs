import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

const source = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
const statement = source.slice(source.indexOf('export async function compareAndSetXDesignRoomImagePending')).match(/`([^`]+)`/)[1];
const project = '01ARZ3NDEKTSV4RRFFQ69G5FAV', key = `xdesign.roomImagePending.${project}`, doc = `xdesign.project.${project}`;
function initialize(db) { db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)'); const put = db.prepare('INSERT INTO app_state VALUES(?,?)'); put.run('xdesign.projects', JSON.stringify({ registry: [{ id: project }] })); put.run(doc, '{}'); put.run('xdesign.roomLibraries', 'original downloaded libraries'); put.run('xdesign.roomImagePending.other', 'other original packet'); }
const fixture = () => { const db = new DatabaseSync(':memory:'); initialize(db); return db; };
const parameters = (value, expected) => ({ '$1': key, '$2': value, '$3': expected, '$4': project, '$5': doc });
const write = (db, value, expected) => db.prepare(statement).run(parameters(value, expected));
const read = db => db.prepare('SELECT value FROM app_state WHERE key=?').get(key)?.value;
test('pending packet creation and replacement require exact original bytes without changing other projects or cached libraries', () => {
  const db = fixture(); try { assert.equal(write(db, 'first packet', null).changes, 1); assert.equal(write(db, 'stale packet', null).changes, 0); assert.equal(write(db, 'second packet', 'first packet').changes, 1); assert.equal(write(db, 'third packet', 'first packet').changes, 0); assert.equal(read(db), 'second packet'); assert.equal(db.prepare("SELECT value FROM app_state WHERE key='xdesign.roomLibraries'").get().value, 'original downloaded libraries'); assert.equal(db.prepare("SELECT value FROM app_state WHERE key='xdesign.roomImagePending.other'").get().value, 'other original packet'); } finally { db.close(); }
});
test('neither new nor existing pending packets can save after their document or registry membership is removed', () => {
  for (const existing of [false, true]) for (const missing of ['document', 'registry']) { const db = fixture(); try { if (existing) write(db, 'original packet', null); if (missing === 'document') db.prepare('DELETE FROM app_state WHERE key=?').run(doc); else db.prepare('UPDATE app_state SET value=? WHERE key=?').run('{"registry":[]}', 'xdesign.projects'); assert.equal(write(db, 'late packet', existing ? 'original packet' : null).changes, 0); assert.equal(read(db), existing ? 'original packet' : undefined); } finally { db.close(); } }
});
test('a late completion cannot recreate deleted pending data with an old expected packet', () => {
  const db = fixture(); try { write(db, 'original packet', null); db.prepare('DELETE FROM app_state WHERE key=?').run(key); assert.equal(write(db, 'late completion', 'original packet').changes, 0); assert.equal(read(db), undefined); } finally { db.close(); }
});
test('failed pending SQLite writes roll back and preserve the original packet', () => {
  const db = fixture(); try { write(db, 'original packet', null); db.exec(`CREATE TRIGGER fail_pending BEFORE UPDATE ON app_state WHEN OLD.key='${key}' BEGIN SELECT RAISE(ABORT,'injected pending failure'); END;`); assert.throws(() => write(db, 'cleared packet', 'original packet'), /pending failure/); assert.equal(read(db), 'original packet'); } finally { db.close(); }
});
test('independent SQLite writers admit one replacement of the reviewed pending packet', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'xdesign-image-pending-')), file = join(folder, 'pending.sqlite'), db = new DatabaseSync(file); initialize(db); db.exec('PRAGMA journal_mode=WAL'); write(db, 'original packet', null);
  const workers = [1, 2].map(index => new Worker(`const{parentPort,workerData}=require('node:worker_threads');const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.file);db.exec('PRAGMA busy_timeout=5000');parentPort.postMessage({ready:true});parentPort.once('message',()=>{try{parentPort.postMessage({changed:db.prepare(workerData.statement).run(workerData.parameters).changes});}catch(error){parentPort.postMessage({error:error.message});}finally{db.close();parentPort.close();}});`, { eval: true, workerData: { file, statement, parameters: parameters(`writer ${index}`, 'original packet') } }));
  try { await Promise.all(workers.map(worker => new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', reply => reply.ready ? resolve() : reject(new Error(reply.error))); }))); const replies = workers.map(worker => new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', reply => reply.error ? reject(new Error(reply.error)) : resolve(reply.changed)); })); const exits = workers.map(worker => new Promise(resolve => worker.once('exit', resolve))); workers.forEach(worker => worker.postMessage('write')); assert.deepEqual((await Promise.all(replies)).sort(), [0, 1]); assert.match(read(db), /^writer [12]$/); await Promise.all(exits); } finally { await Promise.all(workers.map(worker => worker.terminate())); db.close(); rmSync(folder, { recursive: true, force: true }); }
});

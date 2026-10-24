import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

const source = readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');
const statement = source.slice(source.indexOf('export async function compareAndSetXDesignRoomLibraries')).match(/`([^`]+)`/)[1];
const fixture = () => { const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)'); db.prepare('INSERT INTO app_state VALUES(?,?)').run('xdesign.libraries', 'original local libraries'); return db; };
const write = (db, value, expected) => db.prepare(statement).run({ '$1': value, '$2': expected });
const cached = db => db.prepare("SELECT value FROM app_state WHERE key='xdesign.roomLibraries'").get()?.value;
test('shared-library cache admission creates once and never overwrites the local library catalog', () => {
  const db = fixture(); try { assert.equal(write(db, 'first cache', null).changes, 1); assert.equal(write(db, 'stale cache', null).changes, 0); assert.equal(cached(db), 'first cache'); assert.equal(db.prepare("SELECT value FROM app_state WHERE key='xdesign.libraries'").get().value, 'original local libraries'); } finally { db.close(); }
});
test('shared-library cache updates require the exact reviewed bytes and do not recreate removed data', () => {
  const db = fixture(); try { write(db, 'first cache', null); assert.equal(write(db, 'second cache', 'first cache').changes, 1); assert.equal(write(db, 'stale cache', 'first cache').changes, 0); assert.equal(cached(db), 'second cache'); db.exec("DELETE FROM app_state WHERE key='xdesign.roomLibraries'"); assert.equal(write(db, 'recreated cache', 'second cache').changes, 0); assert.equal(cached(db), undefined); } finally { db.close(); }
});
test('failed shared-library SQLite updates preserve the original cached and local catalogs', () => {
  const db = fixture(); try { write(db, 'first cache', null); db.exec("CREATE TRIGGER fail_cache BEFORE UPDATE ON app_state WHEN OLD.key='xdesign.roomLibraries' BEGIN SELECT RAISE(ABORT,'injected cache failure'); END;"); assert.throws(() => write(db, 'second cache', 'first cache'), /cache failure/); assert.equal(cached(db), 'first cache'); assert.equal(db.prepare("SELECT value FROM app_state WHERE key='xdesign.libraries'").get().value, 'original local libraries'); } finally { db.close(); }
});
test('independent SQLite writers cannot replace the same confirmed cache revision twice', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'xdesign-room-library-cache-')), file = join(folder, 'cache.sqlite'), db = new DatabaseSync(file);
  db.exec('CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);PRAGMA journal_mode=WAL;'); write(db, 'first cache', null);
  const workers = [1, 2].map(index => new Worker(`const{parentPort,workerData}=require('node:worker_threads');const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData.file);db.exec('PRAGMA busy_timeout=5000');parentPort.postMessage({ready:true});parentPort.once('message',()=>{try{parentPort.postMessage({changed:db.prepare(workerData.statement).run({'$1':workerData.next,'$2':'first cache'}).changes});}catch(error){parentPort.postMessage({error:error.message});}finally{db.close();parentPort.close();}});`, { eval: true, workerData: { file, statement, next: `writer ${index}` } }));
  try {
    await Promise.all(workers.map(worker => new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', value => value.ready ? resolve() : reject(new Error(value.error))); })));
    const replies = workers.map(worker => new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', value => value.error ? reject(new Error(value.error)) : resolve(value.changed)); })); workers.forEach(worker => worker.postMessage('go'));
    assert.deepEqual((await Promise.all(replies)).sort(), [0, 1]); assert.ok(['writer 1', 'writer 2'].includes(cached(db)));
  } finally { await Promise.all(workers.map(worker => worker.terminate())); db.close(); rmSync(folder, { recursive: true, force: true }); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../src/lib/db.ts",import.meta.url),"utf8");
const statement=source.slice(source.indexOf("export async function compareAndSetXDesignLibraries")).match(/`([^`]+)`/)[1];
const fixture=()=>{const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE app_state (key TEXT PRIMARY KEY,value TEXT NOT NULL)");return db;};
const publish=(db,value,expected)=>db.prepare(statement).run({"$1":value,"$2":expected});

test("library publishing creates a catalog once and rejects another window's stale first publication",()=>{
  const db=fixture();try{assert.equal(publish(db,'{"revision":1}',null).changes,1);assert.equal(publish(db,'{"revision":2}',null).changes,0);assert.equal(db.prepare("SELECT value FROM app_state").get().value,'{"revision":1}');}finally{db.close();}
});
test("library publishing swaps only the catalog revision it reviewed",()=>{
  const db=fixture();try{publish(db,'{"revision":1}',null);assert.equal(publish(db,'{"revision":2}','{"revision":1}').changes,1);assert.equal(publish(db,'{"revision":3}','{"revision":1}').changes,0);assert.equal(db.prepare("SELECT value FROM app_state").get().value,'{"revision":2}');}finally{db.close();}
});
test("a failed SQLite library write leaves the earlier catalog intact",()=>{
  const db=fixture();try{publish(db,'{"revision":1}',null);db.exec("CREATE TRIGGER fail_library BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT,'injected failure'); END");assert.throws(()=>publish(db,'{"revision":2}','{"revision":1}'),/injected failure/);assert.equal(db.prepare("SELECT value FROM app_state").get().value,'{"revision":1}');}finally{db.close();}
});
test("a stale publication cannot recreate a catalog removed by another window",()=>{
  const db=fixture();try{publish(db,'{"revision":1}',null);db.exec("DELETE FROM app_state");assert.equal(publish(db,'{"revision":2}','{"revision":1}').changes,0);assert.equal(db.prepare("SELECT COUNT(*) AS count FROM app_state").get().count,0);}finally{db.close();}
});

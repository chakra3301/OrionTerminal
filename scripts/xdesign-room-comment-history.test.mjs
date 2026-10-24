import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {SceneGraph} from '@open-pencil/scene-graph';
import {roomEngine} from './xdesign-room-engine.mjs';
import {createRoomRelay} from './xdesign-room-relay.mjs';
let engine;
const documentId='history_document_001',administrator='history-admin-'.repeat(4);
before(async()=>{engine=await roomEngine();});
after(async()=>{if(process.env.XDESIGN_COMMENT_HISTORY_EVIDENCE)await writeFile(process.env.XDESIGN_COMMENT_HISTORY_EVIDENCE,JSON.stringify({node:process.version,bundleBytes:engine.bytes,bundleSha256:engine.sourceSha256,inputs:engine.inputs,notices:engine.notices,licenseAssets:engine.licenseAssets,warnings:engine.warnings,transport:'dedicated-temporary-sqlite-and-node-stream-handlers-no-sockets'},null,2)+'\n');});
async function fixture(work){
 const folder=await mkdtemp(join(tmpdir(),'xdesign-comment-history-')),database=join(folder,'rooms.sqlite'),replicas=[];
 let relay=await createRoomRelay({database,adminSecret:administrator,grantSecret:administrator,engine});
 const graph=new SceneGraph(),page=graph.getPages()[0].id,source=engine.api.SharedDesign.fromGraph(graph);replicas.push(source);
 const owner=relay.store.create(documentId,'History','Owner',source.update()),viewer=relay.store.invite(documentId,owner.actor,'Viewer','viewer'),editor=relay.store.invite(documentId,owner.actor,'Editor','editor');
 const peer=()=>{const value=engine.api.SharedDesign.fromUpdate(new Uint8Array(relay.store.db.prepare('SELECT checkpoint FROM rooms WHERE id=?').get(documentId).checkpoint));replicas.push(value);return value;};
 const state=()=>({room:relay.store.db.prepare('SELECT hex(checkpoint) AS bytes,digest,revision FROM rooms WHERE id=?').get(documentId),receipts:relay.store.db.prepare('SELECT * FROM receipts ORDER BY rowid').all(),history:relay.store.db.prepare('SELECT * FROM comment_history ORDER BY id').all(),fields:relay.store.db.prepare('SELECT * FROM comment_fields ORDER BY thread_id,field').all()});
 const packet=command=>({version:1,type:'comment',documentId,clientId:'history_client_001',requestId:randomUUID(),vector:'AA==',command});
 const call=async(grant,input,recover=false,path=`/v1/rooms/${documentId}/comments`,method='POST')=>{
  const request=Readable.from(input===undefined?[]:[Buffer.from(JSON.stringify(input))]);Object.assign(request,{method,url:path+(recover?'/recover':''),headers:{authorization:`Bearer ${grant.credential}`,'content-type':'application/json'},socket:{remoteAddress:randomUUID()}});let status,data;
  await relay.handle(request,{destroyed:false,writeHead(code){status=code;},end(bytes){data=JSON.parse(bytes);}});return{status,data};
 };
 const send=async(grant,command,outgoing=packet(command),recover=false)=>{const reply=await call(grant,outgoing,recover);assert.equal(reply.status,200,JSON.stringify(reply));const parsed=engine.api.readRoomCommentResponse(reply.data,outgoing),replica=peer();assert.ok(engine.api.roomCheckpointCovers(replica.update(),parsed.vector));return{...parsed.packet,outgoing};};
 const list=async(grant,before)=>{const result=await call(grant,undefined,false,`/v1/rooms/${documentId}/comments/history${before===undefined?'':'/'+before}`,'GET');assert.equal(result.status,200,JSON.stringify(result));return engine.api.readRoomCommentHistoryPage(result.data,documentId,before);};
 const action=async(grant,original,direction='undo',step=0,outgoing)=>send(grant,{type:'history',threadId:original.result.threadId,sourceClientId:original.outgoing.clientId,sourceRequestId:original.outgoing.requestId,direction,step},outgoing);
 const refused=async(grant,command,status)=>{const saved=state(),reply=await call(grant,packet(command));assert.equal(reply.status,status,JSON.stringify(reply));assert.deepEqual(state(),saved);};
 const add=grant=>send(grant,{type:'add',pageId:page,anchor:{format:'local',points:[{x:10,y:20}],fallback:[{x:10,y:20}]},body:'Original'});
 try{await work({get relay(){return relay;},database,owner,viewer,editor,page,peer,state,packet,call,send,list,action,refused,add,async restart(){await relay.close();relay=await createRoomRelay({database,adminSecret:administrator,grantSecret:administrator,engine});}});}
 finally{replicas.forEach(replica=>replica.dispose());await relay.close();await rm(folder,{recursive:true,force:true});}
}
const comments=c=>engine.api.allComments(c.peer().graph);
test('viewer creation undo/redo restores original identity/time after restart and immutable history replies recover once',()=>fixture(async c=>{
 const original=await c.add(c.viewer),before=comments(c);const undo=await c.action(c.viewer,original);assert.deepEqual(comments(c),[]);assert.equal((await c.list(c.viewer)).entries[0].step,1);
 await c.restart();c.relay.store.db.prepare('UPDATE members SET name=? WHERE id=?').run('Renamed',c.viewer.actor.id);
 const retried=await c.send(c.viewer,undo.outgoing.command,undo.outgoing,true);assert.equal(retried.acceptedRevision,undo.acceptedRevision);assert.deepEqual(comments(c),[]);assert.equal((await c.list(c.viewer)).entries[0].step,1);
 await c.action(c.viewer,original,'redo',1);assert.deepEqual(comments(c),before);assert.equal((await c.list(c.viewer)).entries[0].step,2);
}));
test('reply removal/restoration preserves peer messages and restores original ordering and authors',()=>fixture(async c=>{
 const root=await c.add(c.owner),a=await c.send(c.viewer,{type:'reply',threadId:root.result.threadId,body:'Viewer reply'});await c.send(c.editor,{type:'reply',threadId:root.result.threadId,body:'Later peer reply'});
 const before=comments(c)[0];await c.action(c.viewer,a);assert.deepEqual(comments(c)[0].messages.map(message=>message.body),['Original','Later peer reply']);await c.action(c.viewer,a,'redo',1);assert.deepEqual(comments(c)[0],before);
}));
test('body undo preserves foreign reactions and successive own edits can be reversed and reapplied in order',()=>fixture(async c=>{
 const root=await c.add(c.viewer),threadId=root.result.threadId,messageId=root.result.messageId,a=await c.send(c.viewer,{type:'edit',threadId,messageId,body:'First'}),b=await c.send(c.viewer,{type:'edit',threadId,messageId,body:'Second'});
 await c.send(c.editor,{type:'react',threadId,messageId,emoji:'👍'});await c.refused(c.viewer,{type:'history',threadId,sourceClientId:a.outgoing.clientId,sourceRequestId:a.outgoing.requestId,direction:'undo',step:0},409);
 await c.action(c.viewer,b);await c.action(c.viewer,a);assert.equal(comments(c)[0].messages[0].body,'Original');assert.equal(comments(c)[0].messages[0].editedAt,undefined);assert.deepEqual(comments(c)[0].messages[0].reactions,[{emoji:'👍',authors:[c.editor.actor.id]}]);await c.action(c.viewer,a,'redo',1);await c.action(c.viewer,b,'redo',1);assert.equal(comments(c)[0].messages[0].body,'Second');
}));
test('root deletion undo authentically restores peer replies, labels, reactions and resolution without accepting caller snapshots',()=>fixture(async c=>{
 const root=await c.add(c.viewer),threadId=root.result.threadId;await c.send(c.editor,{type:'reply',threadId,body:'Peer'});await c.send(c.editor,{type:'resolve',threadId,resolved:true});const before=comments(c);
 const removed=await c.send(c.viewer,{type:'delete',threadId,messageId:root.result.messageId});assert.deepEqual(comments(c),[]);await c.action(c.viewer,removed);assert.deepEqual(comments(c),before);
 await c.refused(c.viewer,{...removed.outgoing.command,type:'history',sourceClientId:removed.outgoing.clientId,sourceRequestId:removed.outgoing.requestId,direction:'redo',step:1,restore:before},422);await c.action(c.viewer,removed,'redo',1);assert.deepEqual(comments(c),[]);
}));
test('own reaction undo/redo preserves peer reactions and resolution undo restores authenticated foreign attribution',()=>fixture(async c=>{
 const root=await c.add(c.owner),threadId=root.result.threadId,messageId=root.result.messageId,a=await c.send(c.viewer,{type:'react',threadId,messageId,emoji:'👍'});await c.send(c.editor,{type:'react',threadId,messageId,emoji:'👍'});await c.action(c.viewer,a);assert.deepEqual(comments(c)[0].messages[0].reactions,[{emoji:'👍',authors:[c.editor.actor.id]}]);await c.action(c.viewer,a,'redo',1);assert.equal(comments(c)[0].messages[0].reactions[0].authors.length,2);
 await c.send(c.editor,{type:'resolve',threadId,resolved:true});const before=comments(c)[0];const reopen=await c.send(c.viewer,{type:'resolve',threadId,resolved:false});await c.action(c.viewer,reopen);assert.deepEqual(comments(c)[0],before);
}));
test('pin relocation undo preserves replies and refuses restoration into a deleted page',()=>fixture(async c=>{
 const root=await c.add(c.viewer),threadId=root.result.threadId,source=c.peer();let page;source.edit('Page',graph=>{page=graph.createNode('CANVAS',graph.rootId,{name:'Other'}).id;});const art=()=>({version:1,type:'update',documentId,clientId:'artwork_client_001',requestId:randomUUID(),vector:engine.api.roomBinary(source.stateVector(),true),update:engine.api.roomBinary(source.update())});c.relay.store.exchange(c.owner.actor,art());
 const moved=await c.send(c.viewer,{type:'move',threadId,pageId:page,anchor:{format:'local',points:[{x:100,y:200}],fallback:[{x:100,y:200}]}});await c.send(c.editor,{type:'reply',threadId,body:'Peer reply'});await c.action(c.viewer,moved);assert.equal(comments(c)[0].ownerPageId,c.page);assert.equal(comments(c)[0].messages.length,2);await c.action(c.viewer,moved,'redo',1);source.receive(c.peer().update());source.edit('Delete old page',graph=>graph.deleteNode(c.page));c.relay.store.exchange(c.owner.actor,art());
 await c.refused(c.viewer,{type:'history',threadId,sourceClientId:moved.outgoing.clientId,sourceRequestId:moved.outgoing.requestId,direction:'undo',step:2},409);assert.equal(comments(c)[0].ownerPageId,page);
}));
test('destructive root/reply undo cannot erase later peer replies or reactions and old roots remain absent',()=>fixture(async c=>{
 const root=await c.add(c.viewer),threadId=root.result.threadId;await c.send(c.editor,{type:'reply',threadId,body:'Keep peer'});await c.refused(c.viewer,{type:'history',threadId,sourceClientId:root.outgoing.clientId,sourceRequestId:root.outgoing.requestId,direction:'undo',step:0},409);
 const reply=await c.send(c.viewer,{type:'reply',threadId,body:'Own reply'});await c.send(c.editor,{type:'react',threadId,messageId:reply.result.messageId,emoji:'👀'});await c.refused(c.viewer,{type:'history',threadId,sourceClientId:reply.outgoing.clientId,sourceRequestId:reply.outgoing.requestId,direction:'undo',step:0},409);
}));
test('cross-member/source/step claims, revocation and corrupt history fail without changing checkpoint/receipt/ledger bytes',()=>fixture(async c=>{
 const root=await c.add(c.viewer),command={type:'history',threadId:root.result.threadId,sourceClientId:root.outgoing.clientId,sourceRequestId:root.outgoing.requestId,direction:'undo',step:0};await c.refused(c.owner,command,404);await c.refused(c.viewer,{...command,step:1},409);await c.refused(c.viewer,{...command,threadId:'foreign_thread'},409);
 c.relay.store.db.prepare('UPDATE comment_history SET data=?').run('{}');await c.refused(c.viewer,command,500);c.relay.store.changeMember(documentId,c.owner.actor,c.viewer.actor.id,null);await c.refused(c.viewer,command,401);
}));
test('same-value ABA service and raw edits invalidate provenance while undoing the intervening edits restores their predecessor',()=>fixture(async c=>{
 const root=await c.add(c.editor),threadId=root.result.threadId,messageId=root.result.messageId,a=await c.send(c.editor,{type:'edit',threadId,messageId,body:'First'});await c.send(c.editor,{type:'edit',threadId,messageId,body:'Other'});await c.send(c.editor,{type:'edit',threadId,messageId,body:'First'});
 await c.refused(c.editor,{type:'history',threadId,sourceClientId:a.outgoing.clientId,sourceRequestId:a.outgoing.requestId,direction:'undo',step:0},409);
 const latest=(await c.list(c.editor)).entries[0],fresh=await c.send(c.editor,{type:'edit',threadId,messageId,body:'Raw ABA target'}),source=c.peer();
 for(const body of ['Raw other','Raw ABA target']){source.edit('Raw body',graph=>{const page=graph.getNode(c.page),data=JSON.parse(page.pluginData.find(entry=>entry.pluginId==='orion.xdesign.comments').value);data.threads[0].messages[0].body=body;graph.updateNode(c.page,{pluginData:[{pluginId:'orion.xdesign.comments',key:'threads',value:JSON.stringify(data)}]});});c.relay.store.exchange(c.editor.actor,{version:1,type:'update',documentId,clientId:'raw_history_client_001',requestId:randomUUID(),vector:engine.api.roomBinary(source.stateVector(),true),update:engine.api.roomBinary(source.update())});}
 await c.refused(c.editor,{type:'history',threadId,sourceClientId:fresh.outgoing.clientId,sourceRequestId:fresh.outgoing.requestId,direction:'undo',step:0},409);assert.ok(latest.id>0);
}));
test('checkpoint/ledger/token/receipt changes rollback together on injected write failure',()=>fixture(async c=>{
 const root=await c.add(c.viewer),before=c.state();c.relay.store.db.exec("CREATE TRIGGER reject_history BEFORE UPDATE ON comment_history BEGIN SELECT RAISE(ABORT,'history failure'); END;");
 await c.refused(c.viewer,{type:'history',threadId:root.result.threadId,sourceClientId:root.outgoing.clientId,sourceRequestId:root.outgoing.requestId,direction:'undo',step:0},500);assert.deepEqual(c.state(),before);c.relay.store.db.exec('DROP TRIGGER reject_history');await c.action(c.viewer,root);
}));
test('history pages are fresh member scoped, bounded and seek-paginated without changing artwork',()=>fixture(async c=>{
 const root=await c.add(c.viewer);for(let i=0;i<104;i++)await c.send(c.viewer,{type:'resolve',threadId:root.result.threadId,resolved:i%2===0});const before=c.state(),first=await c.list(c.viewer);assert.equal(first.entries.length,100);assert.ok(first.next);const second=await c.list(c.viewer,first.next);assert.equal(second.entries.length,5);assert.equal(second.next,null);assert.equal(new Set([...first.entries,...second.entries].map(entry=>entry.id)).size,105);assert.deepEqual((await c.list(c.owner)).entries,[]);assert.deepEqual(c.state(),before);
 const response=await c.call(c.viewer,undefined,false,`/v1/rooms/${documentId}/comments/history`,'POST');assert.equal(response.status,405);
}));
test('known format-two room databases append history atomically and preserve old grant/room/receipt rows',()=>fixture(async c=>{
 const root=await c.add(c.viewer),db=c.relay.store.db;db.exec("DROP TABLE room_images;DROP TABLE room_image_revisions;DROP TABLE room_image_chunks;DROP TABLE room_image_uploads;DROP TABLE room_library_receipts;DROP TABLE room_library_revisions;DROP TABLE room_libraries;DROP TABLE comment_author_receipts;DROP TABLE comment_authors;DROP TABLE comment_fields;DROP TABLE comment_history;UPDATE room_meta SET value='2' WHERE key='version';");const rooms=db.prepare('SELECT * FROM rooms').all(),receipts=db.prepare('SELECT * FROM receipts').all();db.exec("CREATE TRIGGER fail_history_upgrade BEFORE UPDATE ON room_meta WHEN NEW.value='3' BEGIN SELECT RAISE(ABORT,'history upgrade failure'); END;");await c.relay.close();const bytes=await readFile(c.database);await assert.rejects(c.restart(),/upgrade failure/);assert.ok(bytes.equals(await readFile(c.database)));
 const repair=new DatabaseSync(c.database);assert.equal(repair.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('comment_fields','comment_history')").get().n,0);repair.exec('DROP TRIGGER fail_history_upgrade');repair.close();await c.restart();assert.deepEqual(c.relay.store.db.prepare('SELECT * FROM rooms').all(),rooms);assert.deepEqual(c.relay.store.db.prepare('SELECT * FROM receipts').all(),receipts);assert.equal(c.relay.store.db.prepare("SELECT value FROM room_meta WHERE key='version'").get().value,'6');assert.deepEqual((await c.list(c.viewer)).entries,[]);await c.refused(c.viewer,{type:'history',threadId:root.result.threadId,sourceClientId:root.outgoing.clientId,sourceRequestId:root.outgoing.requestId,direction:'undo',step:0},404);
}));
test('failed grant-key validation cannot append history to a known format-two database',()=>fixture(async c=>{
 c.relay.store.invite(documentId,c.owner.actor,'Encrypted grant','viewer',randomUUID());c.relay.store.db.exec("DROP TABLE room_images;DROP TABLE room_image_revisions;DROP TABLE room_image_chunks;DROP TABLE room_image_uploads;DROP TABLE room_library_receipts;DROP TABLE room_library_revisions;DROP TABLE room_libraries;DROP TABLE comment_author_receipts;DROP TABLE comment_authors;DROP TABLE comment_fields;DROP TABLE comment_history;UPDATE room_meta SET value='2' WHERE key='version';");await c.relay.close();const bytes=await readFile(c.database);
 await assert.rejects(createRoomRelay({database:c.database,adminSecret:administrator,grantSecret:'wrong-history-key-'.repeat(4),engine}),/does not match/);assert.ok(bytes.equals(await readFile(c.database)));await c.restart();
}));
test('reply deletion undo preserves newer replies and authenticated original message metadata',()=>fixture(async c=>{
 const root=await c.add(c.owner),threadId=root.result.threadId,reply=await c.send(c.viewer,{type:'reply',threadId,body:'Restore me'});await c.send(c.editor,{type:'react',threadId,messageId:reply.result.messageId,emoji:'👀'});const original=comments(c)[0].messages[1];
 const removed=await c.send(c.viewer,{type:'delete',threadId,messageId:reply.result.messageId});await c.send(c.editor,{type:'reply',threadId,body:'Keep newer reply'});await c.action(c.viewer,removed);assert.deepEqual(comments(c)[0].messages[1],original);assert.equal(comments(c)[0].messages[2].body,'Keep newer reply');await c.action(c.viewer,removed,'redo',1);assert.deepEqual(comments(c)[0].messages.map(message=>message.body),['Original','Keep newer reply']);
}));
test('no-op resolution and pin requests retain receipts without creating false history or replacing field provenance',()=>fixture(async c=>{
 const root=await c.add(c.viewer),before=c.relay.store.db.prepare('SELECT * FROM comment_fields').all();await c.send(c.viewer,{type:'resolve',threadId:root.result.threadId,resolved:false});await c.send(c.viewer,{type:'move',threadId:root.result.threadId,pageId:c.page,anchor:comments(c)[0].anchor});assert.equal((await c.list(c.viewer)).entries.length,1);assert.deepEqual(c.relay.store.db.prepare('SELECT * FROM comment_fields').all(),before);await c.action(c.viewer,root);assert.deepEqual(comments(c),[]);
}));
test('retained field capacity refuses new changes atomically while existing undo and redo remain available',()=>fixture(async c=>{
 const root=await c.add(c.viewer),db=c.relay.store.db;db.exec('BEGIN IMMEDIATE');try{const insert=db.prepare('INSERT INTO comment_fields(room_id,thread_id,field,token) VALUES(?,?,?,?)');for(let i=0;i<99999;i++)insert.run(documentId,'capacity_thread',`field_${i}`,'capacity');db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 await c.refused(c.viewer,{type:'reply',threadId:root.result.threadId,body:'Above capacity'},413);assert.equal(db.prepare('SELECT count(*) AS n FROM comment_fields').get().n,100000);await c.action(c.viewer,root);assert.deepEqual(comments(c),[]);await c.action(c.viewer,root,'redo',1);assert.equal(comments(c).length,1);
}));
test('independent SQLite writers admit the same history request once without toggling its state twice',()=>fixture(async c=>{
 const root=await c.add(c.viewer),packet=c.packet({type:'history',threadId:root.result.threadId,sourceClientId:root.outgoing.clientId,sourceRequestId:root.outgoing.requestId,direction:'undo',step:0});
 const workers=Array.from({length:2},()=>new Worker(`const{parentPort,workerData}=require('node:worker_threads');(async()=>{const{roomEngine}=await import(workerData.engine);const{RoomStore}=await import(workerData.store);const engine=await roomEngine(),store=new RoomStore(workerData.database,engine.api,{grantSecret:workerData.secret});parentPort.postMessage({ready:true});parentPort.once('message',()=>{try{parentPort.postMessage({reply:store.comment(workerData.actor,workerData.packet)});}catch(error){parentPort.postMessage({error:error.message});}finally{store.close();parentPort.close();}});})().catch(error=>{parentPort.postMessage({error:error.message});parentPort.close();});`,{eval:true,workerData:{engine:new URL('./xdesign-room-engine.mjs',import.meta.url).href,store:new URL('./xdesign-room-store.mjs',import.meta.url).href,database:c.database,secret:administrator,actor:c.viewer.actor,packet}}));
 try{const replies=workers.map(worker=>new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',value=>{if(value.error)reject(new Error(value.error));else if(value.reply)resolve(value.reply);});}));await Promise.all(workers.map(worker=>new Promise(resolve=>worker.once('message',resolve))));workers.forEach(worker=>worker.postMessage('go'));const accepted=await Promise.all(replies);assert.equal(accepted[0].acceptedRevision,accepted[1].acceptedRevision);assert.deepEqual(comments(c),[]);assert.equal((await c.list(c.viewer)).entries[0].step,1);assert.equal(c.relay.store.db.prepare('SELECT count(*) AS n FROM receipts WHERE request_id=?').get(packet.requestId).n,1);}finally{await Promise.all(workers.map(worker=>worker.terminate()));}
}));

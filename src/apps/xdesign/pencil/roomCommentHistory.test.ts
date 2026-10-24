import { expect, it } from 'vitest';
import { SceneGraph } from '@open-pencil/scene-graph';
import { addComment, allComments, createCommentAnchor } from './comments';
import { createEditor } from '@open-pencil/core/editor';
import { commentHistorySnapshot, replayCommentHistory, readCommentHistoryRecord, changedCommentFields, type CommentHistoryRecord } from './roomCommentHistory';
import { applyRoomCommentCommand } from './roomCommentCommands';
import { readRoomCommentHistoryPage, readRoomCommentRequest, type RoomCommentAction } from './roomCommentProtocol';
const actor={id:'history_member_001',name:'Author',role:'viewer' as const};
it.each(['reply','edit','delete','resolve','move','react'] as const)('selectively replays %s and preserves peer metadata',type=>{
  const graph=new SceneGraph(),page=graph.getPages()[0]!.id,editor=createEditor({graph});
  try {
    const threadId=addComment(editor,page,createCommentAnchor(graph,page,[{x:1,y:2}]),{id:actor.id,name:actor.name},'Original'),root=allComments(graph)[0]!.messages[0]!.id;
    const command:RoomCommentAction=type==='reply'?{type,threadId,body:'Reply'}:type==='edit'?{type,threadId,messageId:root,body:'Changed'}:type==='delete'?{type,threadId,messageId:root}:type==='resolve'?{type,threadId,resolved:true}:type==='move'?{type,threadId,pageId:page,anchor:createCommentAnchor(graph,page,[{x:50,y:60}])}:{type,threadId,messageId:root,emoji:'👍'};
    const result={threadId,...(['reply','edit','delete','react'].includes(type)?{messageId:type==='reply'?'reply_message':root}:{})},before=commentHistorySnapshot(graph,threadId);
    applyRoomCommentCommand(graph,command,actor,result,1000);const after=commentHistorySnapshot(graph,threadId),record:CommentHistoryRecord={version:1,actorId:actor.id,command,result,before,after};
    replayCommentHistory(graph,record,'undo');expect(commentHistorySnapshot(graph,threadId)).toEqual(before);replayCommentHistory(graph,record,'redo');expect(commentHistorySnapshot(graph,threadId)).toEqual(after);
  }finally{editor.dispose();}
});
it('keeps peer reactions during body and own-reaction undo, and refuses destructive creation undo after a peer reply',()=>{
  const graph=new SceneGraph(),page=graph.getPages()[0]!.id,root='root_message',threadId='root_thread',add={type:'add' as const,pageId:page,anchor:createCommentAnchor(graph,page,[{x:1,y:2}]),body:'Original'},result={threadId,messageId:root};
  applyRoomCommentCommand(graph,add,actor,result,1000);const initial=commentHistorySnapshot(graph,threadId)!;
  const edit={type:'edit' as const,threadId,messageId:root,body:'Changed'},record:CommentHistoryRecord={version:1,actorId:actor.id,command:edit,result,before:initial,after:null};applyRoomCommentCommand(graph,edit,actor,result,2000);record.after=commentHistorySnapshot(graph,threadId);
  const peer={...actor,id:'peer_history_001',name:'Peer'};applyRoomCommentCommand(graph,{type:'react',threadId,messageId:root,emoji:'👍'},peer,result,3000);replayCommentHistory(graph,record,'undo');expect(allComments(graph)[0]!.messages[0]).toMatchObject({body:'Original',reactions:[{emoji:'👍',authors:[peer.id]}]});
  const react={type:'react' as const,threadId,messageId:root,emoji:'👍'},reaction:CommentHistoryRecord={version:1,actorId:actor.id,command:react,result,before:commentHistorySnapshot(graph,threadId),after:null};applyRoomCommentCommand(graph,react,actor,result,4000);reaction.after=commentHistorySnapshot(graph,threadId);replayCommentHistory(graph,reaction,'undo');expect(allComments(graph)[0]!.messages[0]!.reactions).toEqual([{emoji:'👍',authors:[peer.id]}]);
  applyRoomCommentCommand(graph,{type:'reply',threadId,body:'Peer reply'},peer,{threadId,messageId:'peer_reply'},5000);expect(()=>replayCommentHistory(graph,{version:1,actorId:actor.id,command:add,result,before:null,after:initial},'undo')).toThrow('changed');expect(allComments(graph)[0]!.messages).toHaveLength(2);
});
it('validates stored records and closes history packets/pages with monotonic bounded pagination',()=>{
  const doc='history_document_001',entry={id:3,clientId:'history_client_001',requestId:'history_request_001',threadId:'thread',action:'edit',undone:false,step:0,revision:2},page={version:1,documentId:doc,actor,entries:[entry],next:null};expect(readRoomCommentHistoryPage(page,doc).entries[0]!.id).toBe(3);
  for(const patch of [{entries:[entry,entry]},{next:3},{actor:{...actor,secret:'no'}},{entries:[{...entry,step:-1}]},{entries:[{...entry,id:4}]}])expect(()=>readRoomCommentHistoryPage({...page,...patch},doc,4)).toThrow();
  const command={type:'history',threadId:'thread',sourceClientId:entry.clientId,sourceRequestId:entry.requestId,direction:'undo',step:0};expect(readRoomCommentRequest({version:1,type:'comment',documentId:doc,clientId:entry.clientId,requestId:entry.requestId,vector:'AA==',command}).packet.command).toEqual(command);
  expect(()=>readCommentHistoryRecord({version:1,actorId:actor.id,command,result:{threadId:'thread'},before:null,after:null})).toThrow();expect(changedCommentFields([],[])).toEqual([]);
});

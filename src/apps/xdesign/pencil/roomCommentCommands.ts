import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { COMMENT_KEY, COMMENT_PLUGIN, allComments, readPageComments, type CommentThread, type CommentAnchor, type CommentMessage } from './comments';
import { readRoomCommentActor, readRoomCommentCommand, roomCommentId, type RoomCommentCommand, type RoomCommentResult } from './roomCommentProtocol';
import type { RoomActor } from './sharedRoomProtocol';
import { ownsCommentAuthor, type CommentAuthorGrants } from './roomCommentOwnership';

export class RoomCommentActionError extends Error {
  constructor(readonly status: 403 | 404 | 409, readonly code: 'comments' | 'missing' | 'conflict', message: string) { super(message); this.name = 'RoomCommentActionError'; }
}
function requireAuthor(allowed: boolean) { if (!allowed) throw new RoomCommentActionError(403, 'comments', 'Only the comment author can change this message or pin.'); }
function page(graph: SceneGraph, id: string): SceneNode {
  const node = graph.getNode(id); if (!node || node.type !== 'CANVAS' || node.internalOnly) throw new RoomCommentActionError(404, 'missing', 'This comment page is no longer available.'); return node;
}
function checkAnchor(graph: SceneGraph, pageId: string, anchor: CommentAnchor) {
  page(graph, pageId); if (!anchor.nodeId) return;
  let node = graph.getNode(anchor.nodeId); const seen = new Set<string>();
  if (!node || node.type === 'CANVAS' || node.width <= 0 || node.height <= 0) throw new RoomCommentActionError(409, 'conflict', 'The comment target changed. Choose its position again.');
  while (node && node.type !== 'CANVAS') { if (node.internalOnly || seen.has(node.id)) break; seen.add(node.id); node = node.parentId ? graph.getNode(node.parentId) : undefined; }
  if (node?.id !== pageId || node.type !== 'CANVAS' || node.internalOnly) throw new RoomCommentActionError(409, 'conflict', 'The comment target changed. Choose its position again.');
}
export function writeCommentPage(graph: SceneGraph, id: string, threads: CommentThread[]) {
  const node = page(graph, id);
  graph.updateNode(id, { pluginData: [...node.pluginData.filter(entry => entry.pluginId !== COMMENT_PLUGIN || entry.key !== COMMENT_KEY), ...(threads.length ? [{ pluginId: COMMENT_PLUGIN, key: COMMENT_KEY, value: JSON.stringify({ version: 1, threads }) }] : [])] });
}
export function applyRoomCommentCommand(graph: SceneGraph, command: RoomCommentCommand, actor: RoomActor, result: RoomCommentResult, now: number, grants?: CommentAuthorGrants): void {
  command = readRoomCommentCommand(command);
  if (command.type === 'history') throw new Error('Use the authenticated comment ledger to replay history.');
  actor = readRoomCommentActor(actor);
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw new Error('Invalid authenticated comment time.');
  roomCommentId(result.threadId); if (result.messageId !== undefined) roomCommentId(result.messageId);
  const existing = allComments(graph), author = { id: actor.id, name: actor.name };
  const message = (body: string): CommentMessage => { if (!result.messageId) throw new Error('The service did not assign a message identity.'); return { id: result.messageId, author, body, createdAt: now, reactions: [] }; };
  if (command.type === 'add') {
    checkAnchor(graph, command.pageId, command.anchor);
    if (existing.some(thread => thread.id === result.threadId)) throw new RoomCommentActionError(409, 'conflict', 'This comment identity already exists.');
    writeCommentPage(graph, command.pageId, [...readPageComments(page(graph, command.pageId)), { id: result.threadId, anchor: command.anchor, messages: [message(command.body)], resolved: false }]);
  } else {
    if (result.threadId !== command.threadId || 'messageId' in command && result.messageId !== command.messageId) throw new Error('The service assigned a different comment identity.');
    const found = existing.find(thread => thread.id === command.threadId); if (!found) throw new RoomCommentActionError(404, 'missing', 'This comment thread is no longer available.');
    const threads = structuredClone(readPageComments(page(graph, found.ownerPageId))), index = threads.findIndex(thread => thread.id === found.id), thread = threads[index]!;
    if (command.type === 'reply') {
      if (thread.messages.some(message => message.id === result.messageId)) throw new RoomCommentActionError(409, 'conflict', 'This reply identity already exists.');
      thread.messages.push(message(command.body));
    } else if (command.type === 'move') {
      requireAuthor(ownsCommentAuthor(thread.messages[0]!.author.id, actor, grants)); checkAnchor(graph, command.pageId, command.anchor); thread.anchor = command.anchor;
      if (command.pageId !== found.ownerPageId) { threads.splice(index, 1); writeCommentPage(graph, found.ownerPageId, threads); writeCommentPage(graph, command.pageId, [...readPageComments(page(graph, command.pageId)), thread]); allComments(graph); return; }
    } else if (command.type === 'resolve') {
      if (thread.resolved !== command.resolved) { thread.resolved = command.resolved; if (command.resolved) { thread.resolvedBy = author; thread.resolvedAt = now; } else { delete thread.resolvedBy; delete thread.resolvedAt; } }
    } else {
      const messageIndex = thread.messages.findIndex(message => message.id === command.messageId), item = thread.messages[messageIndex];
      if (!item) throw new RoomCommentActionError(404, 'missing', 'This comment message is no longer available.');
      if (command.type === 'edit') { requireAuthor(ownsCommentAuthor(item.author.id, actor, grants)); item.body = command.body; item.editedAt = now; }
      else if (command.type === 'delete') { requireAuthor(ownsCommentAuthor(item.author.id, actor, grants)); if (messageIndex === 0) threads.splice(index, 1); else thread.messages.splice(messageIndex, 1); }
      else {
        let reaction = item.reactions.find(reaction => reaction.emoji === command.emoji); if (!reaction) { reaction = { emoji: command.emoji, authors: [] }; item.reactions.push(reaction); }
        const position = reaction.authors.indexOf(actor.id); if (position === -1) reaction.authors.push(actor.id); else reaction.authors.splice(position, 1);
        item.reactions = item.reactions.filter(reaction => reaction.authors.length);
      }
    }
    writeCommentPage(graph, found.ownerPageId, threads);
  }
  allComments(graph);
}

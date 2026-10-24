import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { COMMENT_KEY, COMMENT_PLUGIN, allComments, readPageComments, validCommentAuthor, type CommentAuthor, type CommentMessage, type CommentThread } from './comments';
import type { RoomActor } from './sharedRoomProtocol';
import { ownsCommentAuthor, type CommentAuthorGrants } from './roomCommentOwnership';

export class RoomCommentPermissionError extends Error {
  constructor(message: string) { super(message); this.name = 'RoomCommentPermissionError'; }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const entries = (node?: SceneNode) => node?.pluginData.filter(entry => entry.pluginId === COMMENT_PLUGIN && entry.key === COMMENT_KEY) ?? [];
function requirePermission(allowed: boolean, message: string): asserts allowed {
  if (!allowed) throw new RoomCommentPermissionError(message);
}
function authorMatches(author: CommentAuthor, actor: RoomActor) { return author.id === actor.id && author.name === actor.name; }
function ownReactions(message: CommentMessage, actor: RoomActor) { return message.reactions.every(reaction => reaction.authors.every(id => id === actor.id)); }
function reactionPeers(message: CommentMessage, actor: RoomActor) {
  return message.reactions.flatMap(reaction => reaction.authors.filter(id => id !== actor.id).map(id => JSON.stringify([reaction.emoji, id]))).sort();
}
function resolution(thread: CommentThread) { return [thread.resolved, thread.resolvedBy, thread.resolvedAt]; }
function checkResolution(thread: CommentThread, actor: RoomActor) {
  requirePermission(thread.resolved ? !!thread.resolvedBy && authorMatches(thread.resolvedBy, actor) && thread.resolvedAt !== undefined : thread.resolvedBy === undefined && thread.resolvedAt === undefined, 'Comment resolution must identify the current room member.');
}
function threads(graph: SceneGraph) {
  allComments(graph);
  const result = new Map<string, { thread: CommentThread; page: string }>(); let units = 0;
  for (const page of graph.getPages(true)) {
    units += entries(page).reduce((sum, entry) => sum + entry.value.length, 0);
    if (units > 8 * 1024 * 1024) throw new Error('Comments exceed the room storage limit.');
    for (const thread of readPageComments(page)) {
      if (result.has(thread.id) || result.size >= 1000) throw new Error('Duplicate or excessive room comment threads.');
      result.set(thread.id, { thread, page: page.id });
    }
  }
  return result;
}

export function assertRoomCommentChanges(before: SceneGraph, after: SceneGraph, actor: RoomActor, grants?: CommentAuthorGrants, restored?: ReadonlySet<string>): void {
  let changed = false;
  for (const id of new Set([...before.nodes.keys(), ...after.nodes.keys()])) {
    const old = before.getNode(id), next = after.getNode(id), oldEntries = entries(old), nextEntries = entries(next);
    if (!oldEntries.length && !nextEntries.length) continue;
    if (same(oldEntries, nextEntries) && old?.type === next?.type && old?.internalOnly === next?.internalOnly) continue;
    changed = true;
    requirePermission(!nextEntries.length || next?.type === 'CANVAS' && !next.internalOnly, 'Room comments must remain on a visible page.');
    requirePermission(!oldEntries.length || old?.type === 'CANVAS', 'Reserved comment metadata cannot be changed on artwork layers.');
  }
  if (!changed) return;
  requirePermission(actor.role !== 'viewer' && validCommentAuthor({ id: actor.id, name: actor.name }), 'Reconnect with an editing room membership before changing comments.');
  const old = threads(before), next = threads(after);
  const permittedAuthor = (threadId: string, message: CommentMessage) => authorMatches(message.author, actor) || ownsCommentAuthor(message.author.id, actor, grants) && restored?.has(JSON.stringify([threadId, message.id])) === true;
  for (const [id, previous] of old) {
    const current = next.get(id);
    if (!current) {
      // Deleting a page is an artwork operation; its attached threads go with it.
      requirePermission(!after.getNode(previous.page) || ownsCommentAuthor(previous.thread.messages[0]!.author.id, actor, grants), 'Only the original comment author can delete a thread.');
      continue;
    }
    const a = previous.thread, b = current.thread;
    requirePermission(a.messages[0]!.id === b.messages[0]!.id, 'The original comment message cannot be replaced.');
    requirePermission(same(a.anchor, b.anchor) && previous.page === current.page || ownsCommentAuthor(a.messages[0]!.author.id, actor, grants) || !after.getNode(previous.page) && same(a.anchor, b.anchor), 'Only the original comment author can move a thread.');
    if (!same(resolution(a), resolution(b))) checkResolution(b, actor);
    const messages = new Map(a.messages.map(message => [message.id, message]));
    for (const message of b.messages) {
      const previous = messages.get(message.id);
      if (!previous) {
        requirePermission(permittedAuthor(id, message) && ownReactions(message, actor), 'New comment messages must belong to the current room member.');
        continue;
      }
      requirePermission(same(previous.author, message.author) && previous.createdAt === message.createdAt, 'A comment author and creation time cannot be rewritten.');
      requirePermission(previous.body === message.body && previous.editedAt === message.editedAt || ownsCommentAuthor(previous.author.id, actor, grants), 'Only the message author can edit a comment.');
      requirePermission(same(reactionPeers(previous, actor), reactionPeers(message, actor)), 'Only your own comment reactions can be changed.');
      messages.delete(message.id);
    }
    requirePermission([...messages.values()].every(message => ownsCommentAuthor(message.author.id, actor, grants)), 'Only the message author can delete a reply.');
  }
  for (const [id, { thread }] of next) if (!old.has(id)) {
    requirePermission(thread.messages.every(message => permittedAuthor(id, message) && ownReactions(message, actor)), 'New comment threads must belong to the current room member.');
    checkResolution(thread, actor);
  }
}

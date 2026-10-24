import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph';
import { allComments, readPageComments, COMMENT_PLUGIN, COMMENT_KEY, type LocatedComment } from './comments';
import { RoomCommentActionError, writeCommentPage } from './roomCommentCommands';
import { readRoomCommentCommand, roomCommentId, type RoomCommentAction, type RoomCommentResult } from './roomCommentProtocol';
import { validateSharedDocumentId } from './sharedCheckpoint';
import { ownsCommentAuthor, type CommentAuthorGrants } from './roomCommentOwnership';
import type { RoomActor } from './sharedRoomProtocol';

export type CommentHistoryRecord = { version: 1; actorId: string; command: RoomCommentAction; result: RoomCommentResult; before: LocatedComment | null; after: LocatedComment | null };
const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key,v]) => [key,normalize(v)])) : value;
const equal = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
const conflict = () => new RoomCommentActionError(409, 'conflict', 'This comment changed after the recorded action. Its current state was preserved.');
export function commentHistorySnapshot(graph: SceneGraph, threadId: string): LocatedComment | null { return structuredClone(allComments(graph).find(thread => thread.id === threadId) ?? null); }
function located(value: unknown): LocatedComment | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid stored comment history.');
  const { ownerPageId, ...thread } = value as LocatedComment; roomCommentId(ownerPageId);
  const checked = readPageComments({ pluginData: [{ pluginId: COMMENT_PLUGIN, key: COMMENT_KEY, value: JSON.stringify({ version: 1, threads: [thread] }) }] } as SceneNode)[0]!;
  return { ...structuredClone(checked), ownerPageId };
}
export function readCommentHistoryRecord(value: unknown): CommentHistoryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 6 || Object.keys(value).some(key => !['version','actorId','command','result','before','after'].includes(key))) throw new Error('Invalid stored comment history.');
  const record = value as CommentHistoryRecord, command = readRoomCommentCommand(record.command);
  if (record.version !== 1 || command.type === 'history') throw new Error('Unsupported stored comment history.');
  validateSharedDocumentId(record.actorId); const before = located(record.before), after = located(record.after), result = record.result;
  const hasMessage = ['add','reply','edit','delete','react'].includes(command.type);
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.keys(result).length !== (hasMessage ? 2 : 1) || Object.keys(result).some(key => !['threadId', ...(hasMessage ? ['messageId'] : [])].includes(key))) throw new Error('Invalid stored history result.');
  roomCommentId(result.threadId); if (hasMessage) roomCommentId(result.messageId);
  if (before && before.id !== result.threadId || after && after.id !== result.threadId || 'threadId' in command && command.threadId !== result.threadId || 'messageId' in command && command.messageId !== result.messageId || !before && !after) throw new Error('Invalid stored history identity.');
  return { version: 1, actorId: record.actorId, command, result: { ...result }, before, after };
}
function root(record: CommentHistoryRecord) { return (record.before ?? record.after)!.messages[0]!.id; }
function message(thread: LocatedComment | null, id?: string) { return thread?.messages.find(message => message.id === id) ?? null; }
function body(thread: LocatedComment | null, id?: string) { const item = message(thread,id); return item ? { body: item.body, editedAt: item.editedAt } : null; }
function resolution(thread: LocatedComment | null) { return thread ? { resolved: thread.resolved, resolvedBy: thread.resolvedBy, resolvedAt: thread.resolvedAt } : null; }
function pin(thread: LocatedComment | null) { return thread ? { anchor: thread.anchor, ownerPageId: thread.ownerPageId } : null; }
function reaction(thread: LocatedComment | null, record: CommentHistoryRecord) { const command = record.command; return command.type === 'react' && !!message(thread,record.result.messageId)?.reactions.find(reaction => reaction.emoji === command.emoji)?.authors.includes(record.actorId); }
export function commentHistoryField(record: CommentHistoryRecord): string {
  switch (record.command.type) {
    case 'add': return 'exist';
    case 'reply': return `exist:${record.result.messageId}`;
    case 'delete': return record.result.messageId === root(record) ? 'exist' : `exist:${record.result.messageId}`;
    case 'edit': return `body:${record.result.messageId}`;
    case 'move': return 'anchor';
    case 'resolve': return 'resolution';
    case 'react': return `reaction:${record.result.messageId}:${record.actorId}:${record.command.emoji}`;
  }
}
function projection(thread: LocatedComment | null, record: CommentHistoryRecord): unknown {
  const field = commentHistoryField(record);
  if (field === 'exist') return thread;
  if (field.startsWith('exist:')) return message(thread, record.result.messageId);
  switch (record.command.type) {
    case 'edit': return body(thread,record.result.messageId);
    case 'move': return pin(thread);
    case 'resolve': return resolution(thread);
    case 'react': return reaction(thread,record);
    default: throw new Error('Unsupported comment history field.');
  }
}
export function commentHistoryChanged(record: CommentHistoryRecord): boolean { return !equal(projection(record.before,record), projection(record.after,record)); }
export function commentHistoryDependencies(record: CommentHistoryRecord): string[] {
  const field = commentHistoryField(record);
  return field === 'exist' ? [] : ['exist', ...(field.startsWith('body:') || field.startsWith('reaction:') ? [`exist:${record.result.messageId}`] : [])];
}
export function replayCommentHistory(graph: SceneGraph, record: CommentHistoryRecord, direction: 'undo' | 'redo', actor?: RoomActor, grants?: CommentAuthorGrants): void {
  record = readCommentHistoryRecord(record); if (!['undo','redo'].includes(direction)) throw new Error('Invalid comment history direction.');
  if (actor) {
    if (actor.id !== record.actorId) throw new RoomCommentActionError(403, 'comments', 'Only the member who recorded this action can replay it.');
    const source = record.before ?? record.after, authorId = record.command.type === 'move' ? source!.messages[0]!.author.id : ['edit','delete'].includes(record.command.type) ? message(source, record.result.messageId)?.author.id : undefined;
    if (authorId !== undefined && !ownsCommentAuthor(authorId, actor, grants)) throw new RoomCommentActionError(403, 'comments', 'The current author grant no longer permits this comment action.');
  }
  const expected = direction === 'undo' ? record.after : record.before, desired = direction === 'undo' ? record.before : record.after, current = commentHistorySnapshot(graph,record.result.threadId), field = commentHistoryField(record);
  if (!equal(projection(current,record), projection(expected,record))) throw conflict();
  if (field === 'exist') {
    if (current) { const node = graph.getNode(current.ownerPageId)!; writeCommentPage(graph,current.ownerPageId,readPageComments(node).filter(thread => thread.id !== current.id)); }
    if (desired) { const node = graph.getNode(desired.ownerPageId); if (!node || node.type !== 'CANVAS' || node.internalOnly) throw conflict(); const { ownerPageId: _page, ...thread } = desired; writeCommentPage(graph,desired.ownerPageId,[...readPageComments(node),thread]); }
  } else {
    if (!current || current.messages[0]!.id !== root(record)) throw conflict();
    const next = structuredClone(current), messageId = record.result.messageId;
    if (field.startsWith('exist:')) {
      const replacement = message(desired,messageId), index = next.messages.findIndex(message => message.id === messageId);
      if (index >= 0) next.messages.splice(index,1);
      if (replacement) { const originalIndex = desired!.messages.findIndex(message => message.id === messageId), previous = desired!.messages[originalIndex - 1]?.id, found = next.messages.findIndex(message => message.id === previous); next.messages.splice(found >= 0 ? found + 1 : next.messages.length,0,structuredClone(replacement)); }
    } else if (record.command.type === 'edit') {
      const item = next.messages.find(message => message.id === messageId), replacement = message(desired,messageId); if (!item || !replacement) throw conflict(); item.body = replacement.body; if (replacement.editedAt === undefined) delete item.editedAt; else item.editedAt = replacement.editedAt;
    } else if (record.command.type === 'move') {
      if (!desired) throw conflict(); next.anchor = structuredClone(desired.anchor); next.ownerPageId = desired.ownerPageId;
    } else if (record.command.type === 'resolve') {
      if (!desired) throw conflict(); next.resolved = desired.resolved; delete next.resolvedBy; delete next.resolvedAt; if (desired.resolvedBy) next.resolvedBy = structuredClone(desired.resolvedBy); if (desired.resolvedAt !== undefined) next.resolvedAt = desired.resolvedAt;
    } else if (record.command.type === 'react') {
      const command = record.command, item = next.messages.find(message => message.id === messageId); if (!item) throw conflict(); let target = item.reactions.find(reaction => reaction.emoji === command.emoji);
      const desiredReaction = reaction(desired,record); if (!target && desiredReaction) { target = { emoji: record.command.emoji, authors: [] }; item.reactions.push(target); }
      if (target) { target.authors = target.authors.filter(author => author !== record.actorId); if (desiredReaction) target.authors.push(record.actorId); } item.reactions = item.reactions.filter(reaction => reaction.authors.length);
    }
    const destination = graph.getNode(next.ownerPageId); if (!destination || destination.type !== 'CANVAS' || destination.internalOnly) throw conflict();
    if (next.ownerPageId !== current.ownerPageId) writeCommentPage(graph,current.ownerPageId,readPageComments(graph.getNode(current.ownerPageId)!).filter(thread => thread.id !== current.id));
    const { ownerPageId: _page, ...thread } = next;
    const threads = readPageComments(destination);
    writeCommentPage(graph,next.ownerPageId,next.ownerPageId === current.ownerPageId ? threads.map(item => item.id === next.id ? thread : item) : [...threads,thread]);
  }
  allComments(graph);
}
export function changedCommentFields(before: LocatedComment[], after: LocatedComment[]): { threadId: string; field: string }[] {
  const a = new Map(before.map(thread => [thread.id,thread])), b = new Map(after.map(thread => [thread.id,thread])), result: { threadId: string; field: string }[] = [];
  for (const threadId of new Set([...a.keys(),...b.keys()])) {
    const old = a.get(threadId) ?? null, next = b.get(threadId) ?? null, add = (field: string) => { result.push({ threadId,field }); };
    if (!old || !next || old.messages[0]!.id !== next.messages[0]!.id) { add('exist'); continue; }
    if (!equal(pin(old),pin(next))) add('anchor'); if (!equal(resolution(old),resolution(next))) add('resolution');
    for (const id of new Set([...old.messages.map(message=>message.id),...next.messages.map(message=>message.id)])) {
      const prior = message(old,id), current = message(next,id); if (!prior || !current) { add(`exist:${id}`); continue; }
      if (!equal(body(old,id),body(next,id))) add(`body:${id}`);
      for (const emoji of new Set([...prior.reactions.map(reaction=>reaction.emoji),...current.reactions.map(reaction=>reaction.emoji)])) {
        const x = prior.reactions.find(reaction=>reaction.emoji===emoji)?.authors ?? [], y = current.reactions.find(reaction=>reaction.emoji===emoji)?.authors ?? [];
        for (const author of new Set([...x,...y])) if (x.includes(author) !== y.includes(author)) add(`reaction:${id}:${author}:${emoji}`);
      }
    }
  }
  return result;
}

import { validateSharedDocumentId } from './sharedCheckpoint';
import { COMMENT_REACTIONS, validCommentAnchor, validCommentAuthor, type CommentAnchor } from './comments';
import { readRoomBinary, readRoomVector, type RoomActor } from './sharedRoomProtocol';

export type RoomCommentAction = { type: 'add'; pageId: string; anchor: CommentAnchor; body: string }
  | { type: 'reply'; threadId: string; body: string }
  | { type: 'edit'; threadId: string; messageId: string; body: string }
  | { type: 'delete'; threadId: string; messageId: string }
  | { type: 'resolve'; threadId: string; resolved: boolean }
  | { type: 'move'; threadId: string; pageId: string; anchor: CommentAnchor }
  | { type: 'react'; threadId: string; messageId: string; emoji: string };
export type RoomCommentCommand = RoomCommentAction | { type: 'history'; threadId: string; sourceClientId: string; sourceRequestId: string; direction: 'undo' | 'redo'; step: number };
export type RoomCommentRequest = { version: 1; type: 'comment'; documentId: string; clientId: string; requestId: string; vector: string; command: RoomCommentCommand };
export type RoomCommentResult = { threadId: string; messageId?: string };
export type RoomCommentResponse = Omit<RoomCommentRequest, 'command'> & { revision: number; acceptedRevision: number; actor: RoomActor; update: string; result: RoomCommentResult };
export const COMMENT_REQUEST_LIMIT = 2 * 1024 * 1024;
export const COMMENT_RECEIPT_LIMIT = 100_000;
export type RoomCommentHistoryEntry = { id: number; clientId: string; requestId: string; threadId: string; action: RoomCommentAction['type']; undone: boolean; step: number; revision: number };
export type RoomCommentHistoryPage = { version: 1; documentId: string; actor: RoomActor; entries: RoomCommentHistoryEntry[]; next: number | null };
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid room comment fields.');
  return value as Record<string, unknown>;
}
export function roomCommentId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_./-]{1,128}$/.test(value)) throw new Error('Invalid comment, layer or page identity.');
}
function body(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\uD800-\uDFFF]/u.test(value)) throw new Error('Enter a valid comment of at most 8,192 characters.');
  return value;
}
function anchor(value: unknown): CommentAnchor {
  if (!validCommentAnchor(value) || value.format !== 'local') throw new Error('Choose a local comment position on the canvas.');
  return structuredClone(value);
}
export function readRoomCommentCommand(value: unknown): RoomCommentCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid room comment action.');
  const type = (value as Record<string, unknown>).type;
  switch (type) {
    case 'history': { const item = object(value, ['type', 'threadId', 'sourceClientId', 'sourceRequestId', 'direction', 'step']); roomCommentId(item.threadId); validateSharedDocumentId(item.sourceClientId); validateSharedDocumentId(item.sourceRequestId); if (!['undo', 'redo'].includes(item.direction as string) || !Number.isSafeInteger(item.step) || (item.step as number) < 0 || (item.step as number) >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid comment history direction or step.'); return { type, threadId: item.threadId, sourceClientId: item.sourceClientId as string, sourceRequestId: item.sourceRequestId as string, direction: item.direction as 'undo' | 'redo', step: item.step as number }; }
    case 'add': { const item = object(value, ['type', 'pageId', 'anchor', 'body']); roomCommentId(item.pageId); return { type, pageId: item.pageId, anchor: anchor(item.anchor), body: body(item.body) }; }
    case 'reply': { const item = object(value, ['type', 'threadId', 'body']); roomCommentId(item.threadId); return { type, threadId: item.threadId, body: body(item.body) }; }
    case 'edit': { const item = object(value, ['type', 'threadId', 'messageId', 'body']); roomCommentId(item.threadId); roomCommentId(item.messageId); return { type, threadId: item.threadId, messageId: item.messageId, body: body(item.body) }; }
    case 'delete': { const item = object(value, ['type', 'threadId', 'messageId']); roomCommentId(item.threadId); roomCommentId(item.messageId); return { type, threadId: item.threadId, messageId: item.messageId }; }
    case 'resolve': { const item = object(value, ['type', 'threadId', 'resolved']); roomCommentId(item.threadId); if (typeof item.resolved !== 'boolean') throw new Error('Invalid comment resolution.'); return { type, threadId: item.threadId, resolved: item.resolved }; }
    case 'move': { const item = object(value, ['type', 'threadId', 'pageId', 'anchor']); roomCommentId(item.threadId); roomCommentId(item.pageId); return { type, threadId: item.threadId, pageId: item.pageId, anchor: anchor(item.anchor) }; }
    case 'react': { const item = object(value, ['type', 'threadId', 'messageId', 'emoji']); roomCommentId(item.threadId); roomCommentId(item.messageId); if (!COMMENT_REACTIONS.includes(item.emoji as typeof COMMENT_REACTIONS[number])) throw new Error('Choose a supported comment reaction.'); return { type, threadId: item.threadId, messageId: item.messageId, emoji: item.emoji as string }; }
    default: throw new Error('Unsupported room comment action.');
  }
}
export function readRoomCommentRequest(value: unknown): { packet: RoomCommentRequest; vector: Uint8Array } {
  const item = object(value, ['version', 'type', 'documentId', 'clientId', 'requestId', 'vector', 'command']);
  if (item.version !== 1 || item.type !== 'comment') throw new Error('Unsupported room comment protocol.');
  for (const key of ['documentId', 'clientId', 'requestId']) validateSharedDocumentId(item[key]);
  const vector = readRoomVector(item.vector), command = readRoomCommentCommand(item.command);
  const packet: RoomCommentRequest = { version: 1, type: 'comment', documentId: item.documentId as string, clientId: item.clientId as string, requestId: item.requestId as string, vector: item.vector as string, command };
  if (new TextEncoder().encode(JSON.stringify(packet)).byteLength > COMMENT_REQUEST_LIMIT) throw new Error('The comment request exceeds its transfer limit.');
  return { packet, vector };
}
export function readRoomCommentActor(value: unknown): RoomActor {
  const member = object(value, ['id', 'name', 'role']); validateSharedDocumentId(member.id);
  if (!validCommentAuthor({ id: member.id, name: member.name }) || (member.name as string).trim() !== member.name || !['owner', 'editor', 'viewer'].includes(member.role as string)) throw new Error('Invalid comment membership.');
  return { id: member.id, name: member.name as string, role: member.role as RoomActor['role'] };
}
export function readRoomCommentResponse(value: unknown, expected: RoomCommentRequest): { packet: RoomCommentResponse; vector: Uint8Array; update: Uint8Array } {
  const item = object(value, ['version', 'type', 'documentId', 'clientId', 'requestId', 'vector', 'revision', 'acceptedRevision', 'actor', 'update', 'result']);
  if (item.version !== 1 || item.type !== 'comment' || item.documentId !== expected.documentId || item.clientId !== expected.clientId || item.requestId !== expected.requestId) throw new Error('The comment response belongs to another room or request.');
  if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 1 || !Number.isSafeInteger(item.acceptedRevision) || (item.acceptedRevision as number) < 1 || (item.acceptedRevision as number) > (item.revision as number)) throw new Error('Invalid comment receipt revision.');
  const member = readRoomCommentActor(item.actor);
  const hasMessage = ['add', 'reply', 'edit', 'delete', 'react'].includes(expected.command.type), result = object(item.result, ['threadId', ...(hasMessage ? ['messageId'] : [])]); roomCommentId(result.threadId);
  if (hasMessage) roomCommentId(result.messageId);
  if ('threadId' in expected.command && result.threadId !== expected.command.threadId || 'messageId' in expected.command && result.messageId !== expected.command.messageId) throw new Error('The comment receipt identifies a different thread or message.');
  return { packet: { version: 1, type: 'comment', documentId: expected.documentId, clientId: expected.clientId, requestId: expected.requestId, vector: item.vector as string, revision: item.revision as number, acceptedRevision: item.acceptedRevision as number, actor: { id: member.id, name: member.name as string, role: member.role as RoomActor['role'] }, update: item.update as string, result: { threadId: result.threadId, ...(hasMessage ? { messageId: result.messageId as string } : {}) } }, vector: readRoomVector(item.vector), update: readRoomBinary(item.update) };
}
export function readRoomCommentHistoryPage(value: unknown, documentId: string, before = Number.MAX_SAFE_INTEGER): RoomCommentHistoryPage {
  validateSharedDocumentId(documentId);
  if (!Number.isSafeInteger(before) || before < 1) throw new Error('Invalid comment history cursor.');
  const item = object(value,['version','documentId','actor','entries','next']);
  if (item.version !== 1 || item.documentId !== documentId || !Array.isArray(item.entries) || item.entries.length > 100) throw new Error('Invalid comment history page.');
  const actor = readRoomCommentActor(item.actor); let previous = before;
  const entries = item.entries.map(value => {
    const entry = object(value,['id','clientId','requestId','threadId','action','undone','step','revision']);
    for (const key of ['clientId','requestId']) validateSharedDocumentId(entry[key]); roomCommentId(entry.threadId);
    if (!Number.isSafeInteger(entry.id) || (entry.id as number)<1 || (entry.id as number)>=previous || !Number.isSafeInteger(entry.step) || (entry.step as number)<0 || !Number.isSafeInteger(entry.revision) || (entry.revision as number)<1 || typeof entry.undone!=='boolean' || !['add','reply','edit','delete','move','resolve','react'].includes(entry.action as string)) throw new Error('Invalid comment history entry.');
    previous = entry.id as number;
    return {id:entry.id as number,clientId:entry.clientId as string,requestId:entry.requestId as string,threadId:entry.threadId,action:entry.action as RoomCommentAction['type'],undone:entry.undone,step:entry.step as number,revision:entry.revision as number};
  });
  if (item.next!==null && (entries.length!==100 || !Number.isSafeInteger(item.next) || item.next!==entries.at(-1)?.id)) throw new Error('Invalid comment history continuation.');
  if (new Set(entries.map(entry=>JSON.stringify([entry.clientId,entry.requestId]))).size!==entries.length) throw new Error('Duplicate comment history identities.');
  return {version:1,documentId,actor,entries,next:item.next as number|null};
}

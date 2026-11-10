import { validCommentAuthor } from './comments';
import { readRoomCommentActor, roomCommentId } from './roomCommentProtocol';
import { validateSharedDocumentId } from './sharedCheckpoint';
import type { RoomActor } from './sharedRoomProtocol';

export type ImportedCommentAuthor = { authorId: string; name: string; memberId: string | null; step: number };
export type AuthorAssignment = Omit<ImportedCommentAuthor, 'name'>;
export type AuthorGrantRequest = AuthorAssignment & { version: 1; requestId: string };
export type AuthorGrantResponse = { version: 1; documentId: string; actor: RoomActor; requestId: string; assignment: AuthorAssignment; current: AuthorAssignment };
export type CommentOwnership = { version: 1; documentId: string; actor: RoomActor; authorIds: string[] };
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) throw new Error('Invalid comment author response or request.');
  return value as Record<string, unknown>;
}
function assignment(value: unknown): AuthorAssignment {
  const item = object(value, ['authorId', 'memberId', 'step']); roomCommentId(item.authorId);
  if (item.memberId !== null) validateSharedDocumentId(item.memberId);
  if (!Number.isSafeInteger(item.step) || (item.step as number) < 0) throw new Error('Invalid comment author grant step.');
  return { authorId: item.authorId as string, memberId: item.memberId as string | null, step: item.step as number };
}
function envelope(value: unknown, documentId: string, fields: string[], owner = false) {
  validateSharedDocumentId(documentId); const item = object(value, fields), actor = readRoomCommentActor(item.actor);
  if (item.version !== 1 || item.documentId !== documentId || owner && actor.role !== 'owner') throw new Error('The comment author reply belongs to another room or access level.');
  return { item, actor };
}
export function readAuthorGrantRequest(value: unknown): AuthorGrantRequest {
  const item = object(value, ['version', 'authorId', 'memberId', 'step', 'requestId']);
  if (item.version !== 1) throw new Error('Unsupported comment author grant version.'); validateSharedDocumentId(item.requestId);
  return { version: 1, ...assignment({ authorId: item.authorId, memberId: item.memberId, step: item.step }), requestId: item.requestId as string };
}
export function readAuthorCatalog(value: unknown, documentId: string): { version: 1; documentId: string; actor: RoomActor; authors: ImportedCommentAuthor[] } {
  const { item, actor } = envelope(value, documentId, ['version', 'documentId', 'actor', 'authors'], true);
  if (!Array.isArray(item.authors) || item.authors.length > 10_000) throw new Error('Invalid imported comment author catalog.');
  const authors = item.authors.map(value => {
    const row = object(value, ['authorId', 'name', 'memberId', 'step']), grant = assignment({ authorId: row.authorId, memberId: row.memberId, step: row.step });
    if (!validCommentAuthor({ id: grant.authorId, name: row.name })) throw new Error('Invalid original comment author.');
    return { ...grant, name: row.name as string };
  });
  if (new Set(authors.map(author => author.authorId)).size !== authors.length) throw new Error('Duplicate imported comment authors.');
  return { version: 1, documentId, actor, authors };
}
export function readAuthorGrantResponse(value: unknown, documentId: string, requestId: string, request?: AuthorGrantRequest): AuthorGrantResponse {
  validateSharedDocumentId(requestId);
  const { item, actor } = envelope(value, documentId, ['version', 'documentId', 'actor', 'requestId', 'assignment', 'current'], true), accepted = assignment(item.assignment), current = assignment(item.current);
  if (item.requestId !== requestId || accepted.step < 1 || current.authorId !== accepted.authorId || current.step < accepted.step || current.step === accepted.step && current.memberId !== accepted.memberId) throw new Error('The author grant reply has a different request or current assignment.');
  if (request) { request = readAuthorGrantRequest(request); if (request.requestId !== requestId || accepted.authorId !== request.authorId || accepted.memberId !== request.memberId || accepted.step !== request.step + 1) throw new Error('The accepted author grant differs from the saved request.'); }
  return { version: 1, documentId, actor, requestId, assignment: accepted, current };
}
export function readCommentOwnership(value: unknown, documentId: string): CommentOwnership {
  const { item, actor } = envelope(value, documentId, ['version', 'documentId', 'actor', 'authorIds']);
  if (!Array.isArray(item.authorIds) || item.authorIds.length > 10_000) throw new Error('Invalid comment ownership reply.');
  item.authorIds.forEach(roomCommentId);
  if (new Set(item.authorIds).size !== item.authorIds.length) throw new Error('Duplicate owned comment authors.');
  return { version: 1, documentId, actor, authorIds: [...item.authorIds] as string[] };
}

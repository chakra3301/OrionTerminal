import { expect, it } from 'vitest';
import { readAuthorCatalog, readAuthorGrantRequest, readAuthorGrantResponse, readCommentOwnership } from './roomAuthorProtocol';
const documentId = 'authors_document_001', actor = { id: 'owner_identity_001', name: 'Owner 🙂', role: 'owner' }, request = { version: 1, authorId: 'local:author/1', memberId: 'editor_identity_001', step: 0, requestId: 'author_request_001' };
const assignment = { authorId: request.authorId, memberId: request.memberId, step: 1 }, response = { version: 1, documentId, actor, requestId: request.requestId, assignment, current: assignment };
it('admits original Unicode labels and detached current/accepted grants without rewriting identity', () => {
  const catalog = readAuthorCatalog({ version: 1, documentId, actor, authors: [{ ...assignment, name: ' Original 🙂 ' }] }, documentId); expect(catalog.authors[0]!.name).toBe(' Original 🙂 '); catalog.authors[0]!.step = 9; expect(assignment.step).toBe(1);
  const parsed = readAuthorGrantResponse({ ...response, current: { ...assignment, memberId: null, step: 3 } }, documentId, request.requestId, request as never); expect(parsed.assignment.memberId).toBe(request.memberId); expect(parsed.current.memberId).toBeNull();
});
it('refuses malformed requests and scopes accepted assignments to exact immutable payloads', () => {
  for (const patch of [{ version: 2 }, { authorId: '?' }, { memberId: undefined }, { step: -1 }, { step: .5 }, { requestId: 'small' }, { actor }]) expect(() => readAuthorGrantRequest({ ...request, ...patch })).toThrow();
  expect(readAuthorGrantRequest({ ...request, memberId: null }).memberId).toBeNull();
  for (const value of [{ ...response, documentId: 'other_document_001' }, { ...response, requestId: 'other_request_001' }, { ...response, actor: { ...actor, role: 'viewer' } }, { ...response, assignment: { ...assignment, memberId: null } }, { ...response, current: { ...assignment, step: 0 } }, { ...response, current: { ...assignment, memberId: null } }, { ...response, secret: 'bad' }]) expect(() => readAuthorGrantResponse(value, documentId, request.requestId, request as never)).toThrow();
});
it('limits unique catalogs and self-ownership replies and accepts viewer-owned original IDs only in the self API', () => {
  const catalog = { version: 1, documentId, actor, authors: [{ ...assignment, name: 'Original' }] };
  for (const patch of [{ authors: [catalog.authors[0], catalog.authors[0]] }, { authors: Array(10001).fill(catalog.authors[0]) }, { authors: [{ ...catalog.authors[0], name: '\uD800' }] }, { authors: [{ ...catalog.authors[0], extra: true }] }, { actor: { ...actor, role: 'viewer' } }]) expect(() => readAuthorCatalog({ ...catalog, ...patch }, documentId)).toThrow();
  const own = { version: 1, documentId, actor: { ...actor, role: 'viewer' }, authorIds: ['legacy'] }; expect(readCommentOwnership(own, documentId).actor.role).toBe('viewer');
  for (const patch of [{ authorIds: ['legacy', 'legacy'] }, { authorIds: Array(10001).fill('legacy') }, { authorIds: ['?'] }, { credential: 'secret' }, { authorIds: undefined }]) expect(() => readCommentOwnership({ ...own, ...patch }, documentId)).toThrow();
});

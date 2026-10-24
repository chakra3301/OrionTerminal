import { expect, it } from 'vitest';
import { readRoomCommentRequest, readRoomCommentResponse, type RoomCommentCommand, type RoomCommentRequest } from './roomCommentProtocol';
const anchor = { points: [{ x: .25, y: .5 }], fallback: [{ x: 12, y: 24 }], format: 'local' as const, nodeId: '2:0' };
const actor = { id: 'comment_member_0001', name: 'Reviewer 👩🏽‍🎨', role: 'viewer' };
const commands: RoomCommentCommand[] = [{ type: 'add', pageId: '1:0', anchor, body: '  שלום 日本語 👋\n<script>text</script>  ' }, { type: 'reply', threadId: 'root', body: 'Reply' }, { type: 'edit', threadId: 'root', messageId: 'reply', body: 'Edit' }, { type: 'delete', threadId: 'root', messageId: 'reply' }, { type: 'resolve', threadId: 'root', resolved: true }, { type: 'move', threadId: 'root', pageId: '1:0', anchor }, { type: 'react', threadId: 'root', messageId: 'reply', emoji: '👍' }];
const request = (command = commands[0]!): RoomCommentRequest => ({ version: 1, type: 'comment', documentId: 'comment_document_001', clientId: 'comment_client_001', requestId: 'comment_request_001', vector: 'AA==', command });
function response(expected = request()) { return { version: 1, type: 'comment', documentId: expected.documentId, clientId: expected.clientId, requestId: expected.requestId, vector: 'AA==', update: 'AAA=', revision: 3, acceptedRevision: 2, actor, result: { threadId: 'threadId' in expected.command ? expected.command.threadId : 'service_assigned_thread', ...(['add', 'reply', 'edit', 'delete', 'react'].includes(expected.command.type) ? { messageId: 'messageId' in expected.command ? expected.command.messageId : 'service_assigned_message' } : {}) } }; }
it.each(commands)('pins and copies the closed $type command without accepting client authors or timestamps', command => {
  const original = request(command), parsed = readRoomCommentRequest(original); expect(parsed.packet).toEqual(original); expect(parsed.vector).toEqual(new Uint8Array([0])); expect(parsed.packet.command).not.toBe(original.command);
  for (const patch of [{ author: actor }, { createdAt: 1000 }, { update: 'AAA=' }, { result: { threadId: 'forged' } }]) { expect(() => readRoomCommentRequest({ ...original, ...patch })).toThrow(); expect(() => readRoomCommentRequest({ ...original, command: { ...command, ...patch } })).toThrow(); }
  expect(readRoomCommentResponse(response(original), original).packet.actor.role).toBe('viewer');
});
it('rejects malformed identities, canonical vectors, incomplete commands and unsupported geometry before transport', () => {
  for (const patch of [{ version: 2 }, { type: 'sync' }, { documentId: '../outside' }, { clientId: '' }, { requestId: null }, { vector: 'AB==' }, { vector: 'AAA=' }, { command: {} }]) expect(() => readRoomCommentRequest({ ...request(), ...patch })).toThrow();
  for (const command of [{ type: 'add', pageId: '1:0', anchor, body: ' ' }, { type: 'reply', threadId: 'root', body: 'x'.repeat(8193) }, { type: 'reply', threadId: 'root', body: '\ud800' }, { type: 'react', threadId: 'root', messageId: 'reply', emoji: '🔥' }, { type: 'resolve', threadId: 'root', resolved: 'true' }, { type: 'delete', threadId: 'x'.repeat(129), messageId: 'reply' }, { type: 'move', threadId: 'root', pageId: '1:0', anchor: { ...anchor, format: 'fig' } }, { type: 'add', pageId: '1:0', anchor: { ...anchor, points: [{ x: Infinity, y: 1 }] }, body: 'Text' }]) expect(() => readRoomCommentRequest(request(command as RoomCommentCommand))).toThrow();
});
it('rejects foreign receipts, misleading identity/revision/result fields and invalid transferred state', () => {
  const expected = request(commands[2]!);
  for (const patch of [{ version: 2 }, { type: 'ack' }, { documentId: 'other_document_001' }, { clientId: 'other_client_0001' }, { requestId: 'other_request_0001' }, { revision: 0 }, { acceptedRevision: 4 }, { acceptedRevision: undefined }, { actor: { ...actor, name: '\u0085' } }, { actor: { ...actor, extra: true } }, { result: { threadId: 'foreign', messageId: 'reply' } }, { result: { threadId: 'root', messageId: 'foreign' } }, { result: { threadId: 'root', messageId: 'reply', author: actor } }, { vector: 'AAA=' }, { update: 'AB==' }, { secret: 'unused' }]) expect(() => readRoomCommentResponse({ ...response(expected), ...patch }, expected)).toThrow();
  expect(readRoomCommentResponse({ ...response(expected), actor: { ...actor, name: '🙂'.repeat(64) } }, expected).packet.actor.name).toHaveLength(128);
});
it('accepts a four-corner region and keeps data independent from caller mutation', () => {
  const original = request({ type: 'add', pageId: '1:0', anchor: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], fallback: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], format: 'local' }, body: 'Region' }), parsed = readRoomCommentRequest(original);
  (original.command as Extract<RoomCommentCommand, { type: 'add' }>).anchor.points[0]!.x = 999;
  expect((parsed.packet.command as Extract<RoomCommentCommand, { type: 'add' }>).anchor.points[0]!.x).toBe(0);
});

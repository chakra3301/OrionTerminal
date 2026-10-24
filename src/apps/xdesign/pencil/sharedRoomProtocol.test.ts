import { describe, expect, it } from 'vitest';
import { encodeStateVector } from 'yjs';
import { readRoomBinary, readRoomRequest, readRoomResponse, roomBinary, type RoomRequest } from './sharedRoomProtocol';

const request: RoomRequest = { version: 1, documentId: 'document_identity_01', clientId: 'client_identity_001', requestId: 'request_identity_01', type: 'update', vector: 'AA==', update: 'AAA=' };
const response = { ...request, type: 'ack', revision: 4, acceptedRevision: 3, actor: { id: 'member_identity_001', name: 'Designer', role: 'editor' } };
describe('shared room boundaries', () => {
  it('accepts actual canonical Yjs vectors and preserves exact update bytes', () => {
    const vector = encodeStateVector(new Map([[71, 19], [29, 0]])), packet = { ...request, vector: roomBinary(vector, true) };
    expect(readRoomRequest(packet).vector).toEqual(vector);
    expect(readRoomResponse({ ...response, vector: packet.vector }, packet).update).toEqual(new Uint8Array([0, 0]));
    expect(roomBinary(readRoomBinary('AAEC/v8='))).toBe('AAEC/v8=');
  });
  it.each([
    ['future protocol', { version: 2 }], ['missing identity', { documentId: undefined }], ['short identity', { clientId: 'short' }],
    ['query identity', { requestId: 'request_identity_01?key=secret' }], ['spoofed actor', { actor: response.actor }],
    ['wrong request', { type: 'ack' }], ['missing update', { update: undefined }], ['noncanonical base64', { update: 'AAB=' }],
    ['truncated vector', { vector: 'AQ==' }], ['trailing vector', { vector: 'AAA=' }], ['overlong vector', { vector: 'gAA=' }],
    ['duplicate vector peer', { vector: 'AgEBAQE=' }], ['unsorted vector peers', { vector: 'AgEBAgE=' }],
  ])('refuses %s before accepting artwork', (_label, fields) => {
    expect(() => readRoomRequest({ ...request, ...fields })).toThrow();
  });
  it('refuses an update on a sync-only request and keeps vector allocations bounded', () => {
    expect(() => readRoomRequest({ ...request, type: 'sync' })).toThrow('fields');
    expect(() => readRoomRequest({ ...request, vector: 'A'.repeat(Math.ceil(1024 * 1024 / 3) * 4 + 4) })).toThrow();
    expect(() => readRoomBinary('AA==')).toThrow();
  });
  it.each([
    ['other room', { documentId: 'other_document_001' }], ['other client', { clientId: 'other_client_00001' }],
    ['other request', { requestId: 'other_request_0001' }], ['sync reply to update', { type: 'sync' }], ['future version', { version: 2 }],
    ['zero revision', { revision: 0 }], ['unsafe revision', { revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['missing receipt', { acceptedRevision: undefined }], ['future receipt', { acceptedRevision: 5 }],
    ['spoofed actor fields', { actor: { ...response.actor, credential: 'secret' } }],
    ['unknown role', { actor: { ...response.actor, role: 'administrator' } }], ['control name', { actor: { ...response.actor, name: 'Bad\nName' } }],
    ['malformed server vector', { vector: 'AAA=' }], ['malformed update bytes', { update: '!invalid!' }],
  ])('refuses %s without releasing an outgoing receipt', (_label, fields) => {
    expect(() => readRoomResponse({ ...response, ...fields }, request)).toThrow();
  });
  it('accepts read-only sync replies without an upload receipt', () => {
    const { update: _update, ...sync } = { ...request, type: 'sync' as const };
    const { acceptedRevision: _receipt, ...result } = { ...response, type: 'sync', actor: { ...response.actor, role: 'viewer' } };
    expect(readRoomResponse(result, sync).packet.actor.role).toBe('viewer');
    expect(() => readRoomResponse({ ...result, acceptedRevision: 3 }, sync)).toThrow();
  });
});

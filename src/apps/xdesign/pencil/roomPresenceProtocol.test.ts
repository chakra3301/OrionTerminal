import { expect, it } from 'vitest';
import { readPresenceRequest, readPresenceResponse, type PresenceRequest } from './roomPresenceProtocol';
const packet = (): PresenceRequest => ({ version: 1, documentId: 'document_identity_001', clientId: 'client_identity_001', sequence: 1, state: { pageId: '1:0', cursor: [12, 24], selection: ['2:0'], view: { center: [30, 40], zoom: .001, width: 800, height: 600 }, following: null } });
const actor = { id: 'membership_identity_001', name: 'Designer', role: 'viewer' };
const response = (request: PresenceRequest) => ({ version: 1, documentId: request.documentId, clientId: request.clientId, sequence: request.sequence, actor, peers: [{ clientId: request.clientId, sequence: request.sequence, actor, state: request.state, expiresInMs: 15_000 }] });
it('copies mutable cursor/selection/view data and permits readonly presence and small fit zooms', () => {
  const original = packet(), request = readPresenceRequest(original), reply = readPresenceResponse(response(original), request); original.state!.cursor![0] = 999; original.state!.selection.push('3:0'); original.state!.view.center[0] = 999;
  expect(request.state).toMatchObject({ cursor: [12, 24], selection: ['2:0'], view: { center: [30, 40], zoom: .001 } }); expect(reply.peers[0]!.state).toEqual(request.state); expect(reply.actor.role).toBe('viewer');
  expect(readPresenceRequest({ ...packet(), state: null }).state).toBeNull();
  const multilingual = packet(); multilingual.state!.pageId = 'Page 😀'; multilingual.state!.selection = ['Layer 🛰️']; expect(readPresenceRequest(multilingual).state!.selection).toEqual(['Layer 🛰️']);
});
it('refuses client identities, authorization claims, unsafe coordinates and oversized selections', () => {
  const valid = packet();
  for (const patch of [{ version: 2 }, { sequence: 0 }, { sequence: Number.MAX_SAFE_INTEGER + 1 }, { actor }, { clientId: '../escape' }, { state: { ...valid.state, following: valid.clientId } }, { state: { ...valid.state, cursor: [Infinity, 0] } }, { state: { ...valid.state, cursor: [1e8 + 1, 0] } }, { state: { ...valid.state, selection: ['2:0', '2:0'] } }, { state: { ...valid.state, selection: Array.from({ length: 65 }, (_, index) => `${index}:0`) } }, { state: { ...valid.state, view: { ...valid.state!.view, zoom: 0 } } }, { state: { ...valid.state, pageId: 'bad\npage' } }, { state: { ...valid.state, pageId: 'bad\ud800' } }]) expect(() => readPresenceRequest({ ...valid, ...patch })).toThrow();
});
it('pins replies and refuses spoofed own client, duplicate peers, unknown fields and expired leases', () => {
  const request = packet(), valid = response(request), peer = valid.peers[0]!;
  for (const patch of [{ sequence: 2 }, { documentId: 'document_identity_002' }, { clientId: 'client_identity_002' }, { peers: [{ ...peer, actor: { ...actor, id: 'membership_identity_002' } }] }, { peers: [peer, peer] }, { peers: [{ ...peer, expiresInMs: 0 }] }, { peers: [{ ...peer, expiresInMs: 15_001 }] }, { credential: 'private' }, { actor: { ...actor, credential: 'private' } }]) expect(() => readPresenceResponse({ ...valid, ...patch }, request)).toThrow();
  expect(() => readPresenceResponse({ ...valid, peers: Array.from({ length: 129 }, (_, index) => ({ ...peer, clientId: `client_identity_${String(index).padStart(3, '0')}` })) }, request)).toThrow();
  expect(() => readPresenceResponse({ ...valid, actor: { ...actor, name: 'bad\udc00' } }, request)).toThrow();
});

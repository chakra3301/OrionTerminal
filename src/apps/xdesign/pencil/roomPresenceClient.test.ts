import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RoomPresenceClient, type PresenceIdentity } from './roomPresenceClient';
import { RoomRequestFailure } from './sharedRoomConnection';
import type { PresencePeer, PresenceRequest, PresenceState } from './roomPresenceProtocol';
const documentId = 'presence_document_001', actor = { id: 'membership_identity_001', name: 'Designer', role: 'viewer' as const };
const state = (): PresenceState => ({ pageId: '1:0', cursor: [12, 24], selection: ['2:0'], view: { center: [30, 40], zoom: .001, width: 800, height: 600 }, following: null });
const peer = (sequence = 1, expiresInMs = 15000): PresencePeer => ({ clientId: 'remote_presence_001', sequence, expiresInMs, actor: { id: 'remote_membership_001', name: 'Peer', role: 'editor' }, state: state() });
function response(packet: PresenceRequest, peers: PresencePeer[] = []) { return { version: 1, documentId, clientId: packet.clientId, sequence: packet.sequence, actor: { ...actor }, peers }; }
type Request = (packet: PresenceRequest, signal: AbortSignal) => Promise<unknown>;
const mockedRequest = (work: Request = async packet => response(packet)) => vi.fn<Request>(work);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const clients: RoomPresenceClient[] = [];
function client(request = mockedRequest(), identity: PresenceIdentity = { clientId: 'local_presence_001', sequence: 0 }, current = () => true) {
  const changed = vi.fn(), close = vi.fn(async () => {}), local = state();
  const connection = new RoomPresenceClient(documentId, actor.id, identity, { request, state: () => local, current, onState: changed, disposeTransport: close, now: () => Date.now() }); clients.push(connection); connection.start(); return { connection, changed, close, local, request };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(async () => { for (const connection of clients.splice(0)) { const closing = connection.dispose(); await vi.advanceTimersByTimeAsync(2100); await closing; } vi.useRealTimers(); });
it('copies latest state into one immutable request and pins membership without authoring authority', async () => {
  const pending = deferred<unknown>(), request = mockedRequest().mockImplementationOnce(() => pending.promise).mockImplementation(async packet => response(packet));
  const { connection, local } = client(request); await vi.advanceTimersByTimeAsync(0); const outgoing = request.mock.calls[0]![0]; local.cursor![0] = 80; local.selection.push('3:0');
  expect(outgoing.state!.cursor).toEqual([12, 24]); expect(Object.keys(outgoing)).toEqual(['version','documentId','clientId','sequence','state']);
  await vi.advanceTimersByTimeAsync(1000); expect(request).toHaveBeenCalledOnce(); pending.resolve(response(outgoing, [peer()])); await vi.advanceTimersByTimeAsync(0);
  expect(connection.snapshot.phase).toBe('online'); const visible = connection.snapshot; visible.peers[0]!.state.cursor![0] = 999; expect(connection.snapshot.peers[0]!.state.cursor![0]).toBe(12);
  await vi.advanceTimersByTimeAsync(250); expect(request.mock.calls[1]![0].state!.cursor).toEqual([80,24]); expect(request.mock.calls[1]![0].sequence).toBe(2);
});
it('subtracts round-trip time and never renews the same peer sequence or revives an expired lease', async () => {
  const pending = deferred<unknown>(), request = mockedRequest().mockImplementationOnce(() => pending.promise).mockImplementation(async packet => response(packet, [peer(1, 400)]));
  const { connection } = client(request); await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(100); pending.resolve(response(request.mock.calls[0]![0], [peer(1, 400)])); await vi.advanceTimersByTimeAsync(0);
  expect(connection.snapshot.peers[0]!.expiresInMs).toBe(300); await vi.advanceTimersByTimeAsync(250); expect(connection.snapshot.peers[0]!.expiresInMs).toBe(50); await vi.advanceTimersByTimeAsync(50); expect(connection.snapshot.peers).toEqual([]);
  await vi.advanceTimersByTimeAsync(500); expect(connection.snapshot.phase).toBe('online'); expect(connection.snapshot.peers).toEqual([]);
});
it('removes absent peers immediately while retaining their immutable sequence watermark', async () => {
  let roster = [peer()]; const request = mockedRequest(async packet => response(packet, roster)); const { connection } = client(request); await vi.advanceTimersByTimeAsync(0);
  roster = []; await vi.advanceTimersByTimeAsync(250); expect(connection.snapshot.peers).toEqual([]); roster = [peer()]; roster[0]!.state.cursor = [50, 60]; await vi.advanceTimersByTimeAsync(250);
  expect(connection.snapshot.phase).toBe('error'); expect(connection.snapshot.peers).toEqual([]); const count = request.mock.calls.length; await vi.advanceTimersByTimeAsync(5000); expect(request.mock.calls.length).toBe(count);
});
it.each(['membership', 'scope', 'regression', 'collision'])('refuses a %s response and clears the roster', async kind => {
  let broken = false; const request = mockedRequest(async packet => {
    const value = response(packet, [peer(2)]); if (broken) { if (kind === 'membership') value.actor = { ...actor, id: 'another_membership_001' }; if (kind === 'scope') value.documentId = 'another_document_001'; if (kind === 'regression') value.peers[0]!.sequence = 1; if (kind === 'collision') value.peers[0]!.actor.id = 'another_membership_001'; } return value;
  }); const { connection } = client(request); await vi.advanceTimersByTimeAsync(0); broken = true; await vi.advanceTimersByTimeAsync(250); expect(connection.snapshot.phase).toBe('error'); expect(connection.snapshot.peers).toEqual([]);
});
it('expires peers during a stalled request, aborts its timeout and never overlaps transport requests', async () => {
  const pending = deferred<unknown>(), request = mockedRequest().mockImplementationOnce(async packet => response(packet, [peer(1, 500)])).mockImplementationOnce(() => pending.promise).mockImplementation(async packet => response(packet));
  const { connection } = client(request); await vi.advanceTimersByTimeAsync(250); expect(request).toHaveBeenCalledTimes(2); await vi.advanceTimersByTimeAsync(250); expect(connection.snapshot.peers).toEqual([]); await vi.advanceTimersByTimeAsync(7750); expect(request.mock.calls[1]![1].aborted).toBe(true); expect(connection.snapshot.phase).toBe('retrying'); expect(request).toHaveBeenCalledTimes(2);
  pending.resolve(response(request.mock.calls[1]![0], [peer()])); await vi.advanceTimersByTimeAsync(0); expect(connection.snapshot.peers).toEqual([]); await vi.advanceTimersByTimeAsync(1000); expect(request).toHaveBeenCalledTimes(3);
});
it('keeps retrying transient capacity failures but stops on revoked access', async () => {
  const request = mockedRequest().mockRejectedValueOnce(new RoomRequestFailure('Wait', 429, 'capacity')).mockRejectedValueOnce(new RoomRequestFailure('Revoked', 401, 'http'));
  const { connection } = client(request); await vi.advanceTimersByTimeAsync(0); expect(connection.snapshot.phase).toBe('retrying'); await vi.advanceTimersByTimeAsync(1000); expect(connection.snapshot.phase).toBe('error'); await vi.advanceTimersByTimeAsync(10000); expect(request).toHaveBeenCalledTimes(2);
});
it('allocates leave before reconnect so a delayed old leave cannot supersede newer presence', async () => {
  const identity = { clientId: 'local_presence_001', sequence: 0 }, pending = deferred<unknown>();
  const request = mockedRequest().mockImplementationOnce(() => pending.promise).mockImplementation(async packet => response(packet));
  const old = client(request, identity); await vi.advanceTimersByTimeAsync(0); const closing = old.connection.dispose(); expect(identity.sequence).toBe(2);
  const newer = client(mockedRequest(), identity); await vi.advanceTimersByTimeAsync(0); expect(identity.sequence).toBe(3);
  pending.resolve(response(request.mock.calls[0]![0])); await vi.advanceTimersByTimeAsync(0); await closing;
  expect(request.mock.calls[1]![0]).toMatchObject({ sequence: 2, state: null }); expect(newer.connection.snapshot.phase).toBe('online'); expect(old.close).toHaveBeenCalledOnce();
});
it('closes a stuck transport within the cleanup budget without overlapping a leave or accepting late state', async () => {
  const pending = deferred<unknown>(), request = mockedRequest().mockImplementationOnce(() => pending.promise).mockImplementation(async packet => response(packet));
  const { connection, close } = client(request); await vi.advanceTimersByTimeAsync(0); const closing = connection.dispose(); expect(connection.dispose()).toBe(closing); expect(request.mock.calls[0]![1].aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(1000); await closing; expect(close).toHaveBeenCalledOnce(); expect(request).toHaveBeenCalledOnce(); pending.resolve(response(request.mock.calls[0]![0], [peer()])); await vi.advanceTimersByTimeAsync(10000); expect(connection.snapshot.phase).toBe('closed'); expect(connection.snapshot.peers).toEqual([]);
});
it('stops publishing when the canvas source changes and refuses exhausted sequence counters', async () => {
  let current = true; const { connection, request } = client(undefined, undefined, () => current); await vi.advanceTimersByTimeAsync(0); current = false; await vi.advanceTimersByTimeAsync(250); expect(connection.snapshot.phase).toBe('closed'); expect(request.mock.calls.slice(1).every(([packet]) => packet.state === null)).toBe(true);
  const exhausted = client(undefined, { clientId: 'exhausted_client_001', sequence: Number.MAX_SAFE_INTEGER }); await vi.advanceTimersByTimeAsync(0); expect(exhausted.connection.snapshot.phase).toBe('error'); expect(exhausted.request).not.toHaveBeenCalled();
});

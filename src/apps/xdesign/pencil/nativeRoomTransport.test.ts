import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeRoomTransport, clearRoomCredential, hasRoomCredential, setRoomCredential } from './nativeRoomTransport';
import { RoomRequestFailure } from './sharedRoomConnection';
import type { RoomRequest } from './sharedRoomProtocol';
import type { RoomCommentRequest } from './roomCommentProtocol';

const native = vi.hoisted(() => ({ invoke: vi.fn(), desktop: true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, isTauri: () => native.desktop }));
const documentId = 'design_document_0001', handle = 'transport_handle_001', actorId = 'membership_0000001';
const secret = `${actorId}.${'a'.repeat(43)}`, serverUrl = 'https://rooms.example.test';
const packet = (): RoomRequest => ({ version: 1, type: 'sync', documentId, clientId: 'client_0000000001', requestId: 'request_000000001', vector: 'AA==' });
const grant = (role = 'owner') => ({ version: 1, documentId, actor: { id: actorId, name: 'Peer', role }, credential: secret });
const transports: NativeRoomTransport[] = [];
const open = async () => { const value = await NativeRoomTransport.open(serverUrl, documentId); transports.push(value); return value; };
beforeEach(() => { native.desktop = true; native.invoke.mockReset(); native.invoke.mockImplementation(async (command: string) => command === 'xdesign_room_open' ? handle : undefined); });
afterEach(async () => { native.invoke.mockImplementation(async () => undefined); for (const transport of transports.splice(0)) await transport.dispose(); });

describe('native room transport contract', () => {
  it('retrieves bounded closed member history pages and rejects unsafe cursors before dispatch', async () => {
    const transport=await open(), entry={id:3,clientId:'history_client_001',requestId:'history_request_001',threadId:'thread',action:'add',undone:false,step:0,revision:2},page={version:1,documentId,actor:{id:actorId,name:'Peer',role:'viewer'},entries:[entry],next:null};
    native.invoke.mockResolvedValue(page);expect((await transport.commentHistory(new AbortController().signal,5)).entries).toEqual([entry]);expect(native.invoke).toHaveBeenLastCalledWith('xdesign_room_request',{handle,sequence:1,operation:{kind:'commentHistory',before:5}});
    native.invoke.mockClear();for(const cursor of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1])await expect(transport.commentHistory(new AbortController().signal,cursor)).rejects.toThrow('cursor');expect(native.invoke).not.toHaveBeenCalled();
    native.invoke.mockResolvedValue({...page,entries:[entry,entry]});await expect(transport.commentHistory(new AbortController().signal)).rejects.toThrow('history');
  });
  it('pins comment/recovery operations and validates their receipt, actor and transferred state', async () => {
    const transport = await open(), request: RoomCommentRequest = { version: 1, type: 'comment', documentId, clientId: 'comment_client_001', requestId: 'comment_request_001', vector: 'AA==', command: { type: 'reply', threadId: 'thread', body: 'Original' } };
    let release!: (value: unknown) => void; native.invoke.mockImplementation(command => command === 'xdesign_room_request' ? new Promise(resolve => { release = resolve; }) : Promise.resolve());
    const work = transport.comment(request, new AbortController().signal); (request.command as { body: string }).body = 'Changed';
    expect(native.invoke.mock.lastCall![1].operation).toMatchObject({ kind: 'comment', recoverOnly: false, message: { command: { body: 'Original' } } });
    const response = { version: 1, type: 'comment', documentId, clientId: request.clientId, requestId: request.requestId, revision: 2, acceptedRevision: 2, actor: { id: actorId, name: 'Peer', role: 'viewer' }, vector: 'AA==', update: 'AAA=', result: { threadId: 'thread', messageId: 'service_assigned_message' } };
    release(response); expect((await work).packet.actor.role).toBe('viewer');
    native.invoke.mockResolvedValue(response); await transport.comment(request, new AbortController().signal, true); expect(native.invoke.mock.lastCall![1].operation.recoverOnly).toBe(true);
    native.invoke.mockResolvedValue({ ...response, requestId: 'other_request_001' }); await expect(transport.comment(request, new AbortController().signal)).rejects.toThrow('another room or request');
  });
  it('rejects author claims, foreign comment rooms and unsupported recovery flags without dispatch', async () => {
    const transport = await open(), request: RoomCommentRequest = { version: 1, type: 'comment', documentId, clientId: 'comment_client_001', requestId: 'comment_request_001', vector: 'AA==', command: { type: 'reply', threadId: 'thread', body: 'Text' } }; native.invoke.mockClear();
    await expect(transport.comment({ ...request, documentId: 'other_document_001' }, new AbortController().signal)).rejects.toThrow('another room');
    await expect(transport.comment({ ...request, command: { ...request.command, author: { id: actorId, name: 'Fake' } } } as unknown as RoomCommentRequest, new AbortController().signal)).rejects.toThrow('fields');
    await expect(transport.comment(request, new AbortController().signal, 'true' as unknown as boolean)).rejects.toThrow('recovery'); expect(native.invoke).not.toHaveBeenCalled();
  });
  it('scopes ephemeral presence packets, copies their data and validates membership/reply identity', async () => {
    const transport = await open(), request = { version: 1 as const, documentId, clientId: 'presence_client_001', sequence: 1, state: { pageId: '1:0', cursor: [12, 24] as [number, number], selection: ['2:0'], view: { center: [0, 0] as [number, number], zoom: 1, width: 800, height: 600 }, following: null } };
    let release!: (value: unknown) => void; native.invoke.mockImplementation(command => command === 'xdesign_room_request' ? new Promise(resolve => { release = resolve; }) : Promise.resolve());
    const work = transport.presence(request, new AbortController().signal); request.state.cursor[0] = 999;
    const sent = native.invoke.mock.lastCall![1].operation; expect(sent.kind).toBe('presence'); expect(sent.message.state.cursor).toEqual([12, 24]);
    release({ version: 1, documentId, clientId: request.clientId, sequence: 1, actor: { id: actorId, name: 'Peer', role: 'viewer' }, peers: [] }); expect((await work).actor.role).toBe('viewer');
    native.invoke.mockClear(); await expect(transport.presence({ ...request, documentId: 'other_document_001' }, new AbortController().signal)).rejects.toThrow('another room'); expect(native.invoke).not.toHaveBeenCalled();
    native.invoke.mockResolvedValue({ version: 1, documentId, clientId: request.clientId, sequence: 2, actor: { id: actorId, name: 'Peer', role: 'viewer' }, peers: [] }); await expect(transport.presence(request, new AbortController().signal)).rejects.toThrow('another room or request');
  });
  it('opens an immutable origin/document handle without connecting or reading a key', async () => {
    const transport = await open(); expect(transport.serverUrl).toBe(`${serverUrl}/`); expect(transport.documentId).toBe(documentId); expect(transport.inFlight).toBe(false);
    expect(native.invoke.mock.calls).toEqual([['xdesign_room_open', { serverUrl: `${serverUrl}/`, documentId }]]);
  });
  it('refuses browser fallback and unsafe configuration before invoking native code', async () => {
    native.desktop = false; await expect(open()).rejects.toThrow('desktop'); native.desktop = true;
    for (const url of ['http://rooms.example.test', 'http://localhost:4787', 'https://user:secret@rooms.example.test', 'https://@rooms.example.test', 'https://rooms.example.test/path', 'https://rooms.example.test?secret=x', 'https://rooms.example.test?', 'https://rooms.example.test#', 'https://rooms.example.test:0', ' https://rooms.example.test']) await expect(NativeRoomTransport.open(url, documentId)).rejects.toThrow();
    await expect(NativeRoomTransport.open(serverUrl, '../escape')).rejects.toThrow(); expect(native.invoke).not.toHaveBeenCalled();
    for (const url of ['http://127.0.0.1:4787', 'http://[::1]:4787']) { const transport = await NativeRoomTransport.open(url, documentId); transports.push(transport); }
  });
  it('keeps OS credentials scoped and returns status without exposing their values', async () => {
    native.invoke.mockResolvedValue(true); await setRoomCredential(serverUrl, documentId, secret); await setRoomCredential(serverUrl, null, 'a'.repeat(32)); await clearRoomCredential(serverUrl, documentId); expect(await hasRoomCredential(serverUrl, documentId)).toBe(true);
    expect(native.invoke.mock.calls).toEqual([
      ['xdesign_room_key_set', { serverUrl: `${serverUrl}/`, documentId, secret }],
      ['xdesign_room_key_set', { serverUrl: `${serverUrl}/`, documentId: null, secret: 'a'.repeat(32) }],
      ['xdesign_room_key_clear', { serverUrl: `${serverUrl}/`, documentId }],
      ['xdesign_room_key_status', { serverUrl: `${serverUrl}/`, documentId }],
    ]);
    native.invoke.mockResolvedValue(secret); await expect(hasRoomCredential(serverUrl, documentId)).rejects.toThrow('status');
  });
  it('refuses invalid secrets without native persistence', async () => {
    for (const value of ['short', `${secret}\n`, 'b'.repeat(257), 'abc.def']) await expect(setRoomCredential(serverUrl, documentId, value)).rejects.toThrow();
    await expect(setRoomCredential(serverUrl, null, `${'a'.repeat(32)}\r\n`)).rejects.toThrow(); expect(native.invoke).not.toHaveBeenCalled();
  });
  it('pins each request while retaining the room receipt identity on a retry', async () => {
    const transport = await open(); let release!: (value: unknown) => void;
    native.invoke.mockImplementation((command: string) => command === 'xdesign_room_request' ? new Promise(resolve => { release = resolve; }) : Promise.resolve());
    const message = packet(), first = transport.request(message, new AbortController().signal); message.requestId = 'changed_request_001';
    expect(native.invoke.mock.lastCall![1]).toEqual({ handle, sequence: 1, operation: { kind: 'sync', message: packet() } }); expect(transport.inFlight).toBe(true);
    await expect(transport.request(packet(), new AbortController().signal)).rejects.toMatchObject({ status: 503, code: 'busy' }); release({ accepted: true }); expect(await first).toEqual({ accepted: true }); expect(transport.inFlight).toBe(false);
    native.invoke.mockResolvedValue({ accepted: true }); await transport.request(packet(), new AbortController().signal); expect(native.invoke.mock.lastCall![1]).toMatchObject({ sequence: 2, operation: { message: packet() } });
  });
  it('rejects cross-document and malformed packets before the transport operation', async () => {
    const transport = await open(); native.invoke.mockClear(); await expect(transport.request({ ...packet(), documentId: 'other_document_001' }, new AbortController().signal)).rejects.toThrow('another document');
    expect(() => transport.request({ ...packet(), vector: 'AB==' }, new AbortController().signal)).toThrow(); expect(native.invoke).not.toHaveBeenCalled();
  });
  it('cancels a dispatched native sequence and waits for its terminal reply before releasing the slot', async () => {
    const transport = await open(); let reject!: (error: unknown) => void;
    native.invoke.mockImplementation((command: string) => command === 'xdesign_room_request' ? new Promise((_, fail) => { reject = fail; }) : Promise.resolve());
    const controller = new AbortController(), work = transport.request(packet(), controller.signal); controller.abort();
    expect(native.invoke).toHaveBeenLastCalledWith('xdesign_room_cancel', { handle, sequence: 1 }); expect(transport.inFlight).toBe(true);
    await expect(transport.request(packet(), new AbortController().signal)).rejects.toMatchObject({ code: 'busy' }); reject({ status: 499, code: 'cancelled', message: 'ignored' }); await expect(work).rejects.toMatchObject({ name: 'AbortError' }); expect(transport.inFlight).toBe(false);
    native.invoke.mockClear(); controller.abort(); expect(native.invoke).not.toHaveBeenCalled();
  });
  it('ignores a success that races abort and contains cancellation-command rejection', async () => {
    const transport = await open(); let release!: (value: unknown) => void;
    native.invoke.mockImplementation((command: string) => command === 'xdesign_room_request' ? new Promise(resolve => { release = resolve; }) : Promise.reject(new Error('bridge stopped')));
    const controller = new AbortController(), work = transport.request(packet(), controller.signal); controller.abort(); release({ version: 1 }); await expect(work).rejects.toMatchObject({ name: 'AbortError' }); await Promise.resolve();
  });
  it('closes a handle allocated after an aborted opening without issuing a request', async () => {
    let release!: (value: string) => void; native.invoke.mockImplementation((command: string) => command === 'xdesign_room_open' ? new Promise(resolve => { release = resolve; }) : Promise.resolve());
    const controller = new AbortController(), work = NativeRoomTransport.open(serverUrl, documentId, controller.signal); controller.abort(); release(handle); await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(native.invoke.mock.calls.map(call => call[0])).toEqual(['xdesign_room_open', 'xdesign_room_close']);
  });
  it('disposes idempotently and suppresses late replies from the closed connection', async () => {
    const transport = await open(); let release!: (value: unknown) => void;
    native.invoke.mockImplementation((command: string) => command === 'xdesign_room_request' ? new Promise(resolve => { release = resolve; }) : Promise.resolve());
    const work = transport.request(packet(), new AbortController().signal); const closing = transport.dispose(); expect(transport.dispose()).toBe(closing); await closing; release({ late: true }); await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await expect(transport.request(packet(), new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(native.invoke.mock.calls.filter(call => call[0] === 'xdesign_room_close')).toHaveLength(1);
  });
  it('preserves typed readonly/dependency/auth/rate/timeout failures without reflecting external text', async () => {
    const transport = await open();
    for (const [status, code] of [[403, 'readonly'], [409, 'dependencies'], [401, 'credential'], [429, 'http'], [504, 'timeout']] as const) {
      native.invoke.mockRejectedValue({ status, code, message: secret }); const work = transport.request(packet(), new AbortController().signal); await expect(work).rejects.toBeInstanceOf(RoomRequestFailure); await expect(work).rejects.toMatchObject({ status, code }); await expect(work).rejects.not.toThrow(secret);
    }
    native.invoke.mockRejectedValue(`unknown-command ${secret}`); await expect(transport.request(packet(), new AbortController().signal)).rejects.toMatchObject({ status: 422, code: 'bridge' });
  });
  it('validates creation/invite capabilities and sends closed management operations', async () => {
    const transport = await open(); native.invoke.mockResolvedValue({ ...grant(), revision: 1 }); expect(await transport.create(' Room ', ' Owner ', new Uint8Array([0, 0]))).toEqual({ actor: grant().actor, credential: secret });
    expect(native.invoke.mock.lastCall![1]).toMatchObject({ sequence: 1, operation: { kind: 'create', name: 'Room', ownerName: 'Owner', checkpoint: 'AAA=' } });
    native.invoke.mockResolvedValue(grant('viewer')); expect((await transport.invite('Peer', 'viewer')).actor.role).toBe('viewer');
    native.invoke.mockResolvedValue({ version: 1, documentId }); await transport.changeMember(actorId, 'editor'); expect(native.invoke.mock.lastCall![1]).toMatchObject({ operation: { kind: 'change', memberId: actorId, role: 'editor' } }); await transport.revokeMember(actorId); expect(native.invoke.mock.lastCall![1]).toMatchObject({ operation: { kind: 'revoke', memberId: actorId } });
    native.invoke.mockResolvedValue({ ...grant('viewer'), credential: `another_member_001.${'b'.repeat(43)}` }); await expect(transport.invite('Peer', 'viewer')).rejects.toThrow('credential');
    native.invoke.mockResolvedValue(grant('editor')); await expect(transport.invite('Peer', 'viewer')).rejects.toThrow('access level');
    native.invoke.mockResolvedValue({ ...grant(), revision: 2 }); await expect(transport.create('Room', 'Owner', new Uint8Array([0, 0]))).rejects.toThrow('version');
    native.invoke.mockResolvedValue({ version: 1, documentId: 'other_document_001' }); await expect(transport.revokeMember(actorId)).rejects.toThrow('another room');
  });
  it('retains revoked entries while refusing duplicate, foreign or missing-owner member lists', async () => {
    const transport = await open(), owner = { ...grant().actor, revoked: false }, peer = { id: 'membership_0000002', name: 'Editor', role: 'editor', revoked: true };
    native.invoke.mockResolvedValue({ version: 1, documentId, members: [owner, peer] }); expect(await transport.members()).toEqual([owner, peer]);
    for (const members of [[owner, owner], [peer], [{ ...owner, revoked: true }], [{ ...owner, extra: true }], Array(65).fill(owner)]) { native.invoke.mockResolvedValue({ version: 1, documentId, members }); await expect(transport.members()).rejects.toThrow(); }
    native.invoke.mockResolvedValue({ version: 2, documentId, members: [owner] }); await expect(transport.members()).rejects.toThrow();
  });
  it('pins grant receipts and validates recovered creation/invite authority and identity', async () => {
    const transport = await open(), requestId = 'grant_request_000001';
    native.invoke.mockResolvedValue({ ...grant(), revision: 1, requestId }); expect((await transport.create('Room', 'Owner', new Uint8Array([0, 0]), undefined, requestId)).requestId).toBe(requestId);
    expect(native.invoke.mock.lastCall![1]).toMatchObject({ operation: { kind: 'create', requestId } });
    expect((await transport.recoverGrant(requestId, 'create', 'owner')).requestId).toBe(requestId); expect(native.invoke.mock.lastCall![1]).toMatchObject({ operation: { kind: 'recover', requestId, grantKind: 'create' } });
    native.invoke.mockResolvedValue({ ...grant('viewer'), requestId }); await transport.invite('Peer', 'viewer', undefined, requestId); expect((await transport.recoverGrant(requestId, 'invite', 'viewer')).actor.role).toBe('viewer');
    native.invoke.mockResolvedValue({ ...grant('viewer'), requestId: 'different_request_001' }); await expect(transport.recoverGrant(requestId, 'invite', 'viewer')).rejects.toThrow('another request');
    native.invoke.mockResolvedValue(grant('viewer')); await expect(transport.invite('Peer', 'viewer', undefined, requestId)).rejects.toThrow('another request');
    native.invoke.mockClear(); await expect(transport.recoverGrant('../escape', 'create', 'owner')).rejects.toThrow(); await expect(transport.recoverGrant(requestId, 'invite', 'owner')).rejects.toThrow(); expect(native.invoke).not.toHaveBeenCalled();
  });
});

it('scopes original-author and self-ownership operations and rejects mismatched immutable assignment replies', async () => {
  const transport = await NativeRoomTransport.open(serverUrl, documentId), signal = new AbortController().signal, owner = { id: actorId, name: 'Owner', role: 'owner' }, request = { version: 1 as const, authorId: 'legacy_author', memberId: null, step: 0, requestId: 'author_request_001' };
  const grant = { version: 1, documentId, actor: owner, requestId: request.requestId, assignment: { authorId: request.authorId, memberId: null, step: 1 }, current: { authorId: request.authorId, memberId: null, step: 2 } };
  native.invoke.mockResolvedValueOnce({ version: 1, documentId, actor: owner, authors: [] }); expect((await transport.commentAuthors(signal)).authors).toEqual([]);
  native.invoke.mockResolvedValueOnce({ version: 1, documentId, actor: { ...owner, role: 'viewer' }, authorIds: ['legacy_author'] }); expect((await transport.commentOwnership(signal)).authorIds).toEqual(['legacy_author']);
  native.invoke.mockResolvedValueOnce(grant); expect((await transport.assignCommentAuthor(request, signal)).current.step).toBe(2); expect(native.invoke).toHaveBeenLastCalledWith('xdesign_room_request', expect.objectContaining({ operation: { kind: 'assignCommentAuthor', message: request } }));
  native.invoke.mockResolvedValueOnce(grant); await transport.recoverCommentAuthor(request, signal); expect(native.invoke).toHaveBeenLastCalledWith('xdesign_room_request', expect.objectContaining({ operation: { kind: 'recoverCommentAuthor', requestId: request.requestId } }));
  native.invoke.mockResolvedValueOnce({ ...grant, assignment: { ...grant.assignment, memberId: 'foreign_member_001' } }); await expect(transport.assignCommentAuthor(request, signal)).rejects.toThrow(); await transport.dispose();
});
